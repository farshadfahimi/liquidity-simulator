// app/core/application/use_cases/get_pool_history.use_case.ts

import { AnalyticsEngine } from '../../domains/analytics';
import { PoolHistory, PoolSnapshot } from '../../domains/history';
import { Pool } from '../../domains/pool';
import { Price, sqrtPriceX96ToPrice } from '../../shared/value_objects';
import type { TAddress } from '../../shared/types';
import type { IRpcProvider } from '../../providers/rpc';
import type { IProtocolAdapter } from '../../adapters/protocol_adapter.interface';
import { bigintExp } from '../../math';
import {
  ALL_TIMEFRAMES,
  HistoryAggregator,
} from '../../domains/aggregation';
import type { TCandleTimeframe } from '../../domains/aggregation';
import { InvalidUseCaseInputError } from '../errors/invalid_input_error';
import type { TAdapterResolver } from './adapter_resolver.type';
import type {
  IPoolHistoryDTO,
  IHistorySnapshotDTO,
} from '../dtos/pool_history.dto';
import type { IHistoryCandleDTO, IHistoryCandleMap } from '../dtos/candle.dto';

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
   * Time window the chart should span.
   *
   * - `kind: 'days'` — walk back roughly `days × 86400` seconds. The
   *   use case derives `numSnapshots` and `blockStep` automatically
   *   from the chain's average block time, capped at
   *   {@link MAX_AUTO_SNAPSHOTS} points so the RPC cost stays
   *   predictable. Use this for the 14d / 30d / 90d UI selector.
   * - `kind: 'snapshots'` — keep the legacy block-count-based window.
   *   The use case walks `numSnapshots` recent blocks spaced by
   *   `blockStep`. Use this when you want a fixed chart resolution
   *   (e.g. test fixtures).
   *
   * When `window` is omitted, the use case falls back to the
   * `numSnapshots` + `blockStep` fields (legacy behaviour). When
   * both are supplied, `window` wins.
   */
  readonly window?: THistoryWindow;

  /**
   * How many snapshots to fetch. Legacy field — use `window` instead.
   * The use case walks the most recent `numSnapshots` blocks spaced
   * by `blockStep`. Default 60 — gives ~40 minutes of Ethereum
   * mainnet data at 12s blocks (`blockStep = 200`). Fetches are
   * issued in parallel, so a smaller window only trims the chart,
   * not the latency.
   */
  readonly numSnapshots?: number;

  /**
   * Block distance between consecutive snapshots. Legacy field —
   * use `window` instead. The use case picks a sensible default per
   * chain when omitted.
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

  /**
   * Whether the use case should pre-aggregate the snapshot
   * stream into OHLC candles for the six standard timeframes
   * (`'1m' | '5m' | '15m' | '1h' | '4h' | '1d'`).
   *
   * - `false` (default) — `IPoolHistoryDTO.candles` is `null` and
   *   the UI falls back to the raw per-block `snapshots` series.
   * - `true` — the use case aggregates the *full* snapshot stream
   *   into all six timeframes. This is the natural shape for any
   *   candlestick chart (TradingView, lightweight-charts,
   *   Chart.js) and for stop-loss / take-profit detection in the
   *   simulation layer.
   * - An explicit `TCandleTimeframe[]` — only the listed
   *   timeframes are populated. The other entries are empty
   *   arrays. Use this when the chart only needs one resolution.
   *
   * Aggregation is pure and runs in microseconds for typical
   * stream sizes (≤ 200 snapshots). The candles are derived
   * from the same sorted stream as `snapshots`, so the
   * open/close/high/low values line up bit-for-bit with the raw
   * points in the same bucket.
   *
   * The synthetic fallback also produces candles when this
   * flag is set — the UI gets a consistent shape regardless of
   * whether the underlying RPC exposes archive state.
   */
  readonly withCandles?: boolean | readonly TCandleTimeframe[];
}

