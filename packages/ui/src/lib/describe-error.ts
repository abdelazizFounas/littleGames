/**
 * Turns whatever a failed call threw into something worth showing a player.
 *
 * The Nakama SDK rejects with several unrelated shapes depending on where the
 * failure happened — an `Error` for network faults, a parsed body carrying a
 * `message` for API errors, a bare `Response` for others. Normalising them in
 * one place keeps every form from having to guess.
 */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string' && error.message.length > 0) {
      return error.message;
    }
    if (
      'statusText' in error &&
      typeof error.statusText === 'string' &&
      error.statusText.length > 0
    ) {
      return error.statusText;
    }
  }

  return fallback;
}
