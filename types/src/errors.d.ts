/** Base class for all errors thrown by the LI.FI Swidge protocol. */
export class LifiProtocolError extends Error {
    constructor(message: any, options: any);
}
/** Thrown when the module is misconfigured (missing provider, bad API key, etc.). */
export class LifiConfigurationError extends LifiProtocolError {
}
/** Thrown when the LI.FI quote API returns an error or an unusable response. */
export class LifiQuoteError extends LifiProtocolError {
}
/** Thrown when execution is rejected before any transaction is sent (fee cap exceeded, read-only account, etc.). */
export class LifiExecutionError extends LifiProtocolError {
}
/** Thrown when the LI.FI status API returns an error or the id is unknown. */
export class LifiStatusError extends LifiProtocolError {
}
/** Thrown when swidge() is called with a read-only or absent account. */
export class LifiReadOnlyAccountError extends LifiExecutionError {
}
/** Thrown when a chain name is not found in the supported chains map. */
export class LifiUnsupportedChainError extends LifiProtocolError {
}
/** Thrown when a LI.FI API request exceeds the configured timeout. */
export class LifiTimeoutError extends LifiProtocolError {
}
/** Thrown when a network-level fetch failure persists after all retries. */
export class LifiNetworkError extends LifiProtocolError {
}
/** Thrown when the LI.FI API returns 429 and retries are exhausted. */
export class LifiRateLimitError extends LifiProtocolError {
}
/** Thrown on HTTP 409 from the quote API: slippage exceeded the threshold, a fresh quote is needed. */
export class LifiSlippageError extends LifiQuoteError {
}
/** Thrown when user-supplied parameters or an API response fail validation before execution. */
export class LifiValidationError extends LifiProtocolError {
}
/** Thrown when the quote's transaction target or approval address is not in the trusted contract allowlist. */
export class LifiUntrustedContractError extends LifiExecutionError {
}