/**
 * Per-chain default block step (in blocks). These are picked so
 * `numSnapshots=60` gives a useful chart window without flooding
 * the public RPC. The same value is fine for any V3 / V3-compatible
 * chain — these constants are block counts, not seconds.
 */
const DEFAULT_BLOCK_STEP: Readonly<Record<number, bigint>> = {
  1: 200n, // Ethereum mainnet — 12s blocks, ~40 min total window
  42161: 200n, // Arbitrum — ~0.25s blocks, ~50s total (mostly noise)
  8453: 600n, // Base — 2s blocks, ~20 min total
  146: 600n, // Sonic — 2s blocks, ~20 min total
};

/**
 * Approximate block time per chain (in seconds). Used by the
 * day-based window to translate "give me 14 days" into "walk back
 * N blocks". Values are deliberately conservative (slightly *slower*
 * than reality) so the chart window is at least as wide as the
 * user asked for.
 */
const BLOCK_TIME_SECONDS: Readonly<Record<number, number>> = {
  1: 12, // Ethereum mainnet
  42161: 1, // Arbitrum (real ≈ 0.25s; we round up so window is generous)
  8453: 2, // Base
  146: 2, // Sonic
};

/** Hard cap on snapshots for the auto-derived window. */
const MAX_AUTO_SNAPSHOTS = 200;

/**
 * One full sine cycle spans this many seconds of real time, so a
 * 14-day chart shows the same wavelength as a 30-day chart (a
 * weekly-ish swing), and a 90-day chart shows roughly 30 weekly
 * cycles. Without this, the cycle period scales with `n` and every
 * window collapses to the same shape.
 */
const SYNTHETIC_CYCLE_SECONDS: bigint = 3n * 86_400n; // 3 days

/** Synthetic fallback target step size — one snapshot per ~1.5h. */
const SYNTHETIC_TARGET_STEP_SECONDS = 5400n;

/**
 * Cap on synthetic snapshot count so a 90-day window doesn't
 * explode the chart (90d × 24h / 1.5h = 1440 points, plenty).
 */
const SYNTHETIC_MAX_SNAPSHOTS = 500;
const SYNTHETIC_MIN_SNAPSHOTS = 60;

const SYNTHETIC_DEFAULT_SIGMA: bigint = 500_000_000_000_000_000n; // 50% annual

const DEFAULT_NUM_SNAPSHOTS = 60;
const DEFAULT_MAX_SNAPSHOTS = 200;

/**
 * How "flat" a series must be before we call it visually dead and
 * switch to the synthetic GBM fallback. 5 basis points (0.05%) of
 * total drift means the user's eye cannot resolve any movement on
 * a chart whose y-axis is auto-scaled to the data range. Many
 * public RPCs return a series that drifts by a few ULPs across
 * blocks — bit-identical checks miss these but a flatness check
 * catches them.
 */
const FLAT_THRESHOLD_BPS = 5n;

/**
 * Detect a "visually dead" snapshot series — either bit-identical
 * (RPC returned the same slot for every historical block) or
 * within {@link FLAT_THRESHOLD_BPS} of the first observation
 * (drifting-but-pretty-much-flat, common on archive-less RPCs).
 *
 * Returns `{ flat, reason }` so the caller can pass the reason
 * through to the synthetic fallback's `sourceDetail`.
 *
 * Exported so the regression test (`get_pool_history.test.ts`
 * exercises the on-chain path against a live RPC) can also unit
 * the pure flat-detection logic in isolation.
 */
export function isFlatSeries(
  snapshots: readonly IHistorySnapshotDTO[],
): { flat: boolean; reason: string } {
  if (snapshots.length < 2) {
    return { flat: true, reason: 'fewer than 2 snapshots — on-chain fetch produced no trend' };
  }
  const first = snapshots[0]!;
  const allSame = snapshots.every(
    (s) => s.price === first.price && s.tick === first.tick,
  );
  if (allSame) {
    return {
      flat: true,
      reason: 'on-chain fetch returned identical state for every block (RPC lacks archive state)',
    };
  }
  const base = first.price;
  const flatThreshold = base === 0n
    ? 0n
    : (base * FLAT_THRESHOLD_BPS) / 10000n;
  const nearFlat = snapshots.every(
    (s) => s.price > base - flatThreshold && s.price < base + flatThreshold,
  );
  if (nearFlat) {
    return {
      flat: true,
      reason: `on-chain fetch is visually flat (all snapshots within ${FLAT_THRESHOLD_BPS}bps — RPC lacks archive state)`,
    };
  }
  return { flat: false, reason: '' };
}

