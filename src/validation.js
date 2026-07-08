// Copyright 2025 LI.FI
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { isAddress, isHexString } from 'ethers'

import { LifiValidationError, LifiUntrustedContractError } from './errors.js'
import { LIFI_DIAMOND_ADDRESSES, PERMIT2_ADDRESS } from './lifi-config.js'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('./lifi-swidge-protocol.js').LifiSwidgeProtocolConfig} LifiSwidgeProtocolConfig */

/**
 * Transaction prepared by the LI.FI quote API (subset validated by this module).
 *
 * @typedef {Object} LifiTransactionRequest
 * @property {string} to - Target contract address the wallet will call.
 * @property {string} data - Hex-encoded calldata for the route.
 * @property {string | number} [value] - Native token value to send, parseable as BigInt (default: 0).
 * @property {string | number} [gasLimit] - Gas limit hint, parseable as BigInt.
 */

/**
 * Route estimate from the LI.FI quote API (subset validated by this module).
 *
 * @typedef {Object} LifiQuoteEstimate
 * @property {string} [approvalAddress] - Contract the wallet must approve to spend the source token.
 * @property {boolean} [skipApproval] - Whether LI.FI marked the route as not requiring an ERC-20 approval.
 */

/**
 * Raw quote response from the LI.FI quote API (subset validated by this module).
 *
 * @typedef {Object} LifiQuote
 * @property {LifiTransactionRequest} transactionRequest - Prepared transaction to forward to the wallet.
 * @property {LifiQuoteEstimate} estimate - Route estimate carrying the ERC-20 approval target.
 */

// Amounts must BigInt-parse and be strictly positive; undefined is allowed
// (LI.FI quotes are exact-in or exact-out, so one amount may be absent).
function assertPositiveAmount (amount, label) {
  if (amount === undefined) return
  let value
  try {
    value = BigInt(amount)
  } catch {
    throw new LifiValidationError(`'${label}' must be an integer amount in base units, got: ${amount}`)
  }
  if (value <= 0n) {
    throw new LifiValidationError(`'${label}' must be greater than zero.`)
  }
}

/**
 * Validates user-supplied swidge options before any API call is made.
 * Token identifiers may be contract addresses or symbols, so only presence
 * is enforced for them.
 *
 * @param {SwidgeOptions} options - User-supplied swidge options to validate.
 * @throws {LifiValidationError} If a token identifier is missing, the recipient is not a valid
 *   address, slippage is outside the 0-1 range, or no positive amount is provided.
 */
export function validateSwidgeOptions (options = {}) {
  const { fromToken, toToken, recipient, slippage, fromTokenAmount, toTokenAmount } = options

  if (typeof fromToken !== 'string' || fromToken.length === 0) {
    throw new LifiValidationError("'fromToken' is required and must be a token address or symbol.")
  }
  if (typeof toToken !== 'string' || toToken.length === 0) {
    throw new LifiValidationError("'toToken' is required and must be a token address or symbol.")
  }
  if (recipient !== undefined && !isAddress(recipient)) {
    throw new LifiValidationError(`'recipient' is not a valid address: ${recipient}`)
  }
  if (slippage !== undefined &&
      (typeof slippage !== 'number' || !Number.isFinite(slippage) || slippage < 0 || slippage > 1)) {
    throw new LifiValidationError(`'slippage' must be a decimal between 0 and 1 (e.g. 0.03 for 3%), got: ${slippage}`)
  }
  if (fromTokenAmount === undefined && toTokenAmount === undefined) {
    throw new LifiValidationError("Either 'fromTokenAmount' or 'toTokenAmount' must be provided.")
  }
  assertPositiveAmount(fromTokenAmount, 'fromTokenAmount')
  assertPositiveAmount(toTokenAmount, 'toTokenAmount')
}

/**
 * Validates execution-guard config values before any API call is made.
 *
 * @param {LifiSwidgeProtocolConfig} [config] - Effective protocol config for this call.
 * @throws {LifiValidationError} If `minAmountOut` is provided but is not a positive integer amount.
 */
export function validateSwidgeConfig (config = {}) {
  assertPositiveAmount(config.minAmountOut, 'minAmountOut')
}

// Builds the set of trusted contract addresses (lowercased) for a chain:
// the built-in LI.FI Diamond deployment, Permit2, and any user-supplied
// additions from the trustedContracts config map.
function getTrustedContracts (chainId, trustedContracts) {
  const trusted = new Set([
    LIFI_DIAMOND_ADDRESSES[chainId] ?? LIFI_DIAMOND_ADDRESSES.default,
    PERMIT2_ADDRESS
  ])

  if (trustedContracts !== true) {
    const extra = trustedContracts?.[chainId]
    const list = Array.isArray(extra) ? extra : (extra ? [extra] : [])
    for (const address of list) trusted.add(address.toLowerCase())
  }

  return trusted
}

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
export function validateQuoteTransaction (quote, chainId, config = {}) {
  const tx = quote.transactionRequest

  if (!tx) {
    throw new LifiValidationError('LI.FI quote contains no transactionRequest.')
  }
  if (!isAddress(tx.to)) {
    throw new LifiValidationError(`LI.FI quote transactionRequest.to is not a valid address: ${tx.to}`)
  }
  if (!isHexString(tx.data)) {
    throw new LifiValidationError('LI.FI quote transactionRequest.data is not valid hex calldata.')
  }
  try {
    BigInt(tx.value ?? 0)
    BigInt(tx.gasLimit ?? 0)
  } catch {
    throw new LifiValidationError('LI.FI quote transactionRequest value/gasLimit are not parseable amounts.')
  }

  const { trustedContracts } = config
  if (!trustedContracts) return

  const trusted = getTrustedContracts(chainId, trustedContracts)

  if (!trusted.has(tx.to.toLowerCase())) {
    throw new LifiUntrustedContractError(
      `LI.FI quote targets contract ${tx.to} on chain ${chainId}, which is not a known LI.FI contract. ` +
      "Add it to the 'trustedContracts' config if expected, or unset 'trustedContracts' to disable this check."
    )
  }

  const approvalAddress = quote.estimate?.approvalAddress
  if (approvalAddress && !quote.estimate.skipApproval && !trusted.has(approvalAddress.toLowerCase())) {
    throw new LifiUntrustedContractError(
      `LI.FI quote requests approval for ${approvalAddress} on chain ${chainId}, which is not a known LI.FI contract. ` +
      "Add it to the 'trustedContracts' config if expected, or unset 'trustedContracts' to disable this check."
    )
  }
}
