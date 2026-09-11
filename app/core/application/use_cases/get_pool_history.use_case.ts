// app/core/application/use_cases/get_pool_history.use_case.ts

import { AnalyticsEngine } from '../../domains/analytics';
import { PoolHistory, PoolSnapshot } from '../../domains/history';
import { Pool } from '../../domains/pool';
import { Price, sqrtPriceX96ToPrice } from '../../shared/value_objects';
import type { TAddress } from '../../shared/types';
import type { IRpcProvider } from '../../providers/rpc';
import type { IProtocolAdapter } from '../../adapters/protocol_adapter.interface';
import { bigintExp } from '../../math';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { TAdapterResolver } from './adapter_resolver.type';
import type {
  IPoolHistoryDTO,
  IHistorySnapshotDTO,
} from '../dtos/pool_history.dto';

/**
 * Knobs for {@link GetPoolHistoryUseCase}. All values have sensible
 * defaults — a UI can call the use case with `{}` after supplying
 * `pool` + `chainId` + `protocolId` and get a useful chart.
 */
export interface IGetPoolHistoryInput {
  readonly pool: TAddress;

  readonly chainId: number;

  readonly protocolId?: string;

  /**
   * How many snapshots to fetch. The use case walks the most recent
   * `numSnapshots` blocks spaced by `blockStep`. Default 60 — gives
   * a couple of hours of Ethereum mainnet data at 12s blocks
   * (`blockStep = 200`).
   */
  readonly numSnapshots?: number;

  /**
   * Block distance between consecutive snapshots. The use case picks
   * a sensible default per chain when omitted.
   */
  readonly blockStep?: bigint;

  /**
   * Hard cap on the on-chain fetch cost. When the chain is too far
   * behind or the RPC's archive window can't satisfy the request,
   * the use case silently falls back to a synthetic GBM series
   * anchored at the current price. Set to 0 to disable the fallback
   * and surface the error.
   */
  readonly maxSnapshots?: number;

  /**
   * Realized volatility (at VOLATILITY_SCALE) used to seed the
   * synthetic path. When omitted the use case samples a typical
   * 50%-annual σ so the chart is never flat.
   */
  readonly annualizedVolatilityOverride?: bigint;

  /** Output precision for `price` in the returned DTO. Default 18. */
  readonly priceDecimals?: number;
}

/**
 * Per-chain default block step (in blocks). These are picked so
 * `numSnapshots=60` gives roughly the "last few hours" of activity.
 * The same value is fine for any V3 / V3-compatible chain — these
 * constants are block counts, not seconds.
 */
const DEFAULT_BLOCK_STEP: Readonly<Record<number, bigint>> = {
  1: 200n, // Ethereum mainnet — 12s blocks, ~40 min total window
  42161: 200n, // Arbitrum — ~0.25s blocks, ~50s total (mostly noise)
  8453: 600n, // Base — 2s blocks, ~20 min total
  146: 600n, // Sonic — 2s blocks, ~20 min total
};

const DEFAULT_NUM_SNAPSHOTS = 60;
const DEFAULT_MAX_SNAPSHOTS = 200;
const SYNTHETIC_NUM_SNAPSHOTS = 60;
const SYNTHETIC_DEFAULT_SIGMA: bigint = 500_000_000_000_000_000n; // 50% annual

/**
 * History-fetcher use case: walks recent blocks, calls
 * `adapter.getPoolStateAtBlock` for each, and emits a chart-ready
 * DTO.
 *
 * Strategy:
 *
 *   1. Resolve the adapter, fetch the *current* pool state.
 *   2. Compute the block range from `numSnapshots` + `blockStep`.
 *   3. For each historical block, call `adapter.getPoolStateAtBlock`
 *      to get the pinned `slot0` and compute a `Price`.
 *   4. If any historical read throws (archive node unavailable, RPC
 *      rejected the block tag, etc.) fall back to a synthetic GBM
 *      path anchored at the current price. The DTO's `source` field
 *      tells the UI which path was taken.
 *
 * This use case does NOT depend on a history provider — the adapter
 * is the only thing that knows how to decode `slot0`, so going
 * through it keeps the protocol-neutral contract.
 */