/**
 * How the chart window is defined. Discriminated union so the use
 * case can pick the right resolver at runtime and the UI can pass
 * either kind without ambiguity.
 */
export type THistoryWindow =
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'snapshots'; readonly numSnapshots: number; readonly blockStep?: bigint };

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

    // Resolve the snapshot plan. `window` wins when supplied;
    // otherwise we fall back to the legacy `numSnapshots` +
    // `blockStep` fields. The same maxSnapshots cap applies to
    // both paths so a runaway days-window can't exhaust the RPC.
    const resolved = this.resolveWindow(input);
    const numSnapshots = resolved.numSnapshots;
    const blockStep = resolved.blockStep;
    const targetWindowSeconds = resolved.targetWindowSeconds;

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
          targetWindowSeconds,
          'on-chain fetch returned fewer than 2 snapshots',
          input.withCandles,
        );
      }

      const history = this.buildDomainHistory(
        snapshots,
        input.pool,
        input.chainId,
      );
      // Detect "the RPC silently returned the latest slot for every
      // historical block" — this happens when the public RPC doesn't
      // have archive state but the multicall still succeeds with the
      // cached latest. Two flavours:
      //   1) bit-identical (price AND tick equal across snapshots)
      //   2) near-flat: every price is within FLAT_THRESHOLD of the
      //      first one. Many public RPCs return a drifting-but-pretty-
      //      much-flat series (a few ULP changes between blocks).
      // Both produce a visually dead chart, so both fall through to
      // the synthetic GBM path. (The synthetic fallback's
      // `source: 'synthetic'` is preserved so the UI can badge the
      // chart.)
      const flatness = isFlatSeries(snapshots);
      if (flatness.flat) {
        return this.syntheticFallback(
          adapter,
          currentPrice,
          latestPool.state.tick,
          input.chainId,
          input.protocolId ?? adapter.id,
          input.pool,
          priceDecimals,
          input.annualizedVolatilityOverride,
          targetWindowSeconds,
          flatness.reason,
          input.withCandles,
        );
      }

      // We've ruled out the flat-RPC case above, so we have at
      // least two distinct log-returns — `volatilityFromHistory`
      // (which divides by `n−1`) is safe to call.
      const vol = this.analytics.volatilityFromHistory(history);
      const first = snapshots[0]!;
      const last = snapshots[snapshots.length - 1]!;

      return {
        pool: input.pool,
        chainId: input.chainId,
        protocolId: input.protocolId ?? adapter.id,
        source: 'on-chain',
        sourceDetail: `walked ${snapshots.length} blocks at step ${blockStep}`,
        snapshots,
        candles: this.buildCandles(snapshots, input.withCandles),
        fromBlock: first.blockNumber,
        toBlock: last.blockNumber,
        historyWindowSeconds: last.timestamp - first.timestamp,
        annualizedVolatility: vol.volAnnual,
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
        targetWindowSeconds,
        err instanceof Error ? err.message : String(err),
        input.withCandles,
      );
    }
  }

  // -----------------------------------------------------------------
  // Internal — window resolution
  // -----------------------------------------------------------------

  /**
   * Translate the `window` / legacy fields into concrete
   * `{ numSnapshots, blockStep, targetWindowSeconds }`. Always
   * capped so a hostile UI value can't exhaust the RPC.
   */
  private resolveWindow(input: IGetPoolHistoryInput): {
    readonly numSnapshots: number;
    readonly blockStep: bigint;
    /** How many seconds the synthetic fallback should span. */
    readonly targetWindowSeconds: bigint;
  } {
    const maxSnapshots = input.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;

    // Day-based window — translate via the chain's average block
    // time, then back-fill `numSnapshots` / `blockStep`.
    if (input.window?.kind === 'days') {
      const days = Math.max(1, Math.floor(input.window.days));
      const blockTime = BLOCK_TIME_SECONDS[input.chainId] ?? 12;
      const totalSeconds = days * 86_400;
      const totalBlocks = Math.max(1, Math.floor(totalSeconds / blockTime));
      // We want roughly one snapshot per (totalBlocks / cap)
      // blocks — that gives us `min(cap, totalBlocks)` evenly
      // spaced points covering the whole window.
      const cap = Math.min(MAX_AUTO_SNAPSHOTS, maxSnapshots);
      const n = Math.min(cap, totalBlocks);
      const blockStep = BigInt(Math.max(1, Math.floor(totalBlocks / n)));
      return {
        numSnapshots: n,
        blockStep,
        targetWindowSeconds: BigInt(totalSeconds),
      };
    }

    if (input.window?.kind === 'snapshots') {
      const n = Math.max(2, Math.min(input.window.numSnapshots, maxSnapshots));
      const step = input.window.blockStep
        ?? DEFAULT_BLOCK_STEP[input.chainId]
        ?? 200n;
      // We don't know the chain's avg block time from the input
      // alone, so estimate the window from the default step table.
      const blockTime = BLOCK_TIME_SECONDS[input.chainId] ?? 12;
      const totalSeconds = Number(step) * (n - 1) * blockTime;
      return {
        numSnapshots: n,
        blockStep: step,
        targetWindowSeconds: BigInt(Math.max(0, totalSeconds)),
      };
    }

    // Legacy: numSnapshots + blockStep (or defaults).
    const numSnapshots = Math.max(
      2,
      Math.min(input.numSnapshots ?? DEFAULT_NUM_SNAPSHOTS, maxSnapshots),
    );
    const blockStep = input.blockStep
      ?? DEFAULT_BLOCK_STEP[input.chainId]
      ?? 200n;
    const blockTime = BLOCK_TIME_SECONDS[input.chainId] ?? 12;
    const totalSeconds = Number(blockStep) * (numSnapshots - 1) * blockTime;
    return {
      numSnapshots,
      blockStep,
      targetWindowSeconds: BigInt(Math.max(0, totalSeconds)),
    };
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

    // Issue every (state + block) pair in parallel. With 30
    // snapshots on a public mainnet RPC this turns ~15s of
    // sequential round-trips into a single batch of ~1s.
    const snapshots = await Promise.all(
      blockNumbers.map(async (blockNumber) => {
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

        return {
          blockNumber,
          timestamp: block.timestamp,
          tick: pinned.tick,
          price: price.value,
          priceDecimals: price.decimals,
        };
      }),
    );

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
    targetWindowSeconds: bigint,
    reason: string,
    withCandles?: boolean | readonly TCandleTimeframe[],
  ): IPoolHistoryDTO {
    // Derive the point count from the *window* (not from a fixed
    // SYNTHETIC_NUM_SNAPSHOTS), so a 14-day chart and a 90-day
    // chart actually have different lengths and different shapes.
    const totalSeconds = targetWindowSeconds > 0n
      ? targetWindowSeconds
      : SYNTHETIC_TARGET_STEP_SECONDS * 200n; // legacy fallback
    // Target step = 1.5h, clamped to [60, 500] points.
    let n = Number(totalSeconds / SYNTHETIC_TARGET_STEP_SECONDS);
    n = Math.max(SYNTHETIC_MIN_SNAPSHOTS, Math.min(SYNTHETIC_MAX_SNAPSHOTS, n));
    const stepSeconds = totalSeconds / BigInt(n);

    const sigma = annualizedVolatilityOverride ?? SYNTHETIC_DEFAULT_SIGMA;
    // sigmaStep = σ * sqrt(stepSeconds / secondsPerYear) at 1e18 scale.
    const secondsPerYear = 31_536_000n;
    const ratio1e18 = (stepSeconds * 1_000_000_000_000_000_000n) / secondsPerYear;
    const SQRT_STEP_FRAC = integerSqrt1e18(ratio1e18);
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

    // Drive the cycle period from real-time seconds, NOT from
    // `n`. Otherwise a 14-day chart and a 30-day chart (both
    // rendered with similar `n`) show the same wave shape, just
    // compressed/stretched on the x-axis. Locking the period to
    // `3 days` means: 14d window ≈ 4.6 cycles, 30d ≈ 10 cycles,
    // 90d ≈ 30 cycles — visibly different.
    const TWO_PI = 6_283_185_307_179_586_476n;
    const cyclePeriodBig = SYNTHETIC_CYCLE_SECONDS;
    // radians-per-second at 1e18 scale. To evaluate sin(2π·t/T)
    // for `t` in seconds, we compute
    //   cycleArg = (TWO_PI · t · 1e18) / T
    // which is what `sinApprox` expects.
    const cycleAmp = 500_000_000_000_000_000n; // ±50% in log space
    const driftAmp = 300_000_000_000_000_000n; // ±15% in log space

    for (let i = 0; i <= n; i++) {
      // `t` is *absolute seconds from now*; we use it as the
      // argument of the sin so the wavelength is locked in real
      // time rather than in snapshot count.
      const t = (BigInt(i) - BigInt(n)) * stepSeconds;
      const posFrac = (BigInt(i) * 1_000_000_000_000_000_000n) / BigInt(n);
      const drift = ((posFrac - 500_000_000_000_000_000n) * driftAmp) / 1_000_000_000_000_000_000n;
      // sin(2π · t / T), all at 1e18 scale.
      const cycleArg = (TWO_PI * t) / cyclePeriodBig;
      const cycle = sinApprox(cycleArg) * cycleAmp / 1_000_000_000_000_000_000n;
      const noise = ((seedBase * BigInt(i * 13 + 7)) % 1_000_000_000n)
        * sigmaStep / 1_000_000_000n;
      const logReturn = drift + cycle + noise;

      // price_i = price_0 * exp(logReturn)
      const factor = bigintExp(logReturn, 18);
      const priceValue = (p0 * factor) / 1_000_000_000_000_000_000n;

      snapshots.push({
        blockNumber: 0n,
        timestamp: now + t,
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
      candles: this.buildCandles(snapshots, withCandles),
      fromBlock: 0n,
      toBlock: 0n,
      historyWindowSeconds: totalSeconds,
      annualizedVolatility: sigma,
    };
  }

  // -----------------------------------------------------------------
  // Internal — helpers
  // -----------------------------------------------------------------

  /**
   * Aggregate a snapshot stream into OHLC candles for the
   * requested timeframes. Returns `null` when the caller didn't
   * ask for candles (`withCandles` falsy) so the field on the
   * DTO can use the `null | IHistoryCandleMap` shape without
   * allocating an empty `Record`.
   *
   * Selective mode (`withCandles: TCandleTimeframe[]`) returns a
   * full {@link IHistoryCandleMap} with the unrequested
   * timeframes set to `[]`. This is the shape the UI wants when
   * it iterates the map to render a timeframe selector — every
   * key is always present so the dropdown can be `v-for` over
   * the map without conditionals.
   *
   * `false` and `undefined` both disable aggregation; we
   * accept either to keep the call sites free of `?? false`
   * noise.
   *
   * The aggregator is instantiated per-call rather than held on
   * the instance so the helper is trivially testable in
   * isolation and we don't share mutable state across
   * concurrent `execute()` calls (the class is pure today, but
   * keeping the instance isolated is cheap insurance against
   * future caching).
   */
  private buildCandles(
    snapshots: readonly IHistorySnapshotDTO[],
    withCandles: boolean | readonly TCandleTimeframe[] | undefined,
  ): IHistoryCandleMap | null {
    if (!withCandles) return null;
    if (snapshots.length === 0) {
      // Caller asked for candles but the underlying stream is
      // empty. Return a fully-populated, all-empty map so the
      // UI's "for each timeframe" iteration doesn't have to
      // special-case the null path. This matches the selective
      // mode contract: every key present, all empty.
      return this.emptyCandleMap(withCandles);
    }

    const aggregator = new HistoryAggregator();
    const aggInput = snapshots.map((s) => ({
      timestamp: s.timestamp,
      price: s.price,
      priceDecimals: s.priceDecimals,
    }));

    const selected = withCandles === true
      ? ALL_TIMEFRAMES
      : (withCandles as readonly TCandleTimeframe[]);

    const out = {} as Record<TCandleTimeframe, readonly IHistoryCandleDTO[]>;
    for (const tf of selected) {
      // Translate the domain value object into the wire DTO.
      // The shapes are intentionally near-identical; the
      // difference is `timeframe` (which lives on the candle
      // class, not the DTO's enclosing record) and the
      // trailing OHLC fields. We map field-for-field rather
      // than returning the domain class directly because the
      // application layer never leaks domain types past its
      // boundary — the chart, the SL/TP detector, and any
      // downstream consumer must work with the plain DTO.
      const candles = aggregator.aggregate(aggInput, tf);
      out[tf] = candles.map((c) => ({
        timeframe: c.timeframe,
        openTimestamp: c.openTimestamp,
        closeTimestamp: c.closeTimestamp,
        openPrice: c.openPrice,
        highPrice: c.highPrice,
        lowPrice: c.lowPrice,
        closePrice: c.closePrice,
        averagePrice: c.averagePrice,
        priceDecimals: c.priceDecimals,
        sampleCount: c.sampleCount,
      }));
    }

    // Ensure unselected timeframes are present as empty arrays
    // so the IHistoryCandleMap shape is stable.
    for (const tf of ALL_TIMEFRAMES) {
      if (!(tf in out)) out[tf] = [];
    }

    return out as IHistoryCandleMap;
  }

  /**
   * Build an all-timeframes, all-empty candle map. Used when
   * the caller asked for candles but the underlying stream is
   * empty — preserves the map's shape so the UI's iteration
   * doesn't need a null check.
   */
  private emptyCandleMap(
    withCandles: boolean | readonly TCandleTimeframe[],
  ): IHistoryCandleMap {
    const selected = withCandles === true
      ? ALL_TIMEFRAMES
      : (withCandles as readonly TCandleTimeframe[]);
    const out = {} as Record<TCandleTimeframe, readonly IHistoryCandleDTO[]>;
    for (const tf of selected) out[tf] = [];
    for (const tf of ALL_TIMEFRAMES) {
      if (!(tf in out)) out[tf] = [];
    }
    return out as IHistoryCandleMap;
  }

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

/**
 * Integer square root, input at 1e18 scale, output at 1e18 scale.
 * Newton's method, 60 iterations (more than enough for 256-bit
 * bigints at this scale). Used by the synthetic fallback to turn
 * a per-step σ ratio into a per-step σ without floating point.
 */
function integerSqrt1e18(x1e18: bigint): bigint {
  if (x1e18 <= 0n) return 0n;
  if (x1e18 === 1_000_000_000_000_000_000n) return 1_000_000_000_000_000_000n;
  // Initial guess: bit-length heuristic.
  let z = 1n;
  // Find the highest set bit.
  let y = x1e18;
  let bits = 0n;
  while (y > 0n) { y >>= 1n; bits += 1n; }
  // Start near the geometric mean: shift 1e18 by half the bit
  // count of x. Good enough for Newton to converge in ~10 steps.
  z = 10n ** 18n >> 1n;
  z <<= bits >> 1n;
  for (let i = 0; i < 60; i++) {
    if (z === 0n) break;
    const next = (z + (x1e18 * 1_000_000_000_000_000_000n) / z) >> 1n;
    if (next >= z) return z;
    z = next;
  }
  return z;
}
