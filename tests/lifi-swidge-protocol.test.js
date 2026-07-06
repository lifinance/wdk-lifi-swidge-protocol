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

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import * as ethers from 'ethers'

import { WalletAccountEvm, WalletAccountReadOnlyEvm } from '@tetherto/wdk-wallet-evm'
import { WalletAccountEvmErc4337, WalletAccountReadOnlyEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337'

// Test-only mnemonic. Never funded. Only used with mock providers.
const SEED = 'cook voyage document eight skate token alien guide drink uncle term abuse'
const USER_ADDRESS = '0x405005C7c4422390F4B334F64Cf20E0b767131d0'
const TOKEN = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
const APPROVAL_ADDRESS = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

const DUMMY_QUOTE = {
  id: 'dummy-quote-id',
  type: 'LIFI',
  tool: 'across',
  toolDetails: { name: 'Stargate' },
  action: {
    fromChainId: 1,
    toChainId: 42161,
    fromToken: { symbol: 'USDT', address: TOKEN, decimals: 6 },
    toToken: { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    fromAddress: USER_ADDRESS,
    toAddress: USER_ADDRESS,
    slippage: 0.03
  },
  estimate: {
    approvalAddress: APPROVAL_ADDRESS,
    skipApproval: false,
    fromAmount: '1000000',
    fromAmountUSD: '1.00',
    toAmount: '999700',
    toAmountMin: '994700',
    toAmountUSD: '0.9997',
    executionDuration: 49,
    priceImpact: '0.0003',
    feeCosts: [
      {
        name: 'LIFI Fixed Fee',
        amount: '2300',
        amountUSD: '0.002',
        included: true,
        token: { symbol: 'USDT', address: TOKEN, decimals: 6 }
      }
    ],
    gasCosts: [
      {
        type: 'SEND',
        name: 'Network fee',
        amount: '155728000000000',
        amountUSD: '0.41',
        token: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18 }
      }
    ]
  },
  transactionRequest: {
    to: APPROVAL_ADDRESS,
    data: '0xabcdef1234567890',
    value: '0x0',
    gasLimit: '0x493e0',
    gasPrice: '0x3b9aca00',
    chainId: 1
  }
}

const DUMMY_STATUS_DONE = {
  transactionId: '0xabc123',
  status: 'DONE',
  substatus: 'COMPLETED',
  substatusMessage: 'The transfer is complete.',
  sending: { txHash: '0x1234567890abcdef' },
  receiving: { txHash: '0xfedcba0987654321' }
}

const DUMMY_CHAINS = {
  chains: [
    { id: 1, name: 'Ethereum', chainType: 'EVM', nativeToken: { symbol: 'ETH' } },
    { id: 42161, name: 'Arbitrum One', chainType: 'EVM', nativeToken: { symbol: 'ETH' } }
  ]
}

const DUMMY_SOURCE_TOKEN = {
  symbol: 'USDT',
  decimals: 6,
  coinKey: 'USDT',
  marketCapUSD: 1e11,
  tags: ['stablecoin']
}

const DUMMY_DEST_TOKEN = {
  address: TOKEN,
  symbol: 'USDT0',
  decimals: 6,
  coinKey: 'USDT0',
  marketCapUSD: 4e9,
  tags: ['stablecoin']
}

const DUMMY_TOKENS = {
  tokens: {
    1: [
      { address: TOKEN, symbol: 'USDT', decimals: 6, name: 'Tether USD' }
    ],
    42161: [DUMMY_DEST_TOKEN],
    8453: [{ ...DUMMY_DEST_TOKEN, symbol: 'USDT', coinKey: 'USDT', priceUSD: '1.00' }]
  }
}

const LIFI_API = 'https://li.quest/v1'
const NATIVE_VALUE_DENY_BRIDGES = 'glacis%2CstargateV2%2CstargateV2Bus%2Csquid%2Carbitrum%2CgasZipBridge'
const DEFAULT_DENY_QUERY = `&denyBridges=${NATIVE_VALUE_DENY_BRIDGES}`

// Second fetch argument produced by the request layer; the abort signal is the
// only value that genuinely cannot be predicted.
const FETCH_OPTS = { headers: {}, signal: expect.any(AbortSignal) }

// Fees derived deterministically from DUMMY_QUOTE by the fee mapping.
const EXPECTED_FEES = [
  {
    type: 'network',
    amount: 155_728_000_000_000n,
    token: '0x0000000000000000000000000000000000000000',
    chain: 1,
    description: 'Network fee'
  },
  {
    type: 'protocol',
    amount: 2300n,
    token: TOKEN,
    chain: 1,
    included: true,
    description: 'LIFI Fixed Fee'
  }
]

const getNetworkMock = jest.fn()
const waitForTransactionMock = jest.fn().mockResolvedValue({})
const allowanceMock = jest.fn()

jest.unstable_mockModule('ethers', () => ({
  ...ethers,
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getNetwork: getNetworkMock,
    waitForTransaction: waitForTransactionMock
  })),
  Contract: jest.fn().mockImplementation((target, abi, provider) => {
    const contract = new ethers.Contract(target, abi, provider)
    contract.allowance = allowanceMock
    return contract
  })
}))

