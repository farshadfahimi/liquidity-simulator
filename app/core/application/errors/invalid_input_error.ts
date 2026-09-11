// app/core/application/errors/invalid_input_error.ts

import { UseCaseError } from './use_case_error';

/**
 * Thrown when a use-case input is structurally invalid (e.g. negative
 * principal, unknown strategy id, tickLower ≥ tickUpper).
 */
export class InvalidUseCaseInputError extends UseCaseError {
  readonly code = 'invalid-input';

  constructor(
    public readonly useCase: string,
    public readonly field: string,
    message: string,
  ) {
    super(`[${useCase}] invalid input '${field}': ${message}`);
  }
}
