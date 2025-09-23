/**
 * Error handling utilities
 */

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getErrorStack(error: unknown): string {
  if (error instanceof Error && error.stack) {
    return error.stack;
  }
  return String(error);
}

export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export function handleAsyncError(error: unknown): void {
  console.error('Async error:', getErrorMessage(error));
  console.error('Stack:', getErrorStack(error));
}
