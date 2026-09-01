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

import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols'
import { JsonRpcProvider, BrowserProvider, Contract } from 'ethers'

import { LIFI_API_URL, CHAINS } from './lifi-config.js'
import { request } from './request.js'
import { validateSwidgeOptions, validateQuoteTransaction } from './validation.js'
import {
  LifiConfigurationError,
  LifiQuoteError,
  LifiExecutionError,
  LifiStatusError,
  LifiReadOnlyAccountError,
  LifiUnsupportedChainError
} from './errors.js'

const USER_OP_POLL_INTERVAL_MS = 2_000
const USER_OP_POLL_TIMEOUT_MS = 300_000
const USER_OP_RECEIPT_READ_TIMEOUT_MS = 15_000

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {SwidgeResult & { txHashUnresolved?: boolean }} LifiSwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletConfig} EvmErc4337WalletConfig */
/** @typedef {import('ethers').Eip1193Provider} Eip1193Provider */

/**
 * Route selection strategy forwarded to the LI.FI quote API.
 * @typedef {'RECOMMENDED' | 'FASTEST' | 'CHEAPEST'} LifiRouteOrder
 */

/**
 * Optional chain hints for a LI.FI status lookup.
 *
 * @typedef {Object} SwidgeStatusOptions
 * @property {string | number} [fromChain] - Source chain of the transaction, as a WDK chain name or numeric LI.FI chain ID. Speeds up indexing.
 * @property {string | number} [toChain] - Destination chain of the transaction, as a WDK chain name or numeric LI.FI chain ID.
 */

/**
 * @typedef {Object} LifiSwidgeProtocolConfig
 * @property {number | bigint} [maxNetworkFeeBps] - Maximum network fee as basis points of the input amount.
 *   Computed in USD terms since network fees are denominated in native token, not source token.
 *   If exceeded, `swidge()` throws before sending any transaction.
 * @property {number | bigint} [maxProtocolFeeBps] - Maximum LI.FI protocol fee as basis points of the input amount.
 *   Compared directly in source token units. If exceeded, `swidge()` throws before sending any transaction.
 * @property {string | Eip1193Provider} [provider] - RPC URL string or EIP-1193 provider object.
 *   Falls back to `account._config.provider` when omitted.
 * @property {string} [integrator] - LI.FI integrator identifier, sent as the x-lifi-integrator header.
 * @property {string} [apiKey] - LI.FI API key for higher rate limits, sent as x-lifi-api-key. Never expose client-side.
 * @property {LifiRouteOrder} [order] - Route selection strategy: 'RECOMMENDED' (default), 'FASTEST', or 'CHEAPEST'.
 * @property {string[]} [allowBridges] - Whitelist of bridge protocol names (e.g. ['stargate', 'cctp']).
 * @property {string[]} [denyBridges] - Blacklist of bridge protocol names to exclude (e.g. ['across']).
 *   When omitted, no filter is sent and LI.FI considers all bridges. Gasless integrations can pass the
 *   exported `NATIVE_VALUE_BRIDGE_DENY_LIST` to exclude bridges that require native token value.
 * @property {boolean} [allowDestinationCall=true] - Forwarded to LI.FI to allow or reject routes that
 *   execute a destination-chain call, such as a destination-chain swap. When omitted, LI.FI's own
 *   default (true) applies, giving the widest route coverage. Set false to filter out routes that
 *   may leave the user with an intermediary token if the destination call cannot complete.
 * @property {boolean} [allowNativeValue=true] - Whether `swidge()` may execute quotes whose transaction
 *   requires native token value (`transactionRequest.value > 0`). Set false for gasless setups
 *   (e.g. ERC-4337 with a paymaster): such quotes are then rejected before any approval is sent.
 *   Combine with `denyBridges: NATIVE_VALUE_BRIDGE_DENY_LIST` to also filter them out at quote time.
 * @property {number} [timeout] - Timeout in ms per LI.FI API request attempt. Default 30000.
 * @property {number} [retries] - Extra attempts on transient API failures (5xx, 429, network errors, timeouts).
 *   Default 1, mirroring the LI.FI SDK. Set 0 to disable retries.
 * @property {number} [retryDelay] - Base backoff delay in ms, doubled per attempt and capped at 5000. Default 500.
 *   For 429 responses the Retry-After header takes precedence when present.
 * @property {true | Record<number, string | string[]>} [trustedContracts] - When set, the quote's transaction
 *   target and approval address must be known LI.FI contracts, otherwise `swidge()` throws before sending
 *   any transaction. Pass `true` to use the built-in per-chain allowlist of LI.FI Diamond deployments,
 *   or a map of chain ID to extra trusted addresses (merged with the built-ins). Off by default,
 *   matching LI.FI SDK behavior.
 */

