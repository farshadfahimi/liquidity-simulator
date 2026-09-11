// app/core/application/errors/use_case_error.ts

/**
 * Base class for application-layer (use-case) errors. Use cases throw
 * subclasses of this when an orchestration step fails for a reason
 * that's specific to the use case (missing inputs, missing history,
 * empty results, etc.).
 *
 * Subclasses carry a stable `code` string so the UI / API layer can
 * pattern-match without `instanceof` chains.
 */
export abstract class UseCaseError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