const {
  LifiSwidgeProtocol,
  LifiQuoteError,
  LifiStatusError,
  LifiSlippageError
} = await import('../index.js')

// ─── Helper: default fetch mock ──────────────────────────────────────────────

function mockFetch (overrides = {}) {
  global.fetch = jest.fn().mockImplementation((url) => {
    if (overrides[url]) return Promise.resolve(overrides[url])
    // Check /tokens before /token — /tokens URL also matches /token substring
    if (url.includes('/tokens')) {
      return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
    }
    if (url.includes('/token')) {
      return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
    }
    if (url.includes('/chains')) {
      return Promise.resolve({ ok: true, json: async () => DUMMY_CHAINS })
    }
    if (url.includes('/status')) {
      return Promise.resolve({ ok: true, json: async () => DUMMY_STATUS_DONE })
    }
    return Promise.resolve({ ok: true, json: async () => DUMMY_QUOTE })
  })
}

// ─── EOA account suite ────────────────────────────────────────────────────────

describe('@kenny_io/wdk-protocol-swidge-lifi', () => {
  describe('with WalletAccountEvm (EOA)', () => {
    let account, protocol

    beforeEach(() => {
      account = new WalletAccountEvm(SEED, "0'/0/0", { provider: 'https://dummy-rpc-url.com' })
      protocol = new LifiSwidgeProtocol(account)
      getNetworkMock.mockResolvedValue({ chainId: 1n })
      mockFetch()
    })

    // ── quoteSwidge ────────────────────────────────────────────────────────

    describe('quoteSwidge', () => {
      test('returns SwidgeQuote with all required fields', async () => {
        const result = await protocol.quoteSwidge({
          fromToken: TOKEN,
          toToken: TOKEN,
          toChain: 'arbitrum',
          recipient: USER_ADDRESS,
          fromTokenAmount: 1_000_000n
        })

        expect(result.fromTokenAmount).toBe(1_000_000n)
        expect(result.toTokenAmount).toBe(999_700n)
        expect(result.toTokenAmountMin).toBe(994_700n)
        expect(result.estimatedDuration).toBe(49)
        expect(result.priceImpact).toBe(0.0003)
        expect(result.fees).toEqual(EXPECTED_FEES)
      })

      test('fees array contains network and protocol entries', async () => {
        const { fees } = await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(fees).toEqual(EXPECTED_FEES)
      })

      test('resolves toToken to destination address when fromToken === toToken cross-chain', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(`${LIFI_API}/token?chain=1&token=${TOKEN}`, FETCH_OPTS)
        expect(global.fetch).toHaveBeenCalledWith(`${LIFI_API}/tokens?chains=42161&search=USDT&limit=20`, FETCH_OPTS)
        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('skips token resolution when toToken differs from fromToken', async () => {
        const OTHER_TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: OTHER_TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const tokenCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/token'))
        expect(tokenCalls).toHaveLength(0)

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${OTHER_TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('skips token resolution when toToken is already a symbol', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: 'USDC', toChain: 'optimism', fromTokenAmount: 1_000_000n
        })

        const tokenCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/token'))
        expect(tokenCalls).toHaveLength(0)

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=10&fromToken=${TOKEN}&toToken=USDC&fromAmount=1000000&fromAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('omits toChain param when not provided (same-chain swap)', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: 'USDC', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=1&fromToken=${TOKEN}&toToken=USDC&fromAmount=1000000&fromAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('accepts a raw numeric toChain ID', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 8453, fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=8453&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('forwards slippage to the quote API', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n, slippage: 0.01
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&slippage=0.01${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('forwards order config to the quote API', async () => {
        const ordered = new LifiSwidgeProtocol(account, { order: 'FASTEST' })

        await ordered.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&order=FASTEST${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('forwards allowBridges and denyBridges to the quote API', async () => {
        const filtered = new LifiSwidgeProtocol(account, {
          allowBridges: ['stargate', 'cctp'],
          denyBridges: ['across']
        })

        await filtered.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&allowBridges=stargate%2Ccctp&denyBridges=across`,
          FETCH_OPTS
        )
      })

      test('uses the native-value bridge deny list by default', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('overrides the native-value bridge deny list when denyBridges is set', async () => {
        const filtered = new LifiSwidgeProtocol(account, {
          denyBridges: ['customBridge']
        })

        await filtered.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&denyBridges=customBridge`,
          FETCH_OPTS
        )
      })

      test('allows clearing the native-value bridge deny list with an empty denyBridges array', async () => {
        const unfiltered = new LifiSwidgeProtocol(account, {
          denyBridges: []
        })

        await unfiltered.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}`,
          FETCH_OPTS
        )
      })

      test('returns empty fees arrays when estimate arrays are empty', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/tokens')) return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...DUMMY_QUOTE,
              estimate: { ...DUMMY_QUOTE.estimate, feeCosts: [], gasCosts: [] }
            })
          })
        })

        const { fees } = await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(fees).toHaveLength(0)
      })

      test('throws LifiConfigurationError when no provider is set', async () => {
        const noProvider = new LifiSwidgeProtocol(new WalletAccountEvm(SEED, "0'/0/0"))

        await expect(noProvider.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('A connected provider is required to fetch quotes.')
      })

      test('throws LifiUnsupportedChainError for unknown chain name', async () => {
        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'unknown-chain', fromTokenAmount: 1_000_000n
        })).rejects.toThrow("Chain 'unknown-chain' is not in the supported chains map.")
      })

      test('throws LifiQuoteError when quote API returns non-OK', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/tokens')) return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
          return Promise.resolve({ ok: false, statusText: 'Bad Request', json: async () => ({ message: 'Invalid params' }) })
        })

        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('LI.FI quote request failed: Invalid params')
      })

      test('throws LifiQuoteError when token resolution returns non-OK', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
          return Promise.resolve({ ok: true, json: async () => DUMMY_QUOTE })
        })

        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow(`Failed to resolve token for ${TOKEN} on chain 1`)
      })

      test('throws LifiQuoteError when token resolution returns no symbol', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => ({}) })
          return Promise.resolve({ ok: true, json: async () => DUMMY_QUOTE })
        })

        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow(`LI.FI returned no symbol for token ${TOKEN} on chain 1`)
      })
    })

    // ── swidge ────────────────────────────────────────────────────────────

    describe('swidge', () => {
      beforeEach(() => {
        allowanceMock.mockResolvedValue(0n)
        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-approve-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-bridge-hash' })
      })

      test('returns SwidgeResult with id, fees, transactions, and amounts', async () => {
        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum',
          recipient: USER_ADDRESS, fromTokenAmount: 1_000_000n
        })

        expect(result.id).toBe('dummy-bridge-hash')
        expect(result.hash).toBe('dummy-bridge-hash')
        expect(result.fromTokenAmount).toBe(1_000_000n)
        expect(result.toTokenAmount).toBe(999_700n)
        expect(result.toTokenAmountMin).toBe(994_700n)
        expect(result.fees).toEqual(EXPECTED_FEES)
        expect(result.transactions).toEqual([
          { hash: 'dummy-approve-hash', chain: 1, type: 'approval' },
          { hash: 'dummy-bridge-hash', chain: 1, type: 'source' }
        ])
      })

      test('transactions array includes approval and source entries', async () => {
        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum',
          recipient: USER_ADDRESS, fromTokenAmount: 1_000_000n
        })

        expect(result.transactions).toEqual([
          { hash: 'dummy-approve-hash', chain: 1, type: 'approval' },
          { hash: 'dummy-bridge-hash', chain: 1, type: 'source' }
        ])
      })

      test('calls quote API with correct params', async () => {
        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum',
          recipient: USER_ADDRESS, fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&toAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('skips approval when skipApproval is true', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/tokens')) return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...DUMMY_QUOTE, estimate: { ...DUMMY_QUOTE.estimate, skipApproval: true } })
          })
        })

        account.sendTransaction = jest.fn().mockResolvedValueOnce({ hash: 'dummy-bridge-hash' })

        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(result.id).toBe('dummy-bridge-hash')
        expect(result.transactions.filter(t => t.type === 'approval')).toHaveLength(0)
        expect(account.sendTransaction).toHaveBeenCalledTimes(1)
      })

      test('skips approval when existing allowance is sufficient', async () => {
        allowanceMock.mockResolvedValue(1_000_000n)
        account.sendTransaction = jest.fn().mockResolvedValueOnce({ hash: 'dummy-bridge-hash' })

        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(result.transactions.filter(t => t.type === 'approval')).toHaveLength(0)
        expect(account.sendTransaction).toHaveBeenCalledTimes(1)
      })

      test('resets allowance to zero before approving when non-zero allowance exists', async () => {
        allowanceMock.mockResolvedValue(500n)
        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-reset-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-approve-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-bridge-hash' })

        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(account.sendTransaction).toHaveBeenCalledTimes(3)

        const approvalTxs = result.transactions.filter(t => t.type === 'approval')
        expect(approvalTxs).toHaveLength(2)
        expect(approvalTxs[0].hash).toBe('dummy-reset-hash')
        expect(approvalTxs[1].hash).toBe('dummy-approve-hash')
      })

      test('waits for approval confirmation before submitting bridge tx', async () => {
        const callOrder = []
        account.sendTransaction = jest.fn()
          .mockImplementationOnce(async () => { callOrder.push('approve'); return { hash: 'approve-hash' } })
          .mockImplementationOnce(async () => { callOrder.push('bridge'); return { hash: 'bridge-hash' } })
        waitForTransactionMock.mockImplementationOnce(async () => { callOrder.push('wait'); return {} })

        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(callOrder).toEqual(['approve', 'wait', 'bridge'])
      })

      test('throws LifiExecutionError when maxProtocolFeeBps is exceeded', async () => {
        const capped = new LifiSwidgeProtocol(account, { maxProtocolFeeBps: 1 })

        await expect(capped.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('Protocol fee exceeds maxProtocolFeeBps limit.')

        expect(account.sendTransaction).not.toHaveBeenCalled()
      })

      test('throws LifiExecutionError when maxNetworkFeeBps is exceeded', async () => {
        // 0.41 USD fee / 1.00 USD input = 4100 bps, so cap at 1 bps to trigger
        const capped = new LifiSwidgeProtocol(account, { maxNetworkFeeBps: 1 })

        await expect(capped.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('Network fee exceeds maxNetworkFeeBps limit.')

        expect(account.sendTransaction).not.toHaveBeenCalled()
      })

      test('rejects quotes that require native token value before approval by default', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/tokens')) return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...DUMMY_QUOTE,
              transactionRequest: { ...DUMMY_QUOTE.transactionRequest, value: '1' }
            })
          })
        })

        allowanceMock.mockClear()

        await expect(protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('Selected LI.FI route requires native token value')

        expect(allowanceMock).not.toHaveBeenCalled()
        expect(account.sendTransaction).not.toHaveBeenCalled()
      })

      test('per-call config overrides protocol-level maxProtocolFeeBps', async () => {
        const uncapped = new LifiSwidgeProtocol(account)

        await expect(uncapped.swidge(
          { fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n },
          { maxProtocolFeeBps: 1 }
        )).rejects.toThrow('Protocol fee exceeds maxProtocolFeeBps limit.')
      })

      test('throws LifiReadOnlyAccountError when account is read-only', async () => {
        const readOnly = new LifiSwidgeProtocol(
          new WalletAccountReadOnlyEvm(USER_ADDRESS, { provider: 'https://dummy-rpc-url.com' })
        )

        await expect(readOnly.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('swidge() requires a writable account.')
      })

      test('throws LifiConfigurationError when no provider is set', async () => {
        const noProvider = new LifiSwidgeProtocol(new WalletAccountEvm(SEED, "0'/0/0"))

        await expect(noProvider.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('A connected provider is required to execute operations.')
      })

      test('throws LifiUnsupportedChainError for unknown chain name', async () => {
        await expect(protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'unknown-chain', fromTokenAmount: 1_000_000n
        })).rejects.toThrow("Chain 'unknown-chain' is not in the supported chains map.")

        expect(account.sendTransaction).not.toHaveBeenCalled()
      })

      test('accepts raw numeric toChain ID', async () => {
        account.sendTransaction = jest.fn().mockResolvedValue({ hash: 'dummy-hash' })
        allowanceMock.mockResolvedValue(1_000_000n)

        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 8453, fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=8453&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&toAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('excludes APPROVE-type gas costs from network fees', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/tokens')) return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...DUMMY_QUOTE,
              estimate: {
                ...DUMMY_QUOTE.estimate,
                gasCosts: [
                  { type: 'APPROVE', amount: '50000000000000', amountUSD: '0.13', token: { symbol: 'ETH' } },
                  { type: 'SEND', amount: '155728000000000', amountUSD: '0.41', token: { symbol: 'ETH' } }
                ]
              }
            })
          })
        })

        account.sendTransaction = jest.fn().mockResolvedValue({ hash: 'dummy-hash' })
        allowanceMock.mockResolvedValue(1_000_000n)

        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const networkFees = result.fees.filter(f => f.type === 'network')
        expect(networkFees).toHaveLength(1)
        expect(networkFees[0].amount).toBe(155_728_000_000_000n)
      })
    })

    // ── getSwidgeStatus ───────────────────────────────────────────────────

    describe('getSwidgeStatus', () => {
      test('maps DONE/COMPLETED to "completed" and returns transactions', async () => {
        const result = await protocol.getSwidgeStatus('0xabc123', { fromChain: 1, toChain: 42161 })

        expect(result.status).toBe('completed')
        expect(result.transactions).toEqual([
          { hash: '0x1234567890abcdef', chain: 1, type: 'source' },
          { hash: '0xfedcba0987654321', chain: 42161, type: 'destination' }
        ])
      })

      test('includes fromChain and toChain in status request', async () => {
        await protocol.getSwidgeStatus('0xabc123', { fromChain: 1, toChain: 42161 })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/status?txHash=0xabc123&fromChain=1&toChain=42161`,
          FETCH_OPTS
        )
      })

      test('maps DONE/PARTIAL to "partial"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ ...DUMMY_STATUS_DONE, substatus: 'PARTIAL' })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('partial')
      })

      test('maps DONE/REFUNDED to "refunded"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ ...DUMMY_STATUS_DONE, substatus: 'REFUNDED' })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('refunded')
      })

      test('maps DONE/NOT_PROCESSABLE_REFUND_NEEDED to "refund-pending"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ ...DUMMY_STATUS_DONE, substatus: 'NOT_PROCESSABLE_REFUND_NEEDED' })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('refund-pending')
      })

      test('maps PENDING to "pending"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ status: 'PENDING', substatus: null })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('pending')
      })

      test('maps FAILED to "failed"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ status: 'FAILED', substatus: null })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('failed')
      })

      test('maps requiredActions to "action-required" regardless of status', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ status: 'PENDING', substatus: null, requiredActions: [{ type: 'SIGN' }] })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('action-required')
      })

      test('throws LifiStatusError when status is NOT_FOUND', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ status: 'NOT_FOUND' })
        })

        await expect(protocol.getSwidgeStatus('0xbad'))
          .rejects.toThrow('No swidge found for id: 0xbad (LI.FI status: NOT_FOUND)')
      })

      test('throws LifiStatusError when API returns non-OK', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false, statusText: 'Not Found', json: async () => ({ message: 'Transaction not found' })
        })

        await expect(protocol.getSwidgeStatus('0xbad'))
          .rejects.toThrow('LI.FI status request failed: Transaction not found')
      })
    })

    // ── getSupportedChains ────────────────────────────────────────────────

    describe('getSupportedChains', () => {
      test('returns array of SwidgeSupportedChain objects', async () => {
        const chains = await protocol.getSupportedChains()

        expect(chains).toEqual([
          { id: 1, name: 'Ethereum', type: 'evm', nativeToken: 'ETH' },
          { id: 42161, name: 'Arbitrum One', type: 'evm', nativeToken: 'ETH' }
        ])
      })

      test('calls the chains API with all chain types', async () => {
        await protocol.getSupportedChains()

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/chains?chainTypes=EVM%2CSVM%2CUTXO%2CMVM%2CTVM`,
          FETCH_OPTS
        )
      })

      test('throws LifiQuoteError when chains API returns non-OK', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false, statusText: 'Service Unavailable', json: async () => ({})
        })

        await expect(protocol.getSupportedChains()).rejects.toThrow('LI.FI chains request failed: Service Unavailable')
      })
    })

    // ── getSupportedTokens ────────────────────────────────────────────────

    describe('getSupportedTokens', () => {
      test('returns flat array of SwidgeSupportedToken objects', async () => {
        const tokens = await protocol.getSupportedTokens()

        expect(tokens).toEqual([
          { token: TOKEN, chain: 1, symbol: 'USDT', decimals: 6, address: TOKEN, name: 'Tether USD' },
          { token: TOKEN, chain: 8453, symbol: 'USDT', decimals: 6, address: TOKEN, name: undefined },
          { token: TOKEN, chain: 42161, symbol: 'USDT0', decimals: 6, address: TOKEN, name: undefined }
        ])
      })

      test('passes fromChain as chains filter when provided', async () => {
        await protocol.getSupportedTokens({ fromChain: 1 })

        expect(global.fetch).toHaveBeenCalledWith(`${LIFI_API}/tokens?chains=1`, FETCH_OPTS)
      })

      test('omits chains filter when no options provided', async () => {
        await protocol.getSupportedTokens()

        expect(global.fetch).toHaveBeenCalledWith(`${LIFI_API}/tokens?`, FETCH_OPTS)
      })
    })

    // ── Legacy delegation ─────────────────────────────────────────────────

    describe('legacy delegation — bridge()', () => {
      beforeEach(() => {
        allowanceMock.mockResolvedValue(0n)
        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-approve-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-bridge-hash' })
      })

      test('delegates to swidge() and returns {hash, fee, bridgeFee}', async () => {
        const result = await protocol.bridge({
          token: TOKEN, targetChain: 'arbitrum', recipient: USER_ADDRESS, amount: 1_000_000n
        })

        expect(result.hash).toBe('dummy-bridge-hash')
        expect(result.fee).toBe(155_728_000_000_000n)
        expect(result.bridgeFee).toBe(2300n)
      })

      test('sets toToken = fromToken so swidge resolves the destination address cross-chain', async () => {
        await protocol.bridge({
          token: TOKEN, targetChain: 'arbitrum', recipient: USER_ADDRESS, amount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&toAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })
    })

    describe('legacy delegation — quoteBridge()', () => {
      test('delegates to quoteSwidge() and returns {fee, bridgeFee}', async () => {
        const result = await protocol.quoteBridge({
          token: TOKEN, targetChain: 'arbitrum', recipient: USER_ADDRESS, amount: 1_000_000n
        })

        expect(result.fee).toBe(155_728_000_000_000n)
        expect(result.bridgeFee).toBe(2300n)
      })
    })

    describe('legacy delegation — swap()', () => {
      test('delegates to swidge() and returns {hash, fee, tokenInAmount, tokenOutAmount}', async () => {
        allowanceMock.mockResolvedValue(0n)
        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-approve-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-swap-hash' })

        const result = await protocol.swap({
          tokenIn: TOKEN,
          tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          tokenInAmount: 1_000_000n
        })

        expect(result.hash).toBe('dummy-swap-hash')
        expect(result.tokenInAmount).toBe(1_000_000n)
        expect(result.tokenOutAmount).toBe(999_700n)
        // Legacy swap fee aggregates network + protocol fees
        expect(result.fee).toBe(155_728_000_002_300n)
      })
    })

    describe('legacy delegation — quoteSwap()', () => {
      test('delegates to quoteSwidge() and returns {fee, tokenInAmount, tokenOutAmount}', async () => {
        const result = await protocol.quoteSwap({
          tokenIn: TOKEN,
          tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          tokenInAmount: 1_000_000n
        })

        expect(result.tokenInAmount).toBe(1_000_000n)
        expect(result.tokenOutAmount).toBe(999_700n)
        // Legacy swap fee aggregates network + protocol fees
        expect(result.fee).toBe(155_728_000_002_300n)
      })
    })
  })

  // ─── ERC-4337 account suite ───────────────────────────────────────────────

  describe('with WalletAccountEvmErc4337', () => {
    // Deterministic approve() calldata computed with the real ethers ABI coder.
    const ERC20_INTERFACE = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)'])
    const EXPECTED_APPROVE_DATA = ERC20_INTERFACE.encodeFunctionData('approve', [APPROVAL_ADDRESS, 1_000_000n])
    const EXPECTED_RESET_DATA = ERC20_INTERFACE.encodeFunctionData('approve', [APPROVAL_ADDRESS, 0n])

    let account, protocol

    beforeEach(() => {
      account = new WalletAccountEvmErc4337(SEED, "0'/0/0", {
        chainId: 1,
        provider: 'https://dummy-rpc-url.com'
      })
      // The ERC-4337 address is a counterfactual smart-account address (not the
      // EOA derivation), so it is mocked rather than derived.
      account.getAddress = jest.fn().mockResolvedValue(USER_ADDRESS)
      protocol = new LifiSwidgeProtocol(account)
      getNetworkMock.mockResolvedValue({ chainId: 1n })
      waitForTransactionMock.mockClear()
      mockFetch()
    })

    describe('swidge', () => {
      beforeEach(() => {
        allowanceMock.mockResolvedValue(0n)
        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-approve-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-bridge-hash' })
      })

      test('wraps approval transaction in an array for ERC-4337', async () => {
        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const approveCall = account.sendTransaction.mock.calls[0][0]
        expect(approveCall).toEqual([{ to: TOKEN, data: EXPECTED_APPROVE_DATA }])
      })

      test('wraps bridge transaction in an array for ERC-4337', async () => {
        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const bridgeCall = account.sendTransaction.mock.calls[1][0]
        expect(bridgeCall).toEqual([{
          to: APPROVAL_ADDRESS,
          data: DUMMY_QUOTE.transactionRequest.data,
          value: 0n,
          gasLimit: 300_000n
        }])
      })

      test('uses zero-native-value routing by default', async () => {
        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(global.fetch).toHaveBeenCalledWith(
          `${LIFI_API}/quote?fromChain=1&toChain=42161&fromToken=${TOKEN}&toToken=${TOKEN}&fromAmount=1000000&fromAddress=${USER_ADDRESS}&toAddress=${USER_ADDRESS}${DEFAULT_DENY_QUERY}`,
          FETCH_OPTS
        )
      })

      test('resets allowance before approving when non-zero allowance exists', async () => {
        allowanceMock.mockResolvedValue(500n)
        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-reset-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-approve-hash' })
          .mockResolvedValueOnce({ hash: 'dummy-bridge-hash' })

        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(account.sendTransaction).toHaveBeenCalledTimes(3)
        const resetCall = account.sendTransaction.mock.calls[0][0]
        expect(resetCall).toEqual([{ to: TOKEN, data: EXPECTED_RESET_DATA }])

        const approvalTxs = result.transactions.filter(t => t.type === 'approval')
        expect(approvalTxs[0].hash).toBe('dummy-reset-hash')
        expect(approvalTxs[1].hash).toBe('dummy-approve-hash')
      })

      test('does not wait for transaction after approval (ERC-4337 batches internally)', async () => {
        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        expect(waitForTransactionMock).not.toHaveBeenCalled()
      })

      test('throws LifiReadOnlyAccountError when ERC-4337 account is read-only', async () => {
        const readOnly = new LifiSwidgeProtocol(
          new WalletAccountReadOnlyEvmErc4337(USER_ADDRESS, {
            chainId: 1, provider: 'https://dummy-rpc-url.com'
          })
        )

        await expect(readOnly.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('swidge() requires a writable account.')
      })

      test('allows per-call maxProtocolFeeBps override', async () => {
        await expect(protocol.swidge(
          { fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n },
          { maxProtocolFeeBps: 1 }
        )).rejects.toThrow('Protocol fee exceeds maxProtocolFeeBps limit.')
      })
    })
  })

  // ─── No account (quote-only) ──────────────────────────────────────────────

  describe('without account (quote and discovery only)', () => {
    let protocol

    beforeEach(() => {
      protocol = new LifiSwidgeProtocol(undefined, { provider: 'https://dummy-rpc-url.com' })
      getNetworkMock.mockResolvedValue({ chainId: 1n })
      mockFetch()
    })

    test('quoteSwidge works without an account', async () => {
      const result = await protocol.quoteSwidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })

      expect(result.fromTokenAmount).toBe(1_000_000n)
    })

    test('getSupportedChains works without an account', async () => {
      const chains = await protocol.getSupportedChains()
      expect(chains).toHaveLength(2)
    })

    test('getSupportedTokens works without an account', async () => {
      const tokens = await protocol.getSupportedTokens()
      expect(tokens).toHaveLength(3)
    })

    test('swidge throws LifiReadOnlyAccountError without an account', async () => {
      await expect(protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow('swidge() requires a writable account.')
    })
  })

  // ─── Reliability: timeouts, retries, error classification ────────────────

  describe('reliability', () => {
    let account, protocol

    beforeEach(() => {
      account = new WalletAccountEvm(SEED, "0'/0/0", { provider: 'https://dummy-rpc-url.com' })
      protocol = new LifiSwidgeProtocol(account, { retryDelay: 0 })
      getNetworkMock.mockResolvedValue({ chainId: 1n })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('retries on 500 and succeeds on the second attempt', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => DUMMY_CHAINS })

      const chains = await protocol.getSupportedChains()

      expect(chains).toHaveLength(2)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('throws the endpoint error class after exhausting retries on persistent 5xx', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 502, statusText: 'Bad Gateway', json: async () => ({})
      })

      await expect(protocol.getSupportedChains()).rejects.toThrow('LI.FI chains request failed: Bad Gateway')
      expect(global.fetch).toHaveBeenCalledTimes(2) // default: 1 retry, 2 attempts total
    })

    test('honors a custom retries count', async () => {
      const persistent = new LifiSwidgeProtocol(account, { retries: 3, retryDelay: 0 })
      global.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({})
      })

      await expect(persistent.getSupportedChains()).rejects.toThrow('LI.FI chains request failed: Service Unavailable')
      expect(global.fetch).toHaveBeenCalledTimes(4)
    })

    test('retries: 0 disables retrying', async () => {
      const noRetry = new LifiSwidgeProtocol(account, { retries: 0 })
      global.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({})
      })

      await expect(noRetry.getSupportedChains()).rejects.toThrow('LI.FI chains request failed: Internal Server Error')
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    test('does not retry client errors (400)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ message: 'Invalid params' })
      })

      await expect(protocol.getSupportedChains())
        .rejects.toThrow('LI.FI chains request failed: Invalid params')
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    test('retries 429 honoring the Retry-After header', async () => {
      jest.useFakeTimers()
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => '2' }, json: async () => ({})
        })
        .mockResolvedValueOnce({ ok: true, json: async () => DUMMY_CHAINS })

      const promise = protocol.getSupportedChains()

      await jest.advanceTimersByTimeAsync(1_999)
      expect(global.fetch).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(1)
      const chains = await promise

      expect(chains).toHaveLength(2)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('throws LifiRateLimitError when 429 persists after retries', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({})
      })

      await expect(protocol.getSupportedChains()).rejects.toThrow('LI.FI chains request failed: rate limit exceeded: Too Many Requests')
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('maps 409 on /quote to LifiSlippageError without retrying', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/tokens')) return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
        if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
        return Promise.resolve({ ok: false, status: 409, statusText: 'Conflict', json: async () => ({}) })
      })

      const err = await protocol.quoteSwidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      }).catch(e => e)

      expect(err).toBeInstanceOf(LifiSlippageError)
      expect(err).toBeInstanceOf(LifiQuoteError) // subclass keeps existing catch blocks working

      const quoteCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/quote'))
      expect(quoteCalls).toHaveLength(1)
    })

    test('retries network errors and succeeds', async () => {
      global.fetch = jest.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({ ok: true, json: async () => DUMMY_CHAINS })

      const chains = await protocol.getSupportedChains()

      expect(chains).toHaveLength(2)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('throws LifiNetworkError when network failures persist', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'))

      await expect(protocol.getSupportedChains()).rejects.toThrow('LI.FI chains request failed: fetch failed')
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('throws LifiTimeoutError when a request hangs past the timeout', async () => {
      jest.useFakeTimers()
      const hung = new LifiSwidgeProtocol(account, { timeout: 1_000, retries: 0 })
      global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}))

      const assertion = expect(hung.getSupportedChains()).rejects.toThrow('LI.FI request timed out after 1000ms')
      await jest.advanceTimersByTimeAsync(1_000)
      await assertion
    })

    test('tags NOT_FOUND status errors with a machine-readable lifiStatus', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true, json: async () => ({ status: 'NOT_FOUND' })
      })

      const err = await protocol.getSwidgeStatus('0xbad').catch(e => e)

      expect(err).toBeInstanceOf(LifiStatusError)
      expect(err.lifiStatus).toBe('NOT_FOUND')
    })
  })

  // ─── Input validation ─────────────────────────────────────────────────────

  describe('input validation', () => {
    let account, protocol

    beforeEach(() => {
      account = new WalletAccountEvm(SEED, "0'/0/0", { provider: 'https://dummy-rpc-url.com' })
      protocol = new LifiSwidgeProtocol(account)
      getNetworkMock.mockResolvedValue({ chainId: 1n })
      mockFetch()
    })

    test('rejects a missing fromToken before any API call', async () => {
      await expect(protocol.quoteSwidge({
        toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow("'fromToken' is required and must be a token address or symbol.")

      expect(global.fetch).not.toHaveBeenCalled()
    })

    test('rejects an invalid recipient address', async () => {
      await expect(protocol.quoteSwidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n, recipient: 'not-an-address'
      })).rejects.toThrow("'recipient' is not a valid address: not-an-address")

      expect(global.fetch).not.toHaveBeenCalled()
    })

    test('rejects slippage outside the 0-1 range', async () => {
      await expect(protocol.quoteSwidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n, slippage: 1.5
      })).rejects.toThrow("'slippage' must be a decimal between 0 and 1 (e.g. 0.03 for 3%), got: 1.5")

      expect(global.fetch).not.toHaveBeenCalled()
    })

    test('rejects a zero amount', async () => {
      await expect(protocol.quoteSwidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 0n
      })).rejects.toThrow("'fromTokenAmount' must be greater than zero.")

      expect(global.fetch).not.toHaveBeenCalled()
    })

    test('rejects when neither fromTokenAmount nor toTokenAmount is provided', async () => {
      await expect(protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum'
      })).rejects.toThrow("Either 'fromTokenAmount' or 'toTokenAmount' must be provided.")

      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  // ─── Quote transaction validation ─────────────────────────────────────────

  describe('quote transaction validation', () => {
    const ZKSYNC_DIAMOND = '0x341e94069f53234fE6DabeF707aD424830525715'
    const ROGUE = '0x000000000000000000000000000000000000dEaD'

    let account, protocol

    function mockQuoteWith (txOverrides = {}, estimateOverrides = {}) {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/tokens')) return Promise.resolve({ ok: true, json: async () => DUMMY_TOKENS })
        if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => DUMMY_SOURCE_TOKEN })
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...DUMMY_QUOTE,
            estimate: { ...DUMMY_QUOTE.estimate, ...estimateOverrides },
            transactionRequest: { ...DUMMY_QUOTE.transactionRequest, ...txOverrides }
          })
        })
      })
    }

    beforeEach(() => {
      account = new WalletAccountEvm(SEED, "0'/0/0", { provider: 'https://dummy-rpc-url.com' })
      protocol = new LifiSwidgeProtocol(account, { trustedContracts: true })
      getNetworkMock.mockResolvedValue({ chainId: 1n })
      allowanceMock.mockResolvedValue(0n)
      account.sendTransaction = jest.fn().mockResolvedValue({ hash: 'dummy-hash' })
    })

    test('rejects non-hex calldata even without trustedContracts', async () => {
      const plain = new LifiSwidgeProtocol(account)
      mockQuoteWith({ data: 'not-hex' })

      await expect(plain.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow('LI.FI quote transactionRequest.data is not valid hex calldata.')

      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('rejects an unparseable transaction value', async () => {
      mockQuoteWith({ value: 'not-a-number' })

      await expect(protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow('LI.FI quote transactionRequest value/gasLimit are not parseable amounts.')

      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('trustedContracts: true accepts the canonical LI.FI Diamond target', async () => {
      mockQuoteWith() // DUMMY_QUOTE targets the canonical Diamond

      const result = await protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })

      expect(result.hash).toBe('dummy-hash')
    })

    test('trustedContracts: true rejects an unknown target before any approval is sent', async () => {
      mockQuoteWith({ to: ROGUE })

      await expect(protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow(`LI.FI quote targets contract ${ROGUE} on chain 1`)

      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('trustedContracts: true rejects an untrusted approvalAddress', async () => {
      mockQuoteWith({}, { approvalAddress: ROGUE })

      await expect(protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow(`LI.FI quote requests approval for ${ROGUE} on chain 1`)

      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('a trustedContracts map extends the built-in allowlist', async () => {
      const extended = new LifiSwidgeProtocol(account, { trustedContracts: { 1: ROGUE } })
      mockQuoteWith({ to: ROGUE })

      const result = await extended.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })

      expect(result.hash).toBe('dummy-hash')
    })

    test('without trustedContracts the target is forwarded as-is (LI.FI SDK parity)', async () => {
      const plain = new LifiSwidgeProtocol(account)
      mockQuoteWith({ to: ROGUE })

      const result = await plain.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })

      expect(result.hash).toBe('dummy-hash')
    })

    test('zkSync Era uses its own Diamond deployment', async () => {
      getNetworkMock.mockResolvedValue({ chainId: 324n })
      mockQuoteWith({ to: ZKSYNC_DIAMOND }, { approvalAddress: ZKSYNC_DIAMOND })

      const result = await protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })

      expect(result.hash).toBe('dummy-hash')
    })

    test('the canonical Diamond is rejected on zkSync Era (per-chain entry replaces the default)', async () => {
      getNetworkMock.mockResolvedValue({ chainId: 324n })
      mockQuoteWith() // canonical Diamond target

      await expect(protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow(`LI.FI quote targets contract ${APPROVAL_ADDRESS} on chain 324`)
    })
  })
})
