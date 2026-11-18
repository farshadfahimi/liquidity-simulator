// app/utils/strategySelection.ts
//
// Pure helpers for picking WHICH ranked strategy the Charts tab
// overlays on the price chart.
//
// Why a separate module: `ChartsTab.vue` needs three decisions
// that are easy to get subtly wrong —
//
//   1. which row is "selected" (the id may be stale),
//   2. what the dropdown items look like,
//   3. what the dropdown's current label says.
//
// All three are pure functions of the ranked list + the stored id,
// so they live here where they can be unit-tested without mounting
// the SFC (same rationale as `app/utils/priceChart.ts`).

/** Minimal shape every ranked recommendation row satisfies. */
export interface ISelectableStrategy {
  /** Stable id: `"{strategyId}:{rangeDescriptor}"`. */
  readonly id: string;
  /** Human-readable strategy name (may repeat across rows). */
  readonly strategyName: string;
  /** Score at `SCORE_SCALE` (1e18 == 1.0). */
  readonly score: bigint;
}

/** One dropdown item. */
export interface IStrategyOption {
  label: string;
  value: string;
}

/** Score scale used by the recommendation engine (1e18 == 1.0). */
const SCORE_SCALE = 1e18;

/**
 * Resolve the row the user picked.
 *
 * Rules:
 *   - No rows → `null` (nothing to select).
 *   - No id stored yet → the FIRST row (the top-1, since the
 *     engine sorts by score descending).
 *   - Stored id present in the list → that row.
 *   - Stored id NOT in the list (the pool changed, or the
 *     candidate set was recomputed) → fall back to the top-1
 *     instead of rendering an empty chart.
 *
 * We key on the recommendation `id` rather than an index because
 * indices shift whenever the candidate set changes.
 */
export function selectStrategyEntry<T extends ISelectableStrategy>(
  rows: readonly T[],
  selectedId: string | null,
): T | null {
  if (rows.length === 0) return null;
  if (selectedId) {
    const match = rows.find(r => r.id === selectedId);
    if (match) return match;
  }
  return rows[0]!;
}

/**
 * Build the dropdown items — one per ranked row.
 *
 * The rank and the score are part of the label because the same
 * `strategyName` can show up on several rows (the engine scores
 * every candidate range for every strategy), so the name alone is
 * not unique enough to tell two entries apart.
 */
export function buildStrategyOptions<T extends ISelectableStrategy>(
  rows: readonly T[],
): IStrategyOption[] {
  return rows.map((r, i) => ({
    label: `#${i + 1} ${r.strategyName} — score ${(Number(r.score) / SCORE_SCALE).toFixed(4)}`,
    value: r.id,
  }));
}

/**
 * Label of the currently applied strategy, e.g. `"#2 Narrow 2%"`.
 *
 * The rank is recomputed from the row's position in the ranked
 * list, so it stays correct even when the selection was resolved
 * through the top-1 fallback.
 */
export function strategyDisplayLabel<T extends ISelectableStrategy>(
  rows: readonly T[],
  entry: T | null,
): string {
  if (!entry) return 'no strategy';
  const index = rows.findIndex(r => r.id === entry.id);
  return `#${index + 1} ${entry.strategyName}`;
}
