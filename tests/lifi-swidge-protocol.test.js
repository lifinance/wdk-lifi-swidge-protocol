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

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import * as ethers from 'ethers'

import { WalletAccountEvm, WalletAccountReadOnlyEvm } from '@tetherto/wdk-wallet-evm'
import { WalletAccountEvmErc4337, WalletAccountReadOnlyEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337'

// Test-only mnemonic. Never funded. Only used with mock providers.
const SEED = 'test test test test test test test test test test test junk'
const USER_ADDRESS = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'
const TOKEN = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
const APPROVAL_ADDRESS = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

const MOCK_QUOTE = {
  id: 'mock-quote-id',
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

const MOCK_STATUS_DONE = {
  transactionId: '0xabc123',
  status: 'DONE',
  substatus: 'COMPLETED',
  substatusMessage: 'The transfer is complete.',
  sending: { txHash: '0x1234567890abcdef' },
  receiving: { txHash: '0xfedcba0987654321' }
}

const MOCK_CHAINS = {
  chains: [
    { id: 1, name: 'Ethereum', chainType: 'EVM', nativeToken: { symbol: 'ETH' } },
    { id: 42161, name: 'Arbitrum One', chainType: 'EVM', nativeToken: { symbol: 'ETH' } }
  ]
}

const MOCK_TOKENS = {
  tokens: {
    1: [
      { address: TOKEN, symbol: 'USDT', decimals: 6, name: 'Tether USD' }
    ]
  }
}

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

const { LifiSwidgeProtocol, LifiReadOnlyAccountError, LifiConfigurationError, LifiExecutionError, LifiStatusError, LifiUnsupportedChainError } = await import('../index.js')

// ─── Helper: default fetch mock ──────────────────────────────────────────────

function mockFetch (overrides = {}) {
  global.fetch = jest.fn().mockImplementation((url) => {
    if (overrides[url]) return Promise.resolve(overrides[url])
    // Check /tokens before /token — /tokens URL also matches /token substring
    if (url.includes('/tokens')) {
      return Promise.resolve({ ok: true, json: async () => MOCK_TOKENS })
    }
    if (url.includes('/token')) {
      return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USDT' }) })
    }
    if (url.includes('/chains')) {
      return Promise.resolve({ ok: true, json: async () => MOCK_CHAINS })
    }
    if (url.includes('/status')) {
      return Promise.resolve({ ok: true, json: async () => MOCK_STATUS_DONE })
    }
    return Promise.resolve({ ok: true, json: async () => MOCK_QUOTE })
  })
}

// ─── EOA account suite ────────────────────────────────────────────────────────

describe('LifiSwidgeProtocol', () => {
  describe('with WalletAccountEvm (EOA)', () => {
    let account, protocol

    beforeEach(() => {
      account = new WalletAccountEvm(SEED, "0'/0/0", { provider: 'https://mock-rpc-url.com' })
      account.getAddress = jest.fn().mockResolvedValue(USER_ADDRESS)
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
        expect(result.priceImpact).toBeCloseTo(0.0003)
        expect(Array.isArray(result.fees)).toBe(true)
      })

      test('fees array contains network and protocol entries', async () => {
        const { fees } = await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const network = fees.find(f => f.type === 'network')
        const protocol_ = fees.find(f => f.type === 'protocol')

        expect(network).toBeDefined()
        expect(network.amount).toBe(155_728_000_000_000n)

        expect(protocol_).toBeDefined()
        expect(protocol_.amount).toBe(2300n)
        expect(protocol_.included).toBe(true)
      })

      test('resolves toToken to symbol when fromToken === toToken cross-chain', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const tokenCall = global.fetch.mock.calls.find(([url]) => url.includes('/token'))[0]
        expect(tokenCall).toContain(`token=${TOKEN}`)
        expect(tokenCall).toContain('chain=1')

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('toToken=USDT')
        expect(quoteCall).not.toContain(`toToken=${TOKEN}`)
      })

      test('skips token resolution when toToken differs from fromToken', async () => {
        const OTHER_TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: OTHER_TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const tokenCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/token'))
        expect(tokenCalls).toHaveLength(0)

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain(`toToken=${OTHER_TOKEN}`)
      })

      test('skips token resolution when toToken is already a symbol', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: 'USDC', toChain: 'optimism', fromTokenAmount: 1_000_000n
        })

        const tokenCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/token'))
        expect(tokenCalls).toHaveLength(0)

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('toToken=USDC')
      })

      test('omits toChain param when not provided (same-chain swap)', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: 'USDC', fromTokenAmount: 1_000_000n
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('fromChain=1')
        expect(quoteCall).toContain('toChain=1')
      })

      test('accepts a raw numeric toChain ID', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 8453, fromTokenAmount: 1_000_000n
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('toChain=8453')
      })

      test('forwards slippage to the quote API', async () => {
        await protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n, slippage: 0.01
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('slippage=0.01')
      })

      test('forwards order config to the quote API', async () => {
        const ordered = new LifiSwidgeProtocol(account, { order: 'FASTEST' })

        await ordered.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('order=FASTEST')
      })

      test('forwards allowBridges and denyBridges to the quote API', async () => {
        const filtered = new LifiSwidgeProtocol(account, {
          allowBridges: ['stargate', 'cctp'],
          denyBridges: ['across']
        })

        await filtered.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('allowBridges=stargate%2Ccctp')
        expect(quoteCall).toContain('denyBridges=across')
      })

      test('returns empty fees arrays when estimate arrays are empty', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USDT' }) })
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...MOCK_QUOTE,
              estimate: { ...MOCK_QUOTE.estimate, feeCosts: [], gasCosts: [] }
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
        })).rejects.toThrow(LifiConfigurationError)
      })

      test('throws LifiUnsupportedChainError for unknown chain name', async () => {
        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'unknown-chain', fromTokenAmount: 1_000_000n
        })).rejects.toThrow(LifiUnsupportedChainError)
      })

      test('throws LifiQuoteError when quote API returns non-OK', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USDT' }) })
          return Promise.resolve({ ok: false, statusText: 'Bad Request', json: async () => ({ message: 'Invalid params' }) })
        })

        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('LI.FI quote request failed: Invalid params')
      })

      test('throws LifiQuoteError when token resolution returns non-OK', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
          return Promise.resolve({ ok: true, json: async () => MOCK_QUOTE })
        })

        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('Failed to resolve token symbol')
      })

      test('throws LifiQuoteError when token resolution returns no symbol', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => ({}) })
          return Promise.resolve({ ok: true, json: async () => MOCK_QUOTE })
        })

        await expect(protocol.quoteSwidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('LI.FI returned no symbol')
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
        expect(Array.isArray(result.fees)).toBe(true)
        expect(result.fees.length).toBeGreaterThan(0)
        expect(Array.isArray(result.transactions)).toBe(true)
      })

      test('transactions array includes approval and source entries', async () => {
        const result = await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum',
          recipient: USER_ADDRESS, fromTokenAmount: 1_000_000n
        })

        const approvalTx = result.transactions.find(t => t.type === 'approval')
        const sourceTx = result.transactions.find(t => t.type === 'source')

        expect(approvalTx).toBeDefined()
        expect(approvalTx.hash).toBe('dummy-approve-hash')
        expect(sourceTx).toBeDefined()
        expect(sourceTx.hash).toBe('dummy-bridge-hash')
      })

      test('calls quote API with correct params', async () => {
        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum',
          recipient: USER_ADDRESS, fromTokenAmount: 1_000_000n
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('fromChain=1')
        expect(quoteCall).toContain('toChain=42161')
        expect(quoteCall).toContain(`fromToken=${TOKEN}`)
        expect(quoteCall).toContain('fromAmount=1000000')
        expect(quoteCall).toContain('toToken=USDT')
      })

      test('skips approval when skipApproval is true', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USDT' }) })
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...MOCK_QUOTE, estimate: { ...MOCK_QUOTE.estimate, skipApproval: true } })
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
        })).rejects.toThrow('Protocol fee exceeds maxProtocolFeeBps limit')

        expect(account.sendTransaction).not.toHaveBeenCalled()
      })

      test('throws LifiExecutionError when maxNetworkFeeBps is exceeded', async () => {
        // 0.41 USD fee / 1.00 USD input = 4100 bps, so cap at 1 bps to trigger
        const capped = new LifiSwidgeProtocol(account, { maxNetworkFeeBps: 1 })

        await expect(capped.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow('Network fee exceeds maxNetworkFeeBps limit')

        expect(account.sendTransaction).not.toHaveBeenCalled()
      })

      test('per-call config overrides protocol-level maxProtocolFeeBps', async () => {
        const uncapped = new LifiSwidgeProtocol(account)

        await expect(uncapped.swidge(
          { fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n },
          { maxProtocolFeeBps: 1 }
        )).rejects.toThrow('Protocol fee exceeds maxProtocolFeeBps limit')
      })

      test('throws LifiReadOnlyAccountError when account is read-only', async () => {
        const readOnly = new LifiSwidgeProtocol(
          new WalletAccountReadOnlyEvm(USER_ADDRESS, { provider: 'https://mock-rpc-url.com' })
        )

        await expect(readOnly.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow(LifiReadOnlyAccountError)
      })

      test('throws LifiConfigurationError when no provider is set', async () => {
        const noProvider = new LifiSwidgeProtocol(new WalletAccountEvm(SEED, "0'/0/0"))

        await expect(noProvider.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow(LifiConfigurationError)
      })

      test('throws LifiUnsupportedChainError for unknown chain name', async () => {
        await expect(protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'unknown-chain', fromTokenAmount: 1_000_000n
        })).rejects.toThrow(LifiUnsupportedChainError)

        expect(account.sendTransaction).not.toHaveBeenCalled()
      })

      test('accepts raw numeric toChain ID', async () => {
        account.sendTransaction = jest.fn().mockResolvedValue({ hash: 'dummy-hash' })
        allowanceMock.mockResolvedValue(1_000_000n)

        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 8453, fromTokenAmount: 1_000_000n
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('toChain=8453')
      })

      test('excludes APPROVE-type gas costs from network fees', async () => {
        global.fetch = jest.fn().mockImplementation((url) => {
          if (url.includes('/token')) return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USDT' }) })
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...MOCK_QUOTE,
              estimate: {
                ...MOCK_QUOTE.estimate,
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
        expect(result.transactions).toHaveLength(2)
        expect(result.transactions[0]).toMatchObject({ hash: '0x1234567890abcdef', type: 'source' })
        expect(result.transactions[1]).toMatchObject({ hash: '0xfedcba0987654321', type: 'destination' })
      })

      test('includes fromChain and toChain in status request', async () => {
        await protocol.getSwidgeStatus('0xabc123', { fromChain: 1, toChain: 42161 })

        const call = global.fetch.mock.calls.find(([url]) => url.includes('/status'))[0]
        expect(call).toContain('txHash=0xabc123')
        expect(call).toContain('fromChain=1')
        expect(call).toContain('toChain=42161')
      })

      test('maps DONE/PARTIAL to "partial"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ ...MOCK_STATUS_DONE, substatus: 'PARTIAL' })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('partial')
      })

      test('maps DONE/REFUNDED to "refunded"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ ...MOCK_STATUS_DONE, substatus: 'REFUNDED' })
        })
        const result = await protocol.getSwidgeStatus('0xabc123')
        expect(result.status).toBe('refunded')
      })

      test('maps DONE/NOT_PROCESSABLE_REFUND_NEEDED to "refund-pending"', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true, json: async () => ({ ...MOCK_STATUS_DONE, substatus: 'NOT_PROCESSABLE_REFUND_NEEDED' })
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
          .rejects.toThrow(LifiStatusError)
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

        expect(chains).toHaveLength(2)
        expect(chains[0]).toMatchObject({ id: 1, name: 'Ethereum', type: 'evm', nativeToken: 'ETH' })
        expect(chains[1]).toMatchObject({ id: 42161, name: 'Arbitrum One', type: 'evm', nativeToken: 'ETH' })
      })

      test('calls the chains API with all chain types', async () => {
        await protocol.getSupportedChains()

        const call = global.fetch.mock.calls.find(([url]) => url.includes('/chains'))[0]
        expect(call).toContain('chainTypes=EVM')
      })

      test('throws LifiQuoteError when chains API returns non-OK', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false, statusText: 'Service Unavailable', json: async () => ({})
        })

        await expect(protocol.getSupportedChains()).rejects.toThrow('LI.FI chains request failed')
      })
    })

    // ── getSupportedTokens ────────────────────────────────────────────────

    describe('getSupportedTokens', () => {
      test('returns flat array of SwidgeSupportedToken objects', async () => {
        const tokens = await protocol.getSupportedTokens()

        expect(tokens).toHaveLength(1)
        expect(tokens[0]).toMatchObject({
          token: TOKEN,
          chain: 1,
          symbol: 'USDT',
          decimals: 6,
          address: TOKEN,
          name: 'Tether USD'
        })
      })

      test('passes fromChain as chains filter when provided', async () => {
        await protocol.getSupportedTokens({ fromChain: 1 })

        const call = global.fetch.mock.calls.find(([url]) => url.includes('/tokens'))[0]
        expect(call).toContain('chains=1')
      })

      test('omits chains filter when no options provided', async () => {
        await protocol.getSupportedTokens()

        const call = global.fetch.mock.calls.find(([url]) => url.includes('/tokens'))[0]
        expect(call).not.toContain('chains=')
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

      test('sets toToken = fromToken so swidge resolves the symbol cross-chain', async () => {
        await protocol.bridge({
          token: TOKEN, targetChain: 'arbitrum', recipient: USER_ADDRESS, amount: 1_000_000n
        })

        const quoteCall = global.fetch.mock.calls.find(([url]) => url.includes('/quote'))[0]
        expect(quoteCall).toContain('toToken=USDT')
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
        expect(typeof result.fee).toBe('bigint')
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
        expect(typeof result.fee).toBe('bigint')
      })
    })
  })

  // ─── ERC-4337 account suite ───────────────────────────────────────────────

  describe('with WalletAccountEvmErc4337', () => {
    let account, protocol

    beforeEach(() => {
      account = new WalletAccountEvmErc4337(SEED, "0'/0/0", {
        chainId: 1,
        provider: 'https://mock-rpc-url.com'
      })
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
        expect(Array.isArray(approveCall)).toBe(true)
      })

      test('wraps bridge transaction in an array for ERC-4337', async () => {
        await protocol.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })

        const bridgeCall = account.sendTransaction.mock.calls[1][0]
        expect(Array.isArray(bridgeCall)).toBe(true)
        expect(bridgeCall[0].to).toBe(APPROVAL_ADDRESS)
        expect(bridgeCall[0].data).toBe(MOCK_QUOTE.transactionRequest.data)
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
        expect(Array.isArray(resetCall)).toBe(true)

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
            chainId: 1, provider: 'https://mock-rpc-url.com'
          })
        )

        await expect(readOnly.swidge({
          fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
        })).rejects.toThrow(LifiReadOnlyAccountError)
      })

      test('allows per-call maxProtocolFeeBps override', async () => {
        await expect(protocol.swidge(
          { fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n },
          { maxProtocolFeeBps: 1 }
        )).rejects.toThrow('Protocol fee exceeds maxProtocolFeeBps limit')
      })
    })
  })

  // ─── No account (quote-only) ──────────────────────────────────────────────

  describe('without account (quote and discovery only)', () => {
    let protocol

    beforeEach(() => {
      protocol = new LifiSwidgeProtocol(undefined, { provider: 'https://mock-rpc-url.com' })
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
      expect(chains.length).toBeGreaterThan(0)
    })

    test('getSupportedTokens works without an account', async () => {
      const tokens = await protocol.getSupportedTokens()
      expect(tokens.length).toBeGreaterThan(0)
    })

    test('swidge throws LifiReadOnlyAccountError without an account', async () => {
      await expect(protocol.swidge({
        fromToken: TOKEN, toToken: TOKEN, toChain: 'arbitrum', fromTokenAmount: 1_000_000n
      })).rejects.toThrow(LifiReadOnlyAccountError)
    })
  })
})
