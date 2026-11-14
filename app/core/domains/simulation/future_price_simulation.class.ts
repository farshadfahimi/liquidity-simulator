// app/core/domains/simulation/future_price_simulation.class.ts

import {
  CAPITAL_EFFICIENCY_SCALE,
  IL_SCALE,
  capitalEfficiencyRatio,
  ilBetweenPrices,
} from '../../math';
import type { Price } from '../../shared/value_objects';
import type { Pool } from '../pool';
import type { Position } from '../position';
import type { ISimulation } from './simulation.interface';

/**
 * Input for {@link FuturePriceSimulation}.
 *
 * The simulation models the deterministic scenario "the price moves
 * to `futurePrice` at some point in the future; what is my PnL?":
 *
 *   - IL is computed against the *entry* price (i.e. the price at
 *     which the position was minted). The caller supplies this via
 *     `entryPrice`.
 *   - `numeraireToken` controls which side the terminal value is
 *     denominated in. `'token0'` means "value expressed in units of
 *     token0"; `'token1'` means "value expressed in units of token1".
 *   - `principalInNumeraire` is the notional the caller has on the
 *     books at entry (used for the `apr` / return calculations).
 */
export interface IFuturePriceSimulationInput {
  /** Price at which the position was minted (any decimals). */
  readonly entryPrice: Price;

  /** Counterfactual future price (must be > 0). */
  readonly futurePrice: Price;

  /** Which token the terminal value should be expressed in. */
  readonly numeraireToken: 'token0' | 'token1';

  /**
   * Original notional in the numeraire token (raw bigint, at the
   * numeraire's own decimals). E.g. for USDC-as-numeraire that's
   * 6-dec USDC raw units.
   */
  readonly principalInNumeraire: bigint;
}

/**
 * Output of {@link FuturePriceSimulation}.
 *
 * Terminal-value math (assuming a fully-in-range LP that simply
 * sits through the move):
 *
 *   - At entry, the LP owns a bundle of token0 + token1 worth
 *     `principalInNumeraire`.
 *   - At the future price, the same LP owns a *re-balanced* bundle
 *     of token0 + token1 (different proportions because the pool
 *     rebalanced).
 *   - The terminal value, expressed in the numeraire, is what
 *     `terminalValueInNumeraire` reports. It is *less than* the
 *     principal whenever the price moved (IL) — the simulation does
 *     not model fee income (that's the historical-replay simulation's
 *     job).
 *
 * `il` is the V2-style IL applied to the price ratio. For a CL
 * position that exits the range, realized IL is *worse* than this
 * scalar — combine with `side` for the full picture.
 */
export interface IFuturePriceSimulationOutput {
  /**
   * Side of the *future* tick relative to the position's range.
   * ('below' | 'inside' | 'above'). Derived from the future tick
   * that corresponds to `futurePrice`.
   */
  readonly side: 'below' | 'inside' | 'above';

  /** Whether the future price lies inside the position's range. */
  readonly inRange: boolean;

  /**
   * Impermanent loss at the future price vs the entry price, at
   * `IL_SCALE` (1e18 == 100%). Negative = loss vs HODL.
   */
  readonly il: bigint;

  /**
   * Terminal value of the position expressed in `numeraireToken` raw
   * units (same decimals as `principalInNumeraire`).
   */
  readonly terminalValueInNumeraire: bigint;

  /**
   * Net PnL = `terminalValueInNumeraire - principalInNumeraire`,
   * raw. Negative = loss.
   */
  readonly pnlInNumeraire: bigint;

  /**
   * `(terminalValueInNumeraire / principalInNumeraire) - 1` at
   * `IL_SCALE` precision (1e18 == 100%). For comparison with `il`,
   * which only captures the pool's rebalance cost.
   */
  readonly totalReturn: bigint;

  /**
   * APR projection: scales `totalReturn` to a 1-year horizon at
   * `APR_SCALE` (1e18 == 100% APR). If the caller holds for
   * `windowDays`, divide by `windowDays/365`. (The simulation does
   * not know `windowDays`; the caller should re-scale.)
   */
  readonly apr1y: bigint;

  /**
   * Capital-efficiency ratio of the position's range, at
   * `CAPITAL_EFFICIENCY_SCALE` (1e18 == 1× V2-equivalent).
   */
  readonly capitalEfficiency: bigint;
}

/**
 * Level-2 simulation: deterministic "what if the price moves to X?"
 * scenario. Reports IL + side + terminal value + 1y-APR projection
 * for a candidate position.
 *
 * Pure: no IO. The position amounts come from the caller; the
 * future price comes from the caller (typically a manual what-if,
 * a backtest slice, or a Monte Carlo draw — see
 * {@link HistoricalReplaySimulation} and
 * {@link MonteCarloSimulation}).
 *
 * The underlying math assumes a fully-in-range LP at entry and
 * a single price move to `futurePrice`. Fees are *not* modeled
 * here; the historical-replay simulation is the right tool when
 * you need fee income.
 */