/** @typedef {LifiSwidgeProtocolConfig & Partial<EvmErc4337WalletConfig>} LifiSwidgeCallConfig */

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]
const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/**
 * Bridge protocols known to require native token value in the source transaction.
 * Not applied by default — pass as `denyBridges` (typically together with
 * `allowNativeValue: false`) for gasless integrations.
 */
export const NATIVE_VALUE_BRIDGE_DENY_LIST = [
  'glacis',
  'stargateV2',
  'stargateV2Bus',
  'squid',
  'arbitrum',
  'gasZipBridge'
]

/**
 * WDK Swidge protocol backed by the LI.FI REST API. Provides quotes, execution,
 * and status tracking for swap, bridge, and combined swap+bridge operations
 * across all chains supported by LI.FI.
 */
export default class LifiSwidgeProtocol extends SwidgeProtocol {
  /**
   * Creates a new LI.FI Swidge protocol without a bound wallet account.
   * Only `quoteSwidge`, `getSupportedChains`, and `getSupportedTokens` are available.
   *
   * @overload
   * @param {undefined} [account] - No account; quote and discovery methods only.
   * @param {LifiSwidgeProtocolConfig} [config] - Fee caps, LI.FI routing options, and reliability/security settings.
   */

  /**
   * Creates a read-only LI.FI Swidge protocol.
   * Only `quoteSwidge`, `getSwidgeStatus`, `getSupportedChains`, and `getSupportedTokens` are available.
   *
   * @overload
   * @param {WalletAccountReadOnlyEvm | WalletAccountReadOnlyEvmErc4337} account - Read-only EOA or ERC-4337 account used to derive the source address and quote fees.
   * @param {LifiSwidgeProtocolConfig} [config] - Fee caps, LI.FI routing options, and reliability/security settings.
   */

  /**
   * Creates a full LI.FI Swidge protocol capable of executing swap and bridge operations.
   *
   * @overload
   * @param {WalletAccountEvm | WalletAccountEvmErc4337} account - Writable EOA or ERC-4337 smart account that signs and sends transactions.
   * @param {LifiSwidgeProtocolConfig} [config] - Fee caps, LI.FI routing options, and reliability/security settings.
   */
  constructor (account, config = {}) {
    super(account, config)

    /** @private */
    this._chainId = undefined

    const providerSource = config.provider ?? account?._config?.provider

    /** @private */
    this._provider = providerSource
      ? (typeof providerSource === 'string'
          ? new JsonRpcProvider(providerSource)
          : new BrowserProvider(providerSource))
      : undefined
  }

  /**
   * Returns a non-binding quote for a swap, bridge, or combined swap+bridge operation.
   *
   * `minAmountOut` is not applied at quote time — quoting is a read-only price check, so the
   * amounts are always returned for the app to display and compare. The guard is enforced by
   * `swidge()` before execution.
   *
   * @param {SwidgeOptions} options - Route options: token pair, destination chain, amount (exact-in or exact-out), slippage, and recipient.
   * @param {LifiSwidgeCallConfig} [config] - Per-call overrides for LI.FI routing and ERC-4337 config; pass the same value given to `swidge()` so the self-quoted fee matches.
   * @returns {Promise<SwidgeQuote>} Non-binding amounts, fees, estimated duration, and price impact for the route.
   * @throws {LifiConfigurationError} If no connected provider is available.
   * @throws {LifiValidationError} If the options fail validation (missing token, invalid recipient, slippage outside 0-1, no positive amount).
   * @throws {LifiUnsupportedChainError} If `toChain` is a chain name not present in the supported chains map.
   * @throws {LifiQuoteError} If LI.FI cannot produce a route or the quote API request fails.
   */
  async quoteSwidge (options, config) {
    if (!this._provider) {
      throw new LifiConfigurationError(
        'A connected provider is required to fetch quotes. ' +
        'Pass a provider URL in account config or in the LifiSwidgeProtocolConfig.'
      )
    }

    validateSwidgeOptions(options)

    const effectiveConfig = { ...this._config, ...config }

    const { fromToken, toToken, toChain, recipient, slippage, fromTokenAmount, toTokenAmount } = options

    const fromChainId = await this._getChainId()
    const toChainId = this._resolveChainId(toChain, fromChainId)
    const resolvedToToken = await this._resolveToToken(fromToken, toToken, fromChainId, toChainId)

    const fromAddress = this._account ? await this._account.getAddress().catch(() => undefined) : undefined

    const quote = await this._fetchQuote({
      fromChainId,
      toChainId,
      fromToken,
      toToken: resolvedToToken,
      fromAmount: fromTokenAmount !== undefined ? BigInt(fromTokenAmount) : undefined,
      toAmount: toTokenAmount !== undefined ? BigInt(toTokenAmount) : undefined,
      fromAddress,
      toAddress: recipient,
      slippage
    }, effectiveConfig)

    let erc4337NetworkFee
    if (this._isErc4337Account() && fromAddress) {
      const amount = await this._quoteErc4337NetworkFee(quote, fromToken, fromAddress, config)
      erc4337NetworkFee = { amount, token: this._resolveErc4337FeeToken(config), chain: fromChainId }
    }

    return {
      fromTokenAmount: BigInt(quote.estimate.fromAmount),
      toTokenAmount: BigInt(quote.estimate.toAmount),
      toTokenAmountMin: BigInt(quote.estimate.toAmountMin),
      fees: this._buildFees(quote, erc4337NetworkFee),
      estimatedDuration: quote.estimate.executionDuration,
      priceImpact: quote.estimate.priceImpact !== undefined ? Number(quote.estimate.priceImpact) : undefined
    }
  }