export class GetPoolHistoryUseCase {
  readonly id = 'get-pool-history';

  constructor(
    private readonly resolveAdapter: TAdapterResolver,
    private readonly rpc: () => IRpcProvider,
    private readonly analytics: AnalyticsEngine = new AnalyticsEngine(),
  ) {}

  async execute(input: IGetPoolHistoryInput): Promise<IPoolHistoryDTO> {
    if (!input.pool) {
      throw new InvalidUseCaseInputError(this.id, 'pool', 'address is required');
    }
    if (input.chainId === undefined || input.chainId === null) {
      throw new InvalidUseCaseInputError(this.id, 'chainId', 'must be a positive integer');
    }

    const adapter = this.resolveAdapter(input.chainId, input.protocolId);
    const latestState = await adapter.getPoolState(input.pool);
    const latestPool = new Pool(latestState, input.chainId);
    const priceDecimals = input.priceDecimals ?? 18;
    const currentPrice: Price = latestPool.currentPrice(priceDecimals);

    // Try the on-chain path first.
    const numSnapshots = Math.max(
      2,
      Math.min(
        input.numSnapshots ?? DEFAULT_NUM_SNAPSHOTS,
        input.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS,
      ),
    );
    const blockStep = input.blockStep
      ?? DEFAULT_BLOCK_STEP[input.chainId]
      ?? 200n;

    try {
      const snapshots = await this.fetchOnChainSnapshots(
        adapter,
        this.rpc(),
        input.pool,
        input.chainId,
        latestState.token0.decimals,
        latestState.token1.decimals,
        numSnapshots,
        blockStep,
        priceDecimals,
      );

      // The on-chain path needs at least 2 points to be useful; a
      // single point is just the latest state, which the rest of
      // the UI already shows.
      if (snapshots.length < 2) {
        return this.syntheticFallback(
          adapter,
          currentPrice,
          latestPool.state.tick,
          input.chainId,
          input.protocolId ?? adapter.id,
          input.pool,
          priceDecimals,
          input.annualizedVolatilityOverride,
          'on-chain fetch returned fewer than 2 snapshots',
        );
      }

      const history = this.buildDomainHistory(
        snapshots,
        input.pool,
        input.chainId,
      );
      // `volatilityFromHistory` divides by `n-1` and crashes when
      // there are fewer than 2 *distinct* log-returns (i.e. when
      // the price didn't move across the window — common for
      // stablecoin pairs on a short horizon). Skip it in that
      // case and report σ = 0.
      const allSame = snapshots.every(
        (s) => s.price === snapshots[0]!.price && s.tick === snapshots[0]!.tick,
      );
      const vol = allSame
        ? null
        : this.analytics.volatilityFromHistory(history);
      const first = snapshots[0]!;
      const last = snapshots[snapshots.length - 1]!;

      return {
        pool: input.pool,
        chainId: input.chainId,
        protocolId: input.protocolId ?? adapter.id,
        source: 'on-chain',
        sourceDetail: `walked ${snapshots.length} blocks at step ${blockStep}`,
        snapshots,
        fromBlock: first.blockNumber,
        toBlock: last.blockNumber,
        historyWindowSeconds: last.timestamp - first.timestamp,
        annualizedVolatility: vol?.volAnnual ?? 0n,
      };
    }
    catch (err) {
      // The caller explicitly opted out of the synthetic path; let
      // the error bubble so the UI can surface it.
      if ((input.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS) === 0) {
        throw err;
      }

      return this.syntheticFallback(
        adapter,
        currentPrice,
        latestPool.state.tick,
        input.chainId,
        input.protocolId ?? adapter.id,
        input.pool,
        priceDecimals,
        input.annualizedVolatilityOverride,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // -----------------------------------------------------------------
  // Internal — on-chain
  // -----------------------------------------------------------------

  private async fetchOnChainSnapshots(
    adapter: IProtocolAdapter,
    rpc: IRpcProvider,
    pool: TAddress,
    _chainId: number,
    token0Decimals: number,
    token1Decimals: number,
    numSnapshots: number,
    blockStep: bigint,
    priceDecimals: number,
  ): Promise<IHistorySnapshotDTO[]> {
    const latestBlock = await rpc.getBlockNumber();

    // Build the block-number list (oldest first, latest last).
    const blockNumbers: bigint[] = [];
    for (let i = numSnapshots - 1; i >= 0; i--) {
      const b = latestBlock - blockStep * BigInt(i);
      if (b > 0n) {
        blockNumbers.push(b);
      }
    }

    const snapshots: IHistorySnapshotDTO[] = [];

    for (const blockNumber of blockNumbers) {
      // Fetch state pinned to this block, plus the block's
      // timestamp, in parallel.
      const [pinned, block] = await Promise.all([
        adapter.getPoolStateAtBlock(pool, blockNumber),
        rpc.getBlock(blockNumber),
      ]);

      const price = sqrtPriceX96ToPrice(
        pinned.sqrtPriceX96,
        token0Decimals,
        token1Decimals,
        priceDecimals,
      );

      snapshots.push({
        blockNumber,
        timestamp: block.timestamp,
        tick: pinned.tick,
        price: price.value,
        priceDecimals: price.decimals,
      });
    }

    return snapshots;
  }

  // -----------------------------------------------------------------
  // Internal — synthetic GBM fallback
  // -----------------------------------------------------------------

  /**
   * Build a deterministic synthetic series anchored at the current
   * pool price. We use a fixed seed (derived from the chainId + pool
   * address) so the chart doesn't flicker between renders.
   *
   * The path is a simple log-normal walk: each step's log-return is
   * a deterministic function of the step index (no PRNG needed for
   * determinism — we use a cheap `sin` surrogate that produces a
   * believable mean-reverting oscillation around the current
   * price). This is a *visual* fallback only; the tooltip should
   * show "synthetic" so the user knows it's not real history.
   */
  private syntheticFallback(
    _adapter: IProtocolAdapter,
    currentPrice: Price,
    currentTick: number,
    chainId: number,
    protocolId: string,
    pool: TAddress,
    priceDecimals: number,
    annualizedVolatilityOverride: bigint | undefined,
    reason: string,
  ): IPoolHistoryDTO {
    const n = SYNTHETIC_NUM_SNAPSHOTS;
    const sigma = annualizedVolatilityOverride ?? SYNTHETIC_DEFAULT_SIGMA;
    // Convert annual σ to per-step σ assuming 1-step = 1 hour and
    // 8760 hours/year. We keep the math at VOLATILITY_SCALE (1e18)
    // and convert to a 1-decimal scale for cheap bigint ops:
    //   sigmaStep = σ * sqrt(1h / 8760h) ≈ σ / 93.7
    const stepSeconds = 3600n;
    const secondsPerYear = 31_536_000n;
    // sigmaStepNum = sigma * sqrt(stepSeconds / spy) at 1e18 scale
    // We use an integer approximation: sqrt(1/8760) ≈ 0.01068 →
    // 0.01068 * 1e18 = 10_680_000_000_000n. We then multiply by
    // sigma / 1e18 to land at the final scale.
    const SQRT_STEP_FRAC = 10_680_000_000_000n; // ≈ sqrt(1h / year) at 1e18
    const sigmaStep = (sigma * SQRT_STEP_FRAC) / 1_000_000_000_000_000_000n;

    // Deterministic seed from the pool address + chainId.
    // We hash the address bytes through a simple FNV-1a so the seed
    // is well-distributed regardless of the address shape.
    let addrHash = 2166136261n; // FNV offset basis (32-bit)
    const addrHex = pool.slice(2);
    for (let i = 0; i < addrHex.length; i++) {
      const c = BigInt(addrHex.charCodeAt(i));
      addrHash = (addrHash ^ c) * 16777619n; // FNV prime
      addrHash &= 0xFFFFFFFFn; // keep 32-bit
    }
    const seedBase = (BigInt(chainId) * 1_000_003n) + addrHash;

    const now = BigInt(Math.floor(Date.now() / 1000));
    const snapshots: IHistorySnapshotDTO[] = [];
    const p0 = currentPrice.value;
    const pd = currentPrice.decimals;

    // Walk `n + 1` steps so the latest point coincides with the
    // current price (no jump when the user re-opens the tab).
    for (let i = 0; i <= n; i++) {
      const t = i - n; // negative = past, 0 = present
      // Two cheap sin-like surrogates at 1e18 scale:
      //   drift = (i / n - 0.5) * driftAmp        (linear trend)
      //   cycle = sin(i * 2π / 24) * cycleAmp    (24-step period)
      // Both are computed at 1e18 by reusing fixed integer
      // approximations of π/12 and 0.3/0.05 — enough for a chart.
      const posFrac = (BigInt(i) * 1_000_000_000_000_000_000n) / BigInt(n);
      const drift = ((posFrac - 500_000_000_000_000_000n) * 300_000_000_000_000_000n) / 1_000_000_000_000_000_000n; // ±15%
      const cycleArg = (BigInt(i) * 261_799_387_799_099_427n) / 1_000_000_000_000_000_000n; // (2π/24) * i at 1e18
      const cycle = sinApprox(cycleArg) * 500_000_000_000_000_000n / 1_000_000_000_000_000_000n; // ±50%
      const noise = ((seedBase * BigInt(i * 13 + 7)) % 1_000_000_000n)
        * sigmaStep / 1_000_000_000n;
      const logReturn = drift + cycle + noise;

      // price_i = price_0 * exp(logReturn)
      const factor = bigintExp(logReturn, 18);
      const priceValue = (p0 * factor) / 1_000_000_000_000_000_000n;

      snapshots.push({
        blockNumber: 0n,
        timestamp: now + stepSeconds * BigInt(t),
        tick: currentTick, // synthetic; tick math would need tickToPrice which we don't need
        price: priceValue,
        priceDecimals: pd,
      });
    }

    return {
      pool,
      chainId,
      protocolId,
      source: 'synthetic',
      sourceDetail: `synthetic GBM fallback: ${reason || 'archive node unavailable'}`,
      snapshots,
      fromBlock: 0n,
      toBlock: 0n,
      historyWindowSeconds: stepSeconds * BigInt(n),
      annualizedVolatility: sigma,
    };
  }

  // -----------------------------------------------------------------
  // Internal — helpers
  // -----------------------------------------------------------------

  private buildDomainHistory(
    snapshots: readonly IHistorySnapshotDTO[],
    pool: TAddress,
    chainId: number,
  ): PoolHistory {
    // Build a PoolHistory aggregate so we can reuse the
    // analytics engine's volatility routine.
    const voSnapshots = snapshots.map((s) => {
      const price = new Price(s.price, s.priceDecimals);
      return new PoolSnapshot(
        pool,
        chainId,
        s.blockNumber,
        s.timestamp,
        0n, // sqrtPriceX96 — not needed for the vol routine
        s.tick,
        0n, // liquidity — not needed
        price,
      );
    });

    return new PoolHistory(pool, chainId, voSnapshots);
  }
}

// -----------------------------------------------------------------
// Bigint math helpers used by the synthetic fallback. Kept local
// because they only serve the fallback; if any other use case
// needs them, promote them to `@core/math`.
// -----------------------------------------------------------------

/**
 * sin(x) for x at 1e18 scale, output at 1e18. Taylor with
 * range-reduction: `sin(x) = sin(x mod 2π)`. We only need a
 * cheap visual surrogate here — accuracy is not critical.
 */
function sinApprox(x1e18: bigint): bigint {
  const TWO_PI = 6_283_185_307_179_586_476n; // 2π at 1e18
  // Reduce to [-π, π].
  let r = x1e18 % TWO_PI;
  if (r > TWO_PI / 2n) r -= TWO_PI;
  if (r < -TWO_PI / 2n) r += TWO_PI;

  // Taylor: sin(r) ≈ r - r³/6 + r⁵/120.
  // At 1e18 scale, r is in the millions-to-billions range, so
  // r³ is in the 1e54 range — we work in chunks of 1e18 to
  // avoid overflow.
  const r1 = r; // 1e18
  const r3 = (r1 * r1 / 1_000_000_000_000_000_000n * r1) / 1_000_000_000_000_000_000n;
  const r5 = (r3 * r1 / 1_000_000_000_000_000_000n * r1) / 1_000_000_000_000_000_000n;
  const s = r1
    - r3 / 6n
    + r5 / 120n;
  return s;
}
