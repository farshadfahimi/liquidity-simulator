// app/core/test/utils/strategySelection.test.ts
//
// Covers the "which strategy is overlaid on the chart" logic used
// by `ChartsTab.vue`. The tricky part is the FALLBACK semantics:
// the stored id can go stale (the pool changed, or the candidate
// set was recomputed), and the chart must never end up blank —
// it has to fall back to the top-1 row.
//
// The helpers live in `app/utils/strategySelection.ts` precisely
// so they can be tested here without mounting the SFC.

import { describe, it, expect } from 'vitest';

import {
  buildStrategyOptions,
  selectStrategyEntry,
  strategyDisplayLabel,
  type ISelectableStrategy,
} from '../../../utils/strategySelection';

/** Minimal ranked row. `score` is at SCORE_SCALE (1e18 == 1.0). */
function row(id: string, strategyName: string, score = 1): ISelectableStrategy {
  return { id, strategyName, score: BigInt(Math.round(score * 1e18)) };
}

const ROWS: ISelectableStrategy[] = [
  row('balanced:narrow', 'Balanced', 0.9),
  row('balanced:wide', 'Balanced', 0.5),
  row('max-fee:tight', 'Max fee', 0.7),
];

describe('strategySelection utility', () => {
  describe('selectStrategyEntry', () => {
    it('returns null when there are no rows', () => {
      expect(selectStrategyEntry([], 'anything')).toBeNull();
    });

    it('falls back to the top-1 when nothing is selected yet', () => {
      expect(selectStrategyEntry(ROWS, null)?.id).toBe('balanced:narrow');
    });

    it('returns the row matching the stored id', () => {
      expect(selectStrategyEntry(ROWS, 'max-fee:tight')?.id).toBe('max-fee:tight');
    });

    it('falls back to the top-1 when the stored id is stale', () => {
      // The pool changed / candidates were recomputed — the old id
      // is gone. We must not render an empty chart.
      expect(selectStrategyEntry(ROWS, 'gone:strategy')?.id).toBe('balanced:narrow');
    });

    it('is not confused by duplicate strategy names', () => {
      // Two rows share the name "Balanced" — the id, not the name,
      // is what identifies the selection.
      const picked = selectStrategyEntry(ROWS, 'balanced:wide');
      expect(picked?.id).toBe('balanced:wide');
      expect(picked?.strategyName).toBe('Balanced');
    });
  });

  describe('buildStrategyOptions', () => {
    it('produces one option per row, keyed by id', () => {
      const options = buildStrategyOptions(ROWS);
      expect(options).toHaveLength(3);
      expect(options.map(o => o.value)).toEqual([
        'balanced:narrow',
        'balanced:wide',
        'max-fee:tight',
      ]);
    });

    it('labels each option with its rank, name and score', () => {
      const options = buildStrategyOptions(ROWS);
      expect(options[0]!.label).toBe('#1 Balanced — score 0.9000');
      expect(options[1]!.label).toBe('#2 Balanced — score 0.5000');
      expect(options[2]!.label).toBe('#3 Max fee — score 0.7000');
    });

    it('returns an empty list for an empty ranking', () => {
      expect(buildStrategyOptions([])).toEqual([]);
    });
  });

  describe('strategyDisplayLabel', () => {
    it('shows the rank and the name of the applied row', () => {
      expect(strategyDisplayLabel(ROWS, ROWS[2]!)).toBe('#3 Max fee');
    });

    it('says "no strategy" when nothing is applied', () => {
      expect(strategyDisplayLabel(ROWS, null)).toBe('no strategy');
    });
  });
});
