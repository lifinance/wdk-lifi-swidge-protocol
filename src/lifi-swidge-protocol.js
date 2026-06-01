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
import {
  LifiConfigurationError,
  LifiQuoteError,
  LifiExecutionError,
  LifiStatusError,
  LifiReadOnlyAccountError,
  LifiUnsupportedChainError
} from './errors.js'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */

/**
 * @typedef {'RECOMMENDED' | 'FASTEST' | 'CHEAPEST'} LifiRouteOrder
 */

/**
 * @typedef {Object} LifiSwidgeProtocolConfig
 * @property {number | bigint} [maxNetworkFeeBps] - Maximum network fee as basis points of the input amount.
 *   Computed in USD terms since network fees are denominated in native token, not source token.
 *   If exceeded, `swidge()` throws before sending any transaction.
 * @property {number | bigint} [maxProtocolFeeBps] - Maximum LI.FI protocol fee as basis points of the input amount.
 *   Compared directly in source token units. If exceeded, `swidge()` throws before sending any transaction.
 * @property {string | object} [provider] - RPC URL string or EIP-1193 provider object.
 *   Falls back to `account._config.provider` when omitted.
 * @property {string} [integrator] - LI.FI integrator identifier, sent as the x-lifi-integrator header.
 * @property {string} [apiKey] - LI.FI API key for higher rate limits, sent as x-lifi-api-key. Never expose client-side.
 * @property {LifiRouteOrder} [order] - Route selection strategy: 'RECOMMENDED' (default), 'FASTEST', or 'CHEAPEST'.
 * @property {string[]} [allowBridges] - Whitelist of bridge protocol names (e.g. ['stargate', 'cctp']).
 * @property {string[]} [denyBridges] - Blacklist of bridge protocol names to exclude (e.g. ['across']).
 */

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]

export default class LifiSwidgeProtocol extends SwidgeProtocol {
  /**
   * Creates a new LI.FI Swidge protocol without a bound wallet account.
   * Only `quoteSwidge`, `getSupportedChains`, and `getSupportedTokens` are available.
   *
   * @overload
   * @param {undefined} [account]
   * @param {LifiSwidgeProtocolConfig} [config]
   */

  /**
   * Creates a read-only LI.FI Swidge protocol.
   * Only `quoteSwidge`, `getSwidgeStatus`, `getSupportedChains`, and `getSupportedTokens` are available.
   *
   * @overload
   * @param {WalletAccountReadOnlyEvm} account
   * @param {LifiSwidgeProtocolConfig} [config]
   */