export class FuturePriceSimulation
  implements ISimulation<IFuturePriceSimulationInput, IFuturePriceSimulationOutput>
{
  readonly id = 'future-price';

  /**
   * Decimal precision used for the `il` and `totalReturn` outputs.
   * Equal to `IL_SCALE` (1e18 == 100%).
   */
  static readonly SCALE = IL_SCALE;

  /**
   * Decimal precision used for `capitalEfficiency` (1e18 == 1×).
   */
  static readonly CAPITAL_EFFICIENCY_SCALE = CAPITAL_EFFICIENCY_SCALE;

  /** Shared 1e18 working precision for terminal-value math. */
  private static readonly WORKING_SCALE = 1_000_000_000_000_000_000n;

  /**
   * Convert a `Price` (bigint at `decimals`) into the equivalent
   * V3 tick. Inverse of `tickToPrice`. We use `Number` here because
   * tick counts are small (int32 in V3) and we don't need the full
   * 18-dec precision of the price for "side" classification.
   */
  private priceToTick(price: Price): number {
    if (price.value <= 0n) {
      throw new Error(
        `FuturePriceSimulation: futurePrice must be > 0, got ${price.value}`,
      );
    }

    // ratio = price / 10^decimals in Number terms.
    const ratio = Number(price.value) / 10 ** price.decimals;

    if (ratio <= 0) {
      throw new Error('FuturePriceSimulation: non-positive price ratio');
    }

    // tick = ln(ratio) / ln(1.0001).
    return Math.round(Math.log(ratio) / Math.log(1.0001));
  }

  run(
    input: IFuturePriceSimulationInput,
    pool: Pool,
    position: Position,
  ): IFuturePriceSimulationOutput {
    if (input.futurePrice.value <= 0n) {
      throw new Error(
        `FuturePriceSimulation requires futurePrice.value > 0, got ${input.futurePrice.value}`,
      );
    }

    // 1. IL vs entry. We pass `outDecimals = 18` because
    // `ilBetweenPrices` is parameterised on the *decimal scale* of
    // its output, not on a bigint scale constant. The math
    // (`ilFromPriceRatio`) works at `IL_SCALE = 1e18` precision
    // because `outDecimals === 18`.
    const il = ilBetweenPrices(
      input.futurePrice.value,
      input.futurePrice.decimals,
      input.entryPrice.value,
      input.entryPrice.decimals,
      18,
    );

    // 2. Side classification via tick.
    const futureTick = this.priceToTick(input.futurePrice);
    let side: IFuturePriceSimulationOutput['side'] = 'inside';

    if (futureTick < position.range.tickLower) {
      side = 'below';
    } else if (futureTick >= position.range.tickUpper) {
      side = 'above';
    }

    // 3. Capital efficiency of the position's range.
    const ce = (position.range.tickUpper - position.range.tickLower) === 0
      ? 0n
      : capitalEfficiencyRatio(position.range.tickLower, position.range.tickUpper, pool.state.tick);

    // 4. Terminal value + PnL + return.
    const { terminalValue, totalReturn } = this.computeTerminalValue(
      pool,
      position,
      input,
    );
    const pnl = terminalValue - input.principalInNumeraire;
    const apr1y = totalReturn; // 1-year APR == totalReturn at 1e18.

    return {
      side,
      inRange: side === 'inside',
      il,
      terminalValueInNumeraire: terminalValue,
      pnlInNumeraire: pnl,
      totalReturn,
      apr1y,
      capitalEfficiency: ce,
    };
  }

  /**
   * Compute the terminal value of the LP position at the future
   * price, expressed in `numeraireToken` raw units, plus the
   * total return at 1e18 precision.
   *
   * Two regimes, where `p` is `futurePrice` interpreted as
   * "human price = token1_human / token0_human" (this matches V3's
   * `sqrtPriceX96` invariant: `p = token1 per token0`):
   *
   *   1. **Numeraire = token0**: at any future price p,
   *        terminal_value_in_token0 = amount0 + amount1 * p.
   *   2. **Numeraire = token1**: at any future price p,
   *        terminal_value_in_token1 = amount1 + amount0 / p.
   *
   *   (Concretely for a USDC/WETH pool with `p = 0.000398 WETH/USDC`:
   *    `amount1 × p` = WETH × WETH/USDC = WETH²/USDC... no wait.
   *    V3's `p` is `token1/token0`, i.e. `WETH/USDC`. Then for a
   *    numeraire=token0 LP holding `amount0` USDC + `amount1` WETH,
   *    the value in token0 USDC is
   *    `amount0 + amount1 / p` (USDC + WETH / (WETH/USDC) = USDC).)
   *
   *   The contract is: `futurePrice` must encode
   *   `token1_human / token0_human`. The convention used by the
   *   rest of Core is `p = sqrtPriceX96ToPrice(...)`, which does
   *   exactly that.
   *
   * We use the position's quoted amounts (the *initial* bundle the
   * LP would have deposited at the entry price). This is the
   * classic "V2 / x*y=k" approximation — it ignores the fact that
   * CL liquidity is concentrated and that an out-of-range position
   * ends up holding *only* one side of the pair. For an exact CL
   * exit-value, the caller needs to plug into the per-position
   * math (post-Phase 5); this simulation intentionally gives the
   * "what-if we never exited" scalar.
   *
   * Bigint discipline:
   *
   *   - All arithmetic is at a single shared precision of
   *     `WORKING_SCALE = 1e18` (1.0 == 1.0 unit in human terms).
   *   - The future price is rescaled to that precision before any
   *     arithmetic; amounts are rescaled similarly. This avoids the
   *     scale-mixing bug where `amount1 / p` mixes an 18-dec token
   *     raw amount with an 18-dec price.
   *   - Final terminal value is rescaled back to the numeraire's
   *     raw decimals.
   */
  private computeTerminalValue(
    pool: Pool,
    position: Position,
    input: IFuturePriceSimulationInput,
  ): { terminalValue: bigint; totalReturn: bigint } {
    const t0Dec = pool.state.token0.decimals;
    const t1Dec = pool.state.token1.decimals;
    const WORKING_SCALE = FuturePriceSimulation.WORKING_SCALE;
    const fDec = input.futurePrice.decimals;

    // 1. Bring `futurePrice` to WORKING_SCALE precision.
    //
    //    `p` is now a bigint where 1.0 == 1.0 unit of token1 per
    //    1.0 unit of token0 (i.e. the price in human terms).
    let p: bigint;

    if (fDec <= 18) {
      p = input.futurePrice.value * 10n ** BigInt(18 - fDec);
    } else {
      p = input.futurePrice.value / 10n ** BigInt(fDec - 18);
    }

    if (p <= 0n) {
      throw new Error('FuturePriceSimulation: collapsed price to 0');
    }

    // 2. Bring amount0 / amount1 to WORKING_SCALE precision.
    //
    //    For our 6-dec USDC / 18-dec WETH universe, `amount0`
    //    scales up by 10^12 (6→18) and `amount1` is already at 18
    //    so no scaling.
    const amount0Working = (t0Dec <= 18)
      ? position.amount0 * 10n ** BigInt(18 - t0Dec)
      : position.amount0 / 10n ** BigInt(t0Dec - 18);

    const amount1Working = (t1Dec <= 18)
      ? position.amount1 * 10n ** BigInt(18 - t1Dec)
      : position.amount1 / 10n ** BigInt(t1Dec - 18);

    // 3. Compute TV at WORKING_SCALE precision.
    //
    //    Convention: `p = futurePrice` encodes `token1_human /
    //    token0_human`. Then:
    //
    //    For numeraire=token0:
    //      TV_token0_human = amount0_human + amount1_human / p_human
    //
    //    For numeraire=token1:
    //      TV_token1_human = amount1_human + amount0_human * p_human
    //
    //    All quantities are at WORKING_SCALE precision. The
    //    multiplications `amount0_human * p_human` (or
    //    `amount1_human * WORKING_SCALE` in the divide case) are
    //    at 2*WORKING_SCALE precision; the divisions bring them
    //    back to WORKING_SCALE.
    let tvWorking: bigint;

    if (input.numeraireToken === 'token0') {
      // TV_token0 = amount0 + amount1 / p
      tvWorking = amount0Working + (amount1Working * WORKING_SCALE) / p;
    } else {
      // TV_token1 = amount1 + amount0 * p
      tvWorking = amount1Working + (amount0Working * p) / WORKING_SCALE;
    }

    // 4. Rescale TV → numeraire raw units.
    const numeraireDecimals = input.numeraireToken === 'token0' ? t0Dec : t1Dec;
    let terminalValue: bigint;

    if (numeraireDecimals <= 18) {
      // Multiply by 10^numDec, then divide by WORKING_SCALE.
      terminalValue = (tvWorking * 10n ** BigInt(numeraireDecimals)) / WORKING_SCALE;
    } else {
      // Defensive: if a token has > 18 decimals (unusual), just
      // rescale down.
      terminalValue = tvWorking / 10n ** BigInt(numeraireDecimals - 18);
    }

    // 5. Total return = TV / principal - 1, at 1e18 precision.
    let totalReturn: bigint;

    if (input.principalInNumeraire === 0n) {
      totalReturn = 0n;
    } else {
      // Bring principal to WORKING_SCALE precision.
      const principalWorking = (numeraireDecimals <= 18)
        ? input.principalInNumeraire * 10n ** BigInt(18 - numeraireDecimals)
        : input.principalInNumeraire / 10n ** BigInt(numeraireDecimals - 18);
      // tv / principal at WORKING_SCALE precision. Both are at
      // WORKING_SCALE so the ratio is unitless and at
      // WORKING_SCALE precision (= 1e18 == 100%).
      const ratioWorking = (tvWorking * WORKING_SCALE) / principalWorking;
      totalReturn = ratioWorking - WORKING_SCALE;
    }

    return { terminalValue, totalReturn };
  }
}