  /**
   * Executes a swap, bridge, or combined swap+bridge operation.
   * Handles ERC-20 approval automatically, granting only the exact amount required.
   * For tokens that revert on non-zero-to-non-zero approval (e.g. USDT on Ethereum),
   * a reset-to-zero call is executed first. ERC-4337 accounts batch all required
   * approval calls and the bridge call into one UserOperation.
   *
   * @param {SwidgeOptions} options - Route options: token pair, destination chain, amount (exact-in or exact-out), slippage, recipient,
   *   and the optional `minAmountOut` execution guard for quote-first flows — pass the `toTokenAmountMin` from a previously displayed
   *   `quoteSwidge()` result, and `swidge()` throws before any approval or transaction is sent if the fresh execution quote's
   *   `toAmountMin` falls below it. Not forwarded to LI.FI.
   * @param {LifiSwidgeCallConfig} [config] - Per-call overrides for fee caps, LI.FI routing, and ERC-4337 config.
   * @returns {Promise<LifiSwidgeResult>} The canonical source transaction hash (as `id` and `hash`), fees, all sent transactions, and quoted amounts.
   * @throws {LifiReadOnlyAccountError} If the bound account is read-only or absent.
   * @throws {LifiConfigurationError} If no connected provider is available.
   * @throws {LifiValidationError} If the options or the quote's transaction data fail validation.
   * @throws {LifiExecutionError} If a fee cap is exceeded or the quote falls below `minAmountOut` before any transaction is sent.
   * @throws {LifiUntrustedContractError} If `trustedContracts` is enabled and the quote targets an unknown contract.
   * @throws {LifiQuoteError} If LI.FI cannot produce a route or the quote API request fails.
   */
  async swidge (options, config) {
    if (!this._isWritableAccount()) {
      throw new LifiReadOnlyAccountError(
        'swidge() requires a writable account. Construct LifiSwidgeProtocol with a WalletAccountEvm or WalletAccountEvmErc4337.'
      )
    }

    if (!this._provider) {
      throw new LifiConfigurationError(
        'A connected provider is required to execute operations. ' +
        'Pass a provider URL in account config or in the LifiSwidgeProtocolConfig.'
      )
    }

    validateSwidgeOptions(options)

    const effectiveConfig = { ...this._config, ...config }

    const { fromToken, toToken, toChain, recipient, slippage, fromTokenAmount, toTokenAmount, minAmountOut } = options

    const fromChainId = await this._getChainId()
    const toChainId = this._resolveChainId(toChain, fromChainId)
    const resolvedToToken = await this._resolveToToken(fromToken, toToken, fromChainId, toChainId)
    const fromAddress = await this._account.getAddress()

    const quote = await this._fetchQuote({
      fromChainId,
      toChainId,
      fromToken,
      toToken: resolvedToToken,
      fromAmount: fromTokenAmount !== undefined ? BigInt(fromTokenAmount) : undefined,
      toAmount: toTokenAmount !== undefined ? BigInt(toTokenAmount) : undefined,
      fromAddress,
      toAddress: recipient || fromAddress,
      slippage
    }, effectiveConfig)

    this._checkMinAmountOut(quote, minAmountOut)
    this._checkFeeCaps(quote, effectiveConfig)

    // Validate before approval: an untrusted target must be rejected before
    // any allowance is granted, not just before the bridge tx is sent.
    validateQuoteTransaction(quote, fromChainId, effectiveConfig)
    this._checkNativeValueRequirement(quote, effectiveConfig)

    const bridgeTx = this._buildBridgeTx(quote)

    let approveHash
    let resetAllowanceHash
    let bridgeHash
    let erc4337NetworkFee
    let txHashUnresolved = false
    if (this._isErc4337Account()) {
      // A single UserOperation keeps the Safe nonce stable while ensuring the
      // allowance changes and bridge call execute atomically and in order.
      let fee
      ;({ hash: bridgeHash, fee } = await this._account.sendTransaction(
        await this._buildErc4337Batch(quote, fromToken, fromAddress),
        config
      ))
      erc4337NetworkFee = { amount: fee, token: this._resolveErc4337FeeToken(config), chain: fromChainId }
      const resolvedTxHash = await this._resolveUserOpTxHash(bridgeHash)
      txHashUnresolved = resolvedTxHash === null
      bridgeHash = resolvedTxHash ?? bridgeHash
    } else {
      ;({ approveHash, resetAllowanceHash } = await this._handleApproval(
        fromToken,
        fromAddress,
        quote.estimate.approvalAddress,
        BigInt(quote.estimate.fromAmount),
        quote.estimate.skipApproval
      ))
      ;({ hash: bridgeHash } = await this._account.sendTransaction(bridgeTx))
    }

    const transactions = []
    if (resetAllowanceHash) {
      transactions.push({ hash: resetAllowanceHash, chain: fromChainId, type: 'approval' })
    }
    if (approveHash) {
      transactions.push({ hash: approveHash, chain: fromChainId, type: 'approval' })
    }
    transactions.push({ hash: bridgeHash, chain: fromChainId, type: 'source' })

    return {
      id: bridgeHash,
      hash: bridgeHash,
      ...(txHashUnresolved && { txHashUnresolved: true }),
      fees: this._buildFees(quote, erc4337NetworkFee),
      transactions,
      fromTokenAmount: BigInt(quote.estimate.fromAmount),
      toTokenAmount: BigInt(quote.estimate.toAmount),
      toTokenAmountMin: BigInt(quote.estimate.toAmountMin)
    }
  }

