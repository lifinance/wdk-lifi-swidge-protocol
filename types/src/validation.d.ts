/**
 * Validates user-supplied swidge options before any API call is made.
 * Token identifiers may be contract addresses or symbols, so only presence
 * is enforced for them.
 *
 * @param {SwidgeOptions} options - User-supplied swidge options to validate.
 * @throws {LifiValidationError} If a token identifier is missing, the recipient is not a valid
 *   address, slippage is outside the 0-1 range, or no positive amount is provided.
 */
export function validateSwidgeOptions(options?: SwidgeOptions): void;
/**
 * Validates the transaction data returned by the LI.FI quote API before it is
 * forwarded to the wallet.
 *
 * Structural checks (valid target address, hex calldata, parseable amounts)
 * always run. When `config.trustedContracts` is set, the transaction target
 * and approval address must additionally be known LI.FI contracts — the LI.FI
 * SDK itself forwards these fields as-is, so the allowlist is opt-in to match.
 *
 * @param {LifiQuote} quote - Raw quote response from the LI.FI API.
 * @param {number} chainId - Source chain ID the transaction executes on.
 * @param {LifiSwidgeProtocolConfig} [config] - Effective protocol config; `trustedContracts` enables the allowlist check.
 * @throws {LifiValidationError} If the transaction request is structurally malformed (bad address, non-hex calldata, unparseable amounts).
 * @throws {LifiUntrustedContractError} If allowlisting is enabled and the target or approval address is not a known LI.FI contract.
 */
export function validateQuoteTransaction(quote: LifiQuote, chainId: number, config?: LifiSwidgeProtocolConfig): void;
export type SwidgeOptions = import("@tetherto/wdk-wallet/protocols").SwidgeOptions;
export type LifiSwidgeProtocolConfig = import("./lifi-swidge-protocol.js").LifiSwidgeProtocolConfig;
/**
 * Transaction prepared by the LI.FI quote API (subset validated by this module).
 */
export type LifiTransactionRequest = {
    /**
     * - Target contract address the wallet will call.
     */
    to: string;
    /**
     * - Hex-encoded calldata for the route.
     */
    data: string;
    /**
     * - Native token value to send, parseable as BigInt (default: 0).
     */
    value?: string | number | undefined;
    /**
     * - Gas limit hint, parseable as BigInt.
     */
    gasLimit?: string | number | undefined;
};
/**
 * Route estimate from the LI.FI quote API (subset validated by this module).
 */
export type LifiQuoteEstimate = {
    /**
     * - Contract the wallet must approve to spend the source token.
     */
    approvalAddress?: string | undefined;
    /**
     * - Whether LI.FI marked the route as not requiring an ERC-20 approval.
     */
    skipApproval?: boolean | undefined;
};
/**
 * Raw quote response from the LI.FI quote API (subset validated by this module).
 */
export type LifiQuote = {
    /**
     * - Prepared transaction to forward to the wallet.
     */
    transactionRequest: LifiTransactionRequest;
    /**
     * - Route estimate carrying the ERC-20 approval target.
     */
    estimate: LifiQuoteEstimate;
};
