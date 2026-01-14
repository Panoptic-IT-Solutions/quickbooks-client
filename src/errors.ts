/**
 * QuickBooks Error Handling
 */

/** Error codes for QuickBooks API errors */
export const QB_ERROR_CODES = {
  TOKEN_EXPIRED: "QB_TOKEN_EXPIRED",
  REFRESH_FAILED: "QB_REFRESH_FAILED",
  UNAUTHORIZED: "QB_UNAUTHORIZED",
  INVALID_REALM: "QB_INVALID_REALM",
  API_ERROR: "QB_API_ERROR",
  RATE_LIMIT: "QB_RATE_LIMIT",
  NETWORK_ERROR: "QB_NETWORK_ERROR",
  INVALID_CONFIG: "QB_INVALID_CONFIG",
  TOKEN_STORE_ERROR: "QB_TOKEN_STORE_ERROR",
} as const;

export type QuickBooksErrorCode = (typeof QB_ERROR_CODES)[keyof typeof QB_ERROR_CODES];

/** Custom error class for QuickBooks-related errors */
export class QuickBooksError extends Error {
  constructor(
    message: string,
    public code: QuickBooksErrorCode,
    public status?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "QuickBooksError";
  }
}

/** Handle and normalize errors from QuickBooks API */
export function handleQuickBooksError(error: unknown): QuickBooksError {
  // Already a QuickBooksError
  if (error instanceof QuickBooksError) {
    return error;
  }

  // Handle fetch/network errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return new QuickBooksError(
      "Network error connecting to QuickBooks API",
      QB_ERROR_CODES.NETWORK_ERROR,
      0,
      error
    );
  }

  // Handle HTTP response errors
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    // Check for status code
    if (typeof err.status === "number") {
      if (err.status === 401) {
        return new QuickBooksError(
          "Unauthorized access to QuickBooks API",
          QB_ERROR_CODES.UNAUTHORIZED,
          401,
          error
        );
      }

      if (err.status === 403) {
        return new QuickBooksError(
          "Access forbidden - check API permissions",
          QB_ERROR_CODES.UNAUTHORIZED,
          403,
          error
        );
      }

      if (err.status === 429) {
        return new QuickBooksError(
          "QuickBooks API rate limit exceeded",
          QB_ERROR_CODES.RATE_LIMIT,
          429,
          error
        );
      }
    }

    // Check for token-related error messages
    const message = String(err.message || "");
    if (message.includes("token expired") || message.includes("invalid_token")) {
      return new QuickBooksError(
        "QuickBooks token expired",
        QB_ERROR_CODES.TOKEN_EXPIRED,
        401,
        error
      );
    }
  }

  // Default error
  return new QuickBooksError(
    "An unexpected error occurred with QuickBooks integration",
    QB_ERROR_CODES.API_ERROR,
    500,
    error
  );
}