  /**
   * Returns the current status of an in-flight swidge operation.
   * Poll this until the status is a terminal value: 'completed', 'failed', 'refunded', 'cancelled', 'expired', or 'partial'.
   *
   * @param {string} id - The bridge transaction hash returned by `swidge()`.
   * @param {SwidgeStatusOptions} [options] - Optional source/destination chain hints that speed up the LI.FI status lookup.
   * @returns {Promise<SwidgeStatusResult>} The mapped swidge status and the known source/destination transactions.
   * @throws {LifiStatusError} If the status API request fails or the id is unknown (`NOT_FOUND`/`INVALID`);
   *   the error carries a machine-readable `lifiStatus` field so polling loops can treat `NOT_FOUND` as pending.
   */
  async getSwidgeStatus (id, options = {}) {
    const params = new URLSearchParams({ txHash: id })
    if (options.fromChain !== undefined) params.set('fromChain', String(options.fromChain))
    if (options.toChain !== undefined) params.set('toChain', String(options.toChain))

    const data = await this._request('/status', params, {
      errorClass: LifiStatusError,
      errorPrefix: 'LI.FI status request failed'
    })

    if (data.status === 'NOT_FOUND' || data.status === 'INVALID') {
      const err = new LifiStatusError(`No swidge found for id: ${id} (LI.FI status: ${data.status})`)
      // Machine-readable tag so polling loops can treat NOT_FOUND (tx not yet
      // indexed) as still-pending without parsing the message.
      err.lifiStatus = data.status
      throw err
    }

    const status = this._mapLifiStatus(data.status, data.substatus, data.requiredActions)

    const transactions = []
    if (data.sending?.txHash) {
      transactions.push({ hash: data.sending.txHash, chain: options.fromChain, type: 'source' })
    }
    if (data.receiving?.txHash) {
      transactions.push({ hash: data.receiving.txHash, chain: options.toChain, type: 'destination' })
    }

    return { status, transactions }
  }

  /**
   * Returns all chains supported by LI.FI for swap and bridge operations.
   *
   * @returns {Promise<SwidgeSupportedChain[]>} Every chain LI.FI can route across, with id, name, chain type, and native token symbol.
   * @throws {LifiQuoteError} If the chains API request fails.
   */
  async getSupportedChains () {
    const params = new URLSearchParams({ chainTypes: 'EVM,SVM,UTXO,MVM,TVM' })

    const { chains } = await this._request('/chains', params, {
      errorClass: LifiQuoteError,
      errorPrefix: 'LI.FI chains request failed'
    })

    return chains.map(chain => ({
      id: chain.id,
      name: chain.name,
      type: (chain.chainType || 'EVM').toLowerCase(),
      nativeToken: chain.nativeToken?.symbol || 'ETH'
    }))
  }

