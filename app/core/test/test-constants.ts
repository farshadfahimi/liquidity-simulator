// app/core/test/test-constants.ts

/**
 * Shared constants across the test suite. Lives under
 * `app/core/test/` (per AGENT.md §11.2) and is imported by
 * sibling test files. Not a test file itself (no `.test.ts`
 * suffix) so Vitest's `include` glob ignores it.
 */

export const PRICE_DECIMALS = 18;
