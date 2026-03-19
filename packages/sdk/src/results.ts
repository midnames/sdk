import { MidnamesError } from "./errors.js";

export type Result<T, E = MidnamesError> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E };

// Helper functions for Result type
export function success<T, E = MidnamesError>(data: T): Result<T, E> {
  return { success: true, data };
}

export function failure<E = MidnamesError>(error: E): Result<never, E> {
  return { success: false, error };
}

// Enhanced pattern matching for Results
export function match<T, E, U>(
  result: Result<T, E>,
  patterns: {
    success: (data: T) => U;
    error: (error: E) => U;
  }
): U {
  if (result.success) {
    return patterns.success(result.data);
  } else {
    return patterns.error(result.error);
  }
}

// Transform success value, keep error unchanged
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (data: T) => U
): Result<U, E> {
  return result.success
    ? success<U, E>(fn(result.data))
    : (result as Result<U, E>);
}

// Chain operations that can fail
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (data: T) => Result<U, E>
): Result<U, E> {
  return result.success ? fn(result.data) : result;
}

// Transform error, keep success unchanged
export function mapError<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  return result.success ? result : failure(fn(result.error));
}

// Recover from error with a fallback value
export function recover<T, E>(
  result: Result<T, E>,
  fn: (error: E) => T
): Result<T, never> {
  return result.success ? result : success<T, never>(fn(result.error));
}

// Async result helpers
export async function wrapAsync<T>(
  asyncFn: () => Promise<T>
): Promise<Result<T>> {
  try {
    const data = await asyncFn();
    return success(data);
  } catch (error) {
    if (error instanceof MidnamesError) {
      return failure(error);
    }
    return failure(
      new MidnamesError(
        error instanceof Error ? error.message : String(error),
        "UNKNOWN_ERROR",
        error
      )
    );
  }
}

// Chainable Result class for fluent API
export class ResultChain<T, E = MidnamesError> {
  constructor(private result: Result<T, E>) {}

  map<U>(fn: (data: T) => U): ResultChain<U, E> {
    return new ResultChain(map(this.result, fn));
  }

  flatMap<U>(fn: (data: T) => Result<U, E>): ResultChain<U, E> {
    return new ResultChain(flatMap(this.result, fn));
  }

  mapError<F>(fn: (error: E) => F): ResultChain<T, F> {
    return new ResultChain(mapError(this.result, fn));
  }

  recover(fn: (error: E) => T): ResultChain<T, never> {
    return new ResultChain(recover(this.result, fn));
  }

  match<U>(patterns: { success: (data: T) => U; error: (error: E) => U }): U {
    return match(this.result, patterns);
  }

  unwrap(): Result<T, E> {
    return this.result;
  }
}

// Helper function to start chain
export function chain<T, E = MidnamesError>(
  result: Result<T, E>
): ResultChain<T, E> {
  return new ResultChain(result);
}

// Combine multiple Results
export function combine<T extends readonly unknown[], E>(results: {
  [K in keyof T]: Result<T[K], E>;
}): Result<T, E> {
  const data: unknown[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result.success) {
      return result as Result<T, E>;
    }
    data[i] = result.data;
  }

  return success<T, E>(data as unknown as T);
}