  /**
   * Creates a full LI.FI Swidge protocol capable of executing swap and bridge operations.
   *
   * @overload
   * @param {WalletAccountEvm | WalletAccountEvmErc4337} account
   * @param {LifiSwidgeProtocolConfig} [config]
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
      : null
  }

  /**
   * Returns a non-binding quote for a swap, bridge, or combined swap+bridge operation.
   *
   * @param {SwidgeOptions} options
   * @returns {Promise<SwidgeQuote>}
   */
  async quoteSwidge (options) {
    if (!this._provider) {
      throw new LifiConfigurationError(
        'A connected provider is required to fetch quotes. ' +
        'Pass a provider URL in account config or in the LifiSwidgeProtocolConfig.'
      )
    }

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
    })

    return {
      fromTokenAmount: BigInt(quote.estimate.fromAmount),
      toTokenAmount: BigInt(quote.estimate.toAmount),
      toTokenAmountMin: BigInt(quote.estimate.toAmountMin),
      fees: this._buildFees(quote),
      estimatedDuration: quote.estimate.executionDuration,
      priceImpact: quote.estimate.priceImpact !== undefined ? Number(quote.estimate.priceImpact) : undefined
    }
  }

  /**
   * Executes a swap, bridge, or combined swap+bridge operation.
   * Handles ERC-20 approval automatically, granting only the exact amount required.
   * For tokens that revert on non-zero-to-non-zero approval (e.g. USDT on Ethereum),
   * a reset-to-zero transaction is sent first.
   *
   * @param {SwidgeOptions} options
   * @param {LifiSwidgeProtocolConfig} [config] - Per-call overrides for fee caps and ERC-4337 config.
   * @returns {Promise<SwidgeResult>}
   */
  async swidge (options, config) {
    if (!this._isWritableAccount()) {
      throw new LifiReadOnlyAccountError(
        "swidge() requires a writable account. Construct LifiSwidgeProtocol with a WalletAccountEvm or WalletAccountEvmErc4337."
      )
    }

    if (!this._provider) {
      throw new LifiConfigurationError(
        'A connected provider is required to execute operations. ' +
        'Pass a provider URL in account config or in the LifiSwidgeProtocolConfig.'
      )
    }

    const effectiveConfig = { ...this._config, ...config }

    const { fromToken, toToken, toChain, recipient, slippage, fromTokenAmount, toTokenAmount } = options

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
    })

    this._checkFeeCaps(quote, effectiveConfig)

    const { approveHash, resetAllowanceHash } = await this._handleApproval(
      fromToken,
      fromAddress,
      quote.estimate.approvalAddress,
      BigInt(quote.estimate.fromAmount),
      quote.estimate.skipApproval,
      config
    )

    const bridgeTx = this._buildBridgeTx(quote)

    let bridgeHash
    if (this._isErc4337Account()) {
      ;({ hash: bridgeHash } = await this._account.sendTransaction([bridgeTx], config))
    } else {
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
      fees: this._buildFees(quote),
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
   * @param {{ fromChain?: string | number, toChain?: string | number }} [options]
   * @returns {Promise<SwidgeStatusResult>}
   */
  async getSwidgeStatus (id, options = {}) {
    const params = new URLSearchParams({ txHash: id })
    if (options.fromChain !== undefined) params.set('fromChain', String(options.fromChain))
    if (options.toChain !== undefined) params.set('toChain', String(options.toChain))

    const response = await fetch(`${LIFI_API_URL}/status?${params}`, {
      headers: this._buildHeaders()
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new LifiStatusError(`LI.FI status request failed: ${error.message || response.statusText}`)
    }

    const data = await response.json()

    if (data.status === 'NOT_FOUND' || data.status === 'INVALID') {
      throw new LifiStatusError(`No swidge found for id: ${id} (LI.FI status: ${data.status})`)
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
   * @returns {Promise<SwidgeSupportedChain[]>}
   */
  async getSupportedChains () {
    const params = new URLSearchParams({ chainTypes: 'EVM,SVM,UTXO,MVM,TVM' })

    const response = await fetch(`${LIFI_API_URL}/chains?${params}`, {
      headers: this._buildHeaders()
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new LifiQuoteError(`LI.FI chains request failed: ${error.message || response.statusText}`)
    }

    const { chains } = await response.json()

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
   * @param {SwidgeSupportedTokensOptions} [options]
   * @returns {Promise<SwidgeSupportedToken[]>}
   */
  async getSupportedTokens (options = {}) {
    const params = new URLSearchParams()
    if (options.fromChain !== undefined) params.set('chains', String(options.fromChain))

    const response = await fetch(`${LIFI_API_URL}/tokens?${params}`, {
      headers: this._buildHeaders()
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new LifiQuoteError(`LI.FI tokens request failed: ${error.message || response.statusText}`)
    }

    const { tokens } = await response.json()

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

  /**
   * Resolves a WDK chain name or numeric ID to a LI.FI chain ID.
   * Returns fromChainId when toChain is undefined (same-chain swap).
   * @private
   */
  _resolveChainId (toChain, fromChainId) {
    if (toChain === undefined || toChain === null) return fromChainId
    if (typeof toChain === 'number') return toChain
    const id = CHAINS[toChain]
    if (!id) throw new LifiUnsupportedChainError(`Chain '${toChain}' is not in the supported chains map.`)
    return id
  }

  /**
   * Resolves the destination token identifier.
   * When fromToken and toToken are the same contract address across different chains
   * (the standard bridge case), resolves to the token's symbol so LI.FI can locate
   * the correct contract address on the destination chain.
   * @private
   */
  async _resolveToToken (fromToken, toToken, fromChainId, toChainId) {
    if (fromToken === toToken && fromChainId !== toChainId) {
      return this._resolveTokenSymbol(fromChainId, fromToken)
    }
    return toToken
  }

  /**
   * Resolves a token contract address to its symbol via the LI.FI token API.
   * @private
   */
  async _resolveTokenSymbol (chainId, tokenAddress) {
    const params = new URLSearchParams({ chain: String(chainId), token: tokenAddress })

    const response = await fetch(`${LIFI_API_URL}/token?${params}`, {
      headers: this._buildHeaders()
    })

    if (!response.ok) {
      throw new LifiQuoteError(
        `Failed to resolve token symbol for ${tokenAddress} on chain ${chainId} ` +
        `(${response.status} ${response.statusText}). ` +
        `Pass an explicit 'toToken' to bypass symbol resolution.`
      )
    }

    const { symbol } = await response.json()

    if (!symbol) {
      throw new LifiQuoteError(
        `LI.FI returned no symbol for token ${tokenAddress} on chain ${chainId}. ` +
        `Pass an explicit 'toToken' to bypass symbol resolution.`
      )
    }

    return symbol
  }

  /** @private */
  async _fetchQuote ({ fromChainId, toChainId, fromToken, toToken, fromAmount, toAmount, fromAddress, toAddress, slippage }) {
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

    const { order, allowBridges, denyBridges } = this._config
    if (order) params.set('order', order)
    if (allowBridges?.length) params.set('allowBridges', allowBridges.join(','))
    if (denyBridges?.length) params.set('denyBridges', denyBridges.join(','))

    const response = await fetch(`${LIFI_API_URL}/quote?${params}`, {
      headers: this._buildHeaders()
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new LifiQuoteError(`LI.FI quote request failed: ${error.message || response.statusText}`)
    }

    return response.json()
  }

  /**
   * Maps LI.FI gasCosts and feeCosts to the SwidgeFee[] format.
   * - gasCosts (SEND type) → type: 'network'   (gas/relayer costs, denominated in native token)
   * - feeCosts            → type: 'protocol'   (LI.FI's own fee, denominated in source token)
   * @private
   */
  _buildFees (quote) {
    const fees = []
    const fromChainId = quote.action?.fromChainId

    for (const gc of (quote.estimate.gasCosts || [])) {
      if (gc.type !== 'SEND') continue
      fees.push({
        type: 'network',
        amount: BigInt(gc.amount),
        token: gc.token?.address || gc.token?.symbol || 'ETH',
        chain: fromChainId,
        description: gc.name || 'Network fee'
      })
    }

    for (const fc of (quote.estimate.feeCosts || [])) {
      fees.push({
        type: 'protocol',
        amount: BigInt(fc.amount),
        token: fc.token?.address || quote.action?.fromToken?.address || '',
        chain: fromChainId,
        included: Boolean(fc.included),
        description: fc.name || 'Protocol fee'
      })
    }

    return fees
  }

  /**
   * Enforces maxNetworkFeeBps and maxProtocolFeeBps from effectiveConfig.
   * Protocol fees are compared in source token units (same denomination as fromAmount).
   * Network fees are compared via USD since they are denominated in native token.
   * @private
   */
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

  /**
   * Handles ERC-20 approval for the LI.FI Diamond contract.
   * Grants the exact minimum required amount. For tokens that revert on direct non-zero-to-non-zero
   * approval (e.g. USDT on Ethereum), resets to zero first.
   * @private
   */
  async _handleApproval (token, fromAddress, approvalAddress, amount, skipApproval, config) {
    if (skipApproval) return {}

    const tokenContract = new Contract(token, ERC20_ABI, this._provider)
    const currentAllowance = await tokenContract.allowance(fromAddress, approvalAddress)

    if (currentAllowance >= amount) return {}

    let resetAllowanceHash

    if (currentAllowance > 0n) {
      const resetTx = {
        to: token,
        data: tokenContract.interface.encodeFunctionData('approve', [approvalAddress, 0n])
      }
      const result = this._isErc4337Account()
        ? await this._account.sendTransaction([resetTx], config)
        : await this._account.sendTransaction(resetTx)
      resetAllowanceHash = result.hash
      if (!this._isErc4337Account()) await this._provider.waitForTransaction(resetAllowanceHash)
    }

    const approveTx = {
      to: token,
      data: tokenContract.interface.encodeFunctionData('approve', [approvalAddress, amount])
    }
    const result = this._isErc4337Account()
      ? await this._account.sendTransaction([approveTx], config)
      : await this._account.sendTransaction(approveTx)

    // Wait for confirmation before the bridge tx — without this the LI.FI Diamond's
    // transferFrom arrives before the allowance is on-chain, causing TransferFromFailed().
    if (!this._isErc4337Account()) await this._provider.waitForTransaction(result.hash)

    return { approveHash: result.hash, resetAllowanceHash }
  }

  /**
   * Maps LI.FI's status/substatus pair to one of the nine canonical SwidgeStatus values.
   * @private
   */
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

  /**
   * Uses prototype-chain name matching instead of instanceof so the check is immune
   * to module identity issues when the same package is installed in multiple node_modules trees.
   * @private
   */
  _isErc4337Account () {
    let proto = this._account
    while (proto && proto !== Object.prototype) {
      if (proto.constructor?.name === 'WalletAccountEvmErc4337') return true
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

  /** @private */
  _buildHeaders () {
    const headers = {}
    if (this._config.integrator) headers['x-lifi-integrator'] = this._config.integrator
    if (this._config.apiKey) headers['x-lifi-api-key'] = this._config.apiKey
    return headers
  }
}
