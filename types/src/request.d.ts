/**
 * Central HTTP layer for all LI.FI API calls, modeled on the LI.FI SDK's
 * request() wrapper (packages/sdk/src/utils/request.ts) with the SDK's
 * status-to-error classification (packages/sdk/src/errors/httpError.ts).
 *
 * Transient failures — network errors, timeouts, 5xx, and 429 — are retried
 * with exponential backoff (Retry-After is honored for 429). All other
 * responses fail immediately with the endpoint's error class. A response
 * without a status code is treated as non-retryable.
 *
 * @param {string} url - Full request URL including query string.
 * @param {RequestOptions} [options] - Timeout, retry, and error-classification options.
 * @returns {Promise<any>} Parsed JSON response body.
 * @throws {LifiTimeoutError} If an attempt exceeds the timeout and retries are exhausted.
 * @throws {LifiNetworkError} If a network-level failure persists after retries.
 * @throws {LifiRateLimitError} If the API keeps returning 429 after retries.
 * @throws {LifiSlippageError} If the API returns 409 — the quote is stale and a new one is needed.
 */
export function request(url: string, options?: RequestOptions): Promise<any>;
/**
 * Options for a LI.FI API request.
 */
export type RequestOptions = {
    /**
     * - HTTP headers to send, such as the integrator and API key headers.
     */
    headers?: Record<string, string> | undefined;
    /**
     * - Timeout in ms per attempt (default: 30,000).
     */
    timeout?: number | undefined;
    /**
     * - Extra attempts on transient failures (default: 1; 0 disables retries).
     */
    retries?: number | undefined;
    /**
     * - Base backoff delay in ms, doubled per attempt and capped at 5,000 (default: 500).
     */
    retryDelay?: number | undefined;
    /**
     * - Error constructor for non-transient endpoint failures (default: LifiProtocolError).
     */
    errorClass?: (new (message: string) => Error) | undefined;
    /**
     * - Prefix for endpoint failure messages (default: 'LI.FI request failed').
     */
    errorPrefix?: string | undefined;
    /**
     * - Hint appended to endpoint failure messages, e.g. a recovery suggestion.
     */
    errorSuffix?: string | undefined;
};
