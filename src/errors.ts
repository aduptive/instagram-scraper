/**
 * Custom class for Instagram scraping errors
 */
export class ScrapeError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ScrapeError';

    // Required for proper functioning with classes extending Error in TypeScript
    Object.setPrototypeOf(this, ScrapeError.prototype);
  }

  /**
   * Rate limit exceeded error
   */
  static rateLimited(): ScrapeError {
    return new ScrapeError(
      'Too many requests. Please try again later.',
      'RATE_LIMITED',
      429
    );
  }

  /**
   * Profile not found error
   */
  static profileNotFound(username: string): ScrapeError {
    return new ScrapeError(
      `Profile '${username}' not found`,
      'PROFILE_NOT_FOUND',
      404
    );
  }

  /**
   * Error when parsing Instagram data
   */
  static parseError(): ScrapeError {
    return new ScrapeError('Failed to parse Instagram data', 'PARSE_ERROR');
  }

  /**
   * Network connection error
   */
  static networkError(details?: string): ScrapeError {
    return new ScrapeError(
      `Network error${details ? `: ${details}` : ''}`,
      'NETWORK_ERROR'
    );
  }

  /**
   * Request timeout error
   */
  static timeout(): ScrapeError {
    return new ScrapeError('Request timed out', 'TIMEOUT', 408);
  }

  /**
   * Access denied to Instagram error
   */
  static accessDenied(): ScrapeError {
    return new ScrapeError(
      'Access to Instagram was denied',
      'ACCESS_DENIED',
      403
    );
  }

  /**
   * Instagram server error
   */
  static serverError(): ScrapeError {
    return new ScrapeError('Instagram server error', 'SERVER_ERROR', 500);
  }

  /**
   * Invalid scraper configuration error
   */
  static invalidConfig(detail: string): ScrapeError {
    return new ScrapeError(
      `Invalid configuration: ${detail}`,
      'INVALID_CONFIG'
    );
  }

  /**
   * Checks if an error is an instance of ScrapeError
   */
  static isScrapeError(error: unknown): error is ScrapeError {
    return error instanceof ScrapeError;
  }

  /**
   * Returns an object with error information
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
    };
  }
}