  /**
   * Returns tokens supported by LI.FI, optionally scoped to a route.
   *
   * @param {SwidgeSupportedTokensOptions} [options] - Optional filter; `fromChain` limits results to a single chain.
   * @returns {Promise<SwidgeSupportedToken[]>} Flat token list across all returned chains, with address, symbol, decimals, and name.
   * @throws {LifiQuoteError} If the tokens API request fails.
   */
  async getSupportedTokens (options = {}) {
    const params = new URLSearchParams()
    if (options.fromChain !== undefined) params.set('chains', String(options.fromChain))

    const { tokens } = await this._request('/tokens', params, {
      errorClass: LifiQuoteError,
      errorPrefix: 'LI.FI tokens request failed'
    })

    return Object.entries(tokens).flatMap(([chainId, chainTokens]) =>
      chainTokens.map(t => ({
        token: t.address,
        chain: parseInt(chainId),
        symbol: t.symbol,
        decimals: t.decimals,
        address: t.address,
        name: t.name
      }))
    )
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** @private */
  async _getChainId () {
    if (!this._chainId) {
      const network = await this._provider.getNetwork()
      this._chainId = Number(network.chainId)
    }
    return this._chainId
  }

  // Resolves a WDK chain name or numeric ID to a LI.FI chain ID.
  // Returns fromChainId when toChain is undefined (same-chain swap).
  /** @private */
  _resolveChainId (toChain, fromChainId) {
    if (toChain === undefined || toChain === null) return fromChainId
    if (typeof toChain === 'number') return toChain
    const id = CHAINS[toChain]
    if (!id) throw new LifiUnsupportedChainError(`Chain '${toChain}' is not in the supported chains map.`)
    return id
  }

  // When fromToken and toToken are the same contract address across different
  // chains (the standard bridge case), resolves the destination-chain contract
  // address, since token addresses are not portable across chains.
  /** @private */
  async _resolveToToken (fromToken, toToken, fromChainId, toChainId) {
    if (fromToken === toToken && fromChainId !== toChainId) {
      const dest = await this._resolveCrossChainToToken(fromChainId, toChainId, fromToken)
      return dest.address
    }
    return toToken
  }

  // Finds the destination-chain token matching a cross-chain bridge source token.
  // LI.FI symbols are not always portable (e.g. Ethereum USDT → Arbitrum USDT0).
  /** @private */
  async _resolveCrossChainToToken (fromChainId, toChainId, fromTokenAddress) {
    const source = await this._fetchTokenInfo(fromChainId, fromTokenAddress)
    const dest = await this._findDestinationToken(toChainId, source)
    return dest
  }

  /** @private */
  async _fetchTokenInfo (chainId, tokenAddress) {
    const params = new URLSearchParams({ chain: String(chainId), token: tokenAddress })

    const token = await this._request('/token', params, {
      errorClass: LifiQuoteError,
      errorPrefix: `Failed to resolve token for ${tokenAddress} on chain ${chainId}`,
      errorSuffix: "Pass an explicit 'toToken' to bypass resolution."
    })

    if (!token?.symbol) {
      throw new LifiQuoteError(
        `LI.FI returned no symbol for token ${tokenAddress} on chain ${chainId}. ` +
        'Pass an explicit \'toToken\' to bypass resolution.'
      )
    }

    return token
  }

  // Searches the destination chain for a stablecoin with matching decimals,
  // scoring candidates by market cap and coinKey/symbol affinity.
  /** @private */
  async _findDestinationToken (toChainId, source) {
    const searchTerms = [source.symbol]
    if (source.coinKey && source.coinKey !== source.symbol) searchTerms.push(source.coinKey)
    if (!searchTerms.includes(`${source.symbol}0`)) searchTerms.push(`${source.symbol}0`)

    const byAddress = new Map()

    for (const term of searchTerms) {
      const tokens = await this._searchTokens(toChainId, term)
      for (const token of tokens) {
        if (!this._isDestinationTokenCandidate(token, source)) continue
        const prev = byAddress.get(token.address)
        if (!prev || this._scoreDestinationToken(token, source) > this._scoreDestinationToken(prev, source)) {
          byAddress.set(token.address, token)
        }
      }
    }

    const matches = [...byAddress.values()]
    if (matches.length === 0) {
      throw new LifiQuoteError(
        `No destination token found for ${source.symbol} on chain ${toChainId}. ` +
        'Pass an explicit \'toToken\' address or symbol.'
      )
    }

    matches.sort((a, b) => this._scoreDestinationToken(b, source) - this._scoreDestinationToken(a, source))
    return matches[0]
  }

  /** @private */
  _isDestinationTokenCandidate (token, source) {
    if (token.decimals !== source.decimals) return false
    if ((token.tags || []).includes('stablecoin')) return true
    const price = Number.parseFloat(token.priceUSD)
    return Number.isFinite(price) && price >= 0.95 && price <= 1.05
  }

  /** @private */
  _scoreDestinationToken (token, source) {
    let score = (token.marketCapUSD || 0) + (token.relevance || 0)
    if (token.coinKey === source.coinKey) score += 1e15
    if (token.coinKey === `${source.coinKey}0` || token.symbol === `${source.symbol}0`) score += 1e14
    return score
  }

  /** @private */
  async _searchTokens (chainId, search) {
    const params = new URLSearchParams({
      chains: String(chainId),
      search,
      limit: '20'
    })

    const data = await this._request('/tokens', params, {
      errorClass: LifiQuoteError,
      errorPrefix: `Failed to search tokens on chain ${chainId}`
    })
    return data.tokens?.[String(chainId)] ?? []
  }

  /** @private */
  async _fetchQuote ({ fromChainId, toChainId, fromToken, toToken, fromAmount, toAmount, fromAddress, toAddress, slippage }, config = this._config) {
    const params = new URLSearchParams({
      fromChain: String(fromChainId),
      toChain: String(toChainId),
      fromToken,
      toToken
    })

    if (fromAmount !== undefined) params.set('fromAmount', String(fromAmount))
    if (toAmount !== undefined) params.set('toAmount', String(toAmount))
    if (fromAddress) params.set('fromAddress', fromAddress)
    if (toAddress) params.set('toAddress', toAddress)
    if (slippage !== undefined) params.set('slippage', String(slippage))

    const { order, allowBridges, denyBridges, allowDestinationCall } = config
    if (order) params.set('order', order)
    if (allowBridges?.length) params.set('allowBridges', allowBridges.join(','))
    if (denyBridges?.length) params.set('denyBridges', denyBridges.join(','))
    if (allowDestinationCall !== undefined) params.set('allowDestinationCall', String(allowDestinationCall))

    return this._request('/quote', params, {
      errorClass: LifiQuoteError,
      errorPrefix: 'LI.FI quote request failed'
    })
  }

  // Maps gasCosts (SEND) → 'network' and feeCosts → 'protocol'. erc4337NetworkFee,
  // when given, overrides the gasCosts-derived entry: that estimate assumes a
  // plain EOA tx and doesn't account for ERC-4337 verification/paymaster
  // overhead or fee token.
  // token.chainId is the fee's denomination chain, not necessarily the
  // execution chain — leave SwidgeFee.chain unset rather than guess when omitted.
  /** @private */
  _buildFees (quote, erc4337NetworkFee) {
    const fees = []

    if (erc4337NetworkFee) {
      fees.push({
        type: 'network',
        amount: erc4337NetworkFee.amount,
        token: erc4337NetworkFee.token,
        ...(erc4337NetworkFee.chain !== undefined ? { chain: erc4337NetworkFee.chain } : {}),
        description: 'Network fee'
      })
    } else {
      for (const gc of (quote.estimate.gasCosts || [])) {
        if (gc.type !== 'SEND') continue
        fees.push({
          type: 'network',
          amount: BigInt(gc.amount),
          token: gc.token?.address || gc.token?.symbol || 'ETH',
          ...(gc.token?.chainId !== undefined && gc.token?.chainId !== null
            ? { chain: gc.token.chainId }
            : {}),
          description: gc.name || 'Network fee'
        })
      }
    }

    for (const fc of (quote.estimate.feeCosts || [])) {
      fees.push({
        type: 'protocol',
        amount: BigInt(fc.amount),
        token: fc.token?.address || quote.action?.fromToken?.address || '',
        ...(fc.token?.chainId !== undefined && fc.token?.chainId !== null
          ? { chain: fc.token.chainId }
          : {}),
        included: Boolean(fc.included),
        description: fc.name || 'Protocol fee'
      })
    }

    return fees
  }

  // Enforces maxNetworkFeeBps and maxProtocolFeeBps. Protocol fees compare in
  // source token units (same denomination as fromAmount); network fees compare
  // via USD since they are denominated in native token.
  /** @private */
  _checkFeeCaps (quote, effectiveConfig) {
    const { maxProtocolFeeBps, maxNetworkFeeBps } = effectiveConfig || {}
    if (maxProtocolFeeBps === undefined && maxNetworkFeeBps === undefined) return

    const fromAmount = BigInt(quote.estimate.fromAmount)

    if (maxProtocolFeeBps !== undefined) {
      const totalProtocolFee = (quote.estimate.feeCosts || [])
        .reduce((sum, fc) => sum + BigInt(fc.amount), 0n)

      if (totalProtocolFee * 10000n > fromAmount * BigInt(maxProtocolFeeBps)) {
        throw new LifiExecutionError('Protocol fee exceeds maxProtocolFeeBps limit.')
      }
    }

    if (maxNetworkFeeBps !== undefined) {
      const fromAmountUSD = parseFloat(quote.estimate.fromAmountUSD || 0)
      if (fromAmountUSD > 0) {
        const totalNetworkFeeUSD = (quote.estimate.gasCosts || [])
          .filter(gc => gc.type === 'SEND')
          .reduce((sum, gc) => sum + parseFloat(gc.amountUSD || 0), 0)

        const networkFeeBps = Math.round((totalNetworkFeeUSD / fromAmountUSD) * 10000)

        if (networkFeeBps > Number(maxNetworkFeeBps)) {
          throw new LifiExecutionError('Network fee exceeds maxNetworkFeeBps limit.')
        }
      }
    }
  }

  // Guards quote-first flows: the fresh execution quote must not promise less
  // than the minimum the user accepted when the displayed quote was taken.
  /** @private */
  _checkMinAmountOut (quote, minAmountOut) {
    if (minAmountOut === undefined) return

    if (BigInt(quote.estimate.toAmountMin) < BigInt(minAmountOut)) {
      throw new LifiExecutionError('Quote output is below minAmountOut; refresh the quote before executing.')
    }
  }

  /** @private */
  _checkNativeValueRequirement (quote, effectiveConfig) {
    if (effectiveConfig.allowNativeValue ?? true) return

    const value = BigInt(quote.transactionRequest?.value ?? 0)
    if (value > 0n) {
      throw new LifiExecutionError(
        'Selected LI.FI route requires native token value; rejected because allowNativeValue is false.'
      )
    }
  }

  /** @private */
  _buildBridgeTx (quote) {
    const { transactionRequest } = quote
    return {
      to: transactionRequest.to,
      data: transactionRequest.data,
      value: BigInt(transactionRequest.value ?? 0),
      gasLimit: BigInt(transactionRequest.gasLimit ?? 300_000)
    }
  }

  // Builds the ordered ERC-20 calls needed before the LI.FI bridge call. For
  // tokens that revert on direct non-zero-to-non-zero approval (e.g. USDT on
  // Ethereum), the first call resets the allowance to zero.
  /** @private */
  async _buildApprovalTxs (token, fromAddress, approvalAddress, amount, skipApproval) {
    if (skipApproval) return []

    const tokenContract = new Contract(token, ERC20_ABI, this._provider)
    const currentAllowance = await tokenContract.allowance(fromAddress, approvalAddress)

    if (currentAllowance >= amount) return []

    const transactions = []

    if (currentAllowance > 0n) {
      transactions.push({
        to: token,
        data: tokenContract.interface.encodeFunctionData('approve', [approvalAddress, 0n]),
        value: 0n
      })
    }

    transactions.push({
      to: token,
      data: tokenContract.interface.encodeFunctionData('approve', [approvalAddress, amount]),
      value: 0n
    })

    return transactions
  }

  /** @private */
  async _quoteErc4337NetworkFee (quote, fromToken, fromAddress, config) {
    const batch = await this._buildErc4337Batch(quote, fromToken, fromAddress)
    const { fee } = await this._account.quoteSendTransaction(batch, config)
    return fee
  }

  // Builds the full ERC-4337 batch — approval calls (if any) followed by the bridge call.
  /** @private */
  async _buildErc4337Batch (quote, fromToken, fromAddress) {
    const approvalTxs = await this._buildApprovalTxs(
      fromToken,
      fromAddress,
      quote.estimate.approvalAddress,
      BigInt(quote.estimate.fromAmount),
      quote.estimate.skipApproval
    )
    return [...approvalTxs, this._buildBridgeTx(quote)]
  }

  /** @private */
  _resolveErc4337FeeToken (config) {
    const merged = { ...this._account._config, ...config }
    if (merged.isSponsored || merged.useNativeCoins) return NATIVE_TOKEN_ADDRESS
    return merged.paymasterToken?.address || NATIVE_TOKEN_ADDRESS
  }

  // EOA approvals are separate transactions and must be confirmed before the
  // next approval or bridge transaction is submitted.
  /** @private */
  async _handleApproval (token, fromAddress, approvalAddress, amount, skipApproval) {
    const approvalTxs = await this._buildApprovalTxs(
      token,
      fromAddress,
      approvalAddress,
      amount,
      skipApproval
    )

    let approveHash
    let resetAllowanceHash

    for (let index = 0; index < approvalTxs.length; index++) {
      const { hash } = await this._account.sendTransaction(approvalTxs[index])
      await this._provider.waitForTransaction(hash)

      if (approvalTxs.length > 1 && index === 0) {
        resetAllowanceHash = hash
      } else {
        approveHash = hash
      }
    }

    return { approveHash, resetAllowanceHash }
  }

  /**
   * Bounds an individual bundler receipt read. The underlying ERC-4337
   * transport does not expose an AbortSignal, so a stalled request cannot be
   * cancelled here and is treated the same as a receipt that is not ready.
   *
   * @private
   * @param {string} userOpHash
   * @param {number} timeout
   * @returns {Promise<object | null>}
   */
  async _readUserOpReceipt (userOpHash, timeout) {
    let timer
    try {
      return await Promise.race([
        this._account.getUserOperationReceipt(userOpHash),
        new Promise(resolve => {
          timer = setTimeout(() => resolve(null), timeout)
        })
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /**
   * Resolves a bundler UserOperation hash to its canonical on-chain
   * transaction hash.
   *
   * @private
   * @param {string} userOpHash
   * @returns {Promise<string | null>}
   * @throws {LifiExecutionError} If the included UserOperation reverted.
   */
  async _resolveUserOpTxHash (userOpHash) {
    const deadline = Date.now() + USER_OP_POLL_TIMEOUT_MS

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      let receipt = null

      try {
        receipt = await this._readUserOpReceipt(
          userOpHash,
          Math.min(USER_OP_RECEIPT_READ_TIMEOUT_MS, remaining)
        )
      } catch {
        // Some bundlers return an error while an operation is still pending.
      }

      if (receipt) {
        if (receipt.success === false) {
          throw new LifiExecutionError(
            `User operation ${userOpHash} reverted (tx ${receipt.receipt?.transactionHash ?? 'unknown'}). Nothing was bridged.`
          )
        }

        const txHash = receipt.receipt?.transactionHash
        if (txHash) return txHash
      }

      const delay = Math.min(USER_OP_POLL_INTERVAL_MS, deadline - Date.now())
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    }

    console.warn(
      `[lifi] user operation ${userOpHash} was not included within ${USER_OP_POLL_TIMEOUT_MS}ms; ` +
      'the source transaction hash is unresolved'
    )
    return null
  }

  // Maps LI.FI's status/substatus pair to one of the nine canonical SwidgeStatus values.
  /** @private */
  _mapLifiStatus (status, substatus, requiredActions) {
    if (requiredActions && requiredActions.length > 0) return 'action-required'

    switch (status) {
      case 'PENDING': return 'pending'
      case 'DONE':
        switch (substatus) {
          case 'COMPLETED': return 'completed'
          case 'PARTIAL': return 'partial'
          case 'REFUNDED': return 'refunded'
          case 'NOT_PROCESSABLE_REFUND_NEEDED': return 'refund-pending'
          default: return 'completed'
        }
      case 'FAILED': return 'failed'
      default: return 'pending'
    }
  }

  // Uses prototype-chain name matching instead of instanceof so the check is immune
  // to module identity issues when the same package is installed in multiple
  // node_modules trees.
  /** @private */
  _isErc4337Account () {
    let proto = this._account
    while (proto && proto !== Object.prototype) {
      const name = proto.constructor?.name
      if (name === 'WalletAccountEvmErc4337' || name === 'WalletAccountReadOnlyEvmErc4337') return true
      proto = Object.getPrototypeOf(proto)
    }
    return false
  }

  /** @private */
  _isWritableAccount () {
    if (!this._account) return false
    let proto = this._account
    while (proto && proto !== Object.prototype) {
      const name = proto.constructor?.name
      if (name === 'WalletAccountEvm' || name === 'WalletAccountEvmErc4337') return true
      proto = Object.getPrototypeOf(proto)
    }
    return false
  }

  // Issues a request to the LI.FI API through the central reliability layer:
  // per-attempt timeout, retries with backoff on transient failures, and typed
  // error classification. See src/request.js.
  /** @private */
  async _request (path, params, { errorClass, errorPrefix, errorSuffix } = {}) {
    return request(`${LIFI_API_URL}${path}?${params}`, {
      headers: this._buildHeaders(),
      timeout: this._config.timeout,
      retries: this._config.retries,
      retryDelay: this._config.retryDelay,
      errorClass,
      errorPrefix,
      errorSuffix
    })
  }

  /** @private */
  _buildHeaders () {
    const headers = {}
    if (this._config.integrator) headers['x-lifi-integrator'] = this._config.integrator
    if (this._config.apiKey) headers['x-lifi-api-key'] = this._config.apiKey
    return headers
  }
}
