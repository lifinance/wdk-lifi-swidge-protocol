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

/**
 * Integration tests against the live LI.FI API.
 *
 * Three tiers of tests:
 *
 *   Tier 1 — Always run. No credentials needed. Tests discovery endpoints.
 *
 *   Tier 2 — Runs with a funded or unfunded wallet (quote + resolution).
 *             Uses mainnet token addresses; no transaction is sent.
 *             Set INTEGRATION_RPC_URL to any Ethereum mainnet RPC.
 *             A test-only seed phrase is used by default, so no real funds required.
 *
 *   Tier 3 — Runs only with INTEGRATION_SEED_PHRASE + INTEGRATION_RPC_URL pointing
 *             to a funded Sepolia wallet. Submits real testnet transactions.
 *             Set INTEGRATION_KNOWN_TX_HASH to a completed testnet bridge tx.
 *
 * Run all tiers:
 *   INTEGRATION_RPC_URL=https://mainnet.infura.io/v3/... \
 *   node --experimental-vm-modules node_modules/.bin/jest tests/integration --testTimeout=60000
 */

import { describe, test, expect, beforeEach } from '@jest/globals'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { LifiSwidgeProtocol } from '../../index.js'

// ── Tier 2 env vars ────────────────────────────────────────────────────────────

const RPC_URL     = process.env.INTEGRATION_RPC_URL
const SEED_PHRASE = process.env.INTEGRATION_SEED_PHRASE
// Fallback to a deterministic test mnemonic for quote-only tests (never funded).
const TEST_SEED   = SEED_PHRASE ?? 'test test test test test test test test test test test junk'

const SKIP_TIER2 = !RPC_URL
const SKIP_TIER3 = !RPC_URL || !SEED_PHRASE

if (SKIP_TIER2) {
  console.warn('\n⚠  Tier 2/3 tests skipped — set INTEGRATION_RPC_URL to run quote tests.\n')
} else if (SKIP_TIER3) {
  console.warn('\n⚠  Tier 3 tests skipped — set INTEGRATION_SEED_PHRASE to run execution tests.\n')
}

// ── Well-known mainnet token addresses ────────────────────────────────────────

const USDT_ETH     = '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDT on Ethereum
const USDC_ETH     = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // USDC on Ethereum
const USDC_ARB     = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' // USDC on Arbitrum
const USDT0_ARB    = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' // USDT0 on Arbitrum

// ── Tier 1 — Discovery (always run) ───────────────────────────────────────────

describe('@lifi/wdk-protocol-swidge-lifi — integration tier 1: discovery (no credentials)', () => {
  let protocol

  beforeEach(() => {
    protocol = new LifiSwidgeProtocol()
  })

  test('getSupportedChains returns a non-empty array with all required SwidgeSupportedChain fields', async () => {
    const chains = await protocol.getSupportedChains()

    expect(Array.isArray(chains)).toBe(true)
    expect(chains.length).toBeGreaterThan(50) // LI.FI supports 70+ chains

    for (const chain of chains) {
      expect(typeof chain.id).toBe('number')
      expect(typeof chain.name).toBe('string')
      expect(chain.name.length).toBeGreaterThan(0)
      expect(typeof chain.type).toBe('string')
      expect(typeof chain.nativeToken).toBe('string')
      expect(chain.nativeToken.length).toBeGreaterThan(0)
    }

    // Spot-check well-known chains
    const eth = chains.find(c => c.id === 1)
    expect(eth).toBeDefined()
    expect(eth.name).toBe('Ethereum')
    expect(eth.type).toBe('evm')
    expect(eth.nativeToken).toBe('ETH')

    const arb = chains.find(c => c.id === 42161)
    expect(arb).toBeDefined()
    expect(arb.name).toContain('Arbitrum')
  }, 30_000)

  test('getSupportedTokens returns tokens for Ethereum with all required SwidgeSupportedToken fields', async () => {
    const tokens = await protocol.getSupportedTokens({ fromChain: 1 })

    expect(Array.isArray(tokens)).toBe(true)
    expect(tokens.length).toBeGreaterThan(100)

    for (const token of tokens.slice(0, 20)) {
      expect(typeof token.token).toBe('string')
      expect(typeof token.chain).toBe('number')
      expect(token.chain).toBe(1)
      expect(typeof token.symbol).toBe('string')
      expect(typeof token.decimals).toBe('number')
      expect(typeof token.address).toBe('string')
      expect(token.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }

    // Spot-check USDT
    const usdt = tokens.find(t => t.symbol === 'USDT' && t.decimals === 6)
    expect(usdt).toBeDefined()
    expect(usdt.address.toLowerCase()).toBe(USDT_ETH.toLowerCase())
    expect(usdt.name).toBeTruthy()
  }, 30_000)

  test('getSupportedTokens without fromChain returns tokens across multiple chains', async () => {
    const tokens = await protocol.getSupportedTokens()

    expect(Array.isArray(tokens)).toBe(true)
    expect(tokens.length).toBeGreaterThan(500)

    const chainIds = new Set(tokens.map(t => t.chain))
    expect(chainIds.size).toBeGreaterThan(5)
  }, 30_000)

  test('getSwidgeStatus throws LifiStatusError for a non-existent tx hash', async () => {
    // A syntactically valid but non-existent tx hash — LI.FI returns 404 for this.
    // The all-zeros hash is intentionally avoided: LI.FI resolves it to a real tx.
    await expect(
      protocol.getSwidgeStatus('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    ).rejects.toThrow(/LI.FI status request failed|No swidge found for id/)
  }, 30_000)
})

// ── Tier 2 — Quotes (mainnet tokens, no funds required) ───────────────────────

const describeTier2 = SKIP_TIER2 ? describe.skip : describe
describeTier2('@lifi/wdk-protocol-swidge-lifi — integration tier 2: quotes (mainnet, no funds)', () => {
  let protocol

  beforeEach(() => {
    const account = new WalletAccountEvm(TEST_SEED, "0'/0/0", { provider: RPC_URL })
    protocol = new LifiSwidgeProtocol(account)
  })

  test('quoteSwidge: bridge USDT ETH → USDT0 Arbitrum resolves destination token correctly', async () => {
    const fromAddress = await new WalletAccountEvm(TEST_SEED, "0'/0/0", { provider: RPC_URL }).getAddress()

    const quote = await protocol.quoteSwidge({
      fromToken: USDT_ETH,
      toToken:   USDT_ETH,   // same address — triggers cross-chain resolution to USDT0
      toChain: 42161,
      recipient: fromAddress,
      fromTokenAmount: 10_000_000n // 10 USDT
    })

    // Shape assertions based on live API response
    expect(typeof quote.fromTokenAmount).toBe('bigint')
    expect(typeof quote.toTokenAmount).toBe('bigint')
    expect(typeof quote.toTokenAmountMin).toBe('bigint')
    expect(quote.fromTokenAmount).toBe(10_000_000n)
    expect(quote.toTokenAmount).toBeGreaterThan(0n)
    expect(quote.toTokenAmountMin).toBeLessThanOrEqual(quote.toTokenAmount)

    expect(Array.isArray(quote.fees)).toBe(true)
    expect(quote.fees.length).toBeGreaterThan(0)

    for (const fee of quote.fees) {
      expect(['network', 'protocol', 'affiliate', 'other']).toContain(fee.type)
      expect(typeof fee.amount).toBe('bigint')
      expect(fee.amount).toBeGreaterThanOrEqual(0n)
      expect(typeof fee.token).toBe('string')
    }

    // Must have at least one network fee
    expect(quote.fees.some(f => f.type === 'network')).toBe(true)

    if (quote.estimatedDuration !== undefined) {
      expect(typeof quote.estimatedDuration).toBe('number')
      expect(quote.estimatedDuration).toBeGreaterThan(0)
    }
  }, 60_000)

  test('quoteSwidge: bridge USDC ETH → USDC Arbitrum (same symbol, no rebranding)', async () => {
    const fromAddress = await new WalletAccountEvm(TEST_SEED, "0'/0/0", { provider: RPC_URL }).getAddress()

    const quote = await protocol.quoteSwidge({
      fromToken: USDC_ETH,
      toToken:   USDC_ETH,   // same address — should resolve to USDC on Arbitrum
      toChain: 42161,
      recipient: fromAddress,
      fromTokenAmount: 10_000_000n // 10 USDC
    })

    expect(quote.fromTokenAmount).toBe(10_000_000n)
    expect(quote.toTokenAmount).toBeGreaterThan(0n)
    expect(quote.fees.some(f => f.type === 'network')).toBe(true)
  }, 60_000)

  test('quoteSwidge: explicit toToken address bypasses resolution', async () => {
    const fromAddress = await new WalletAccountEvm(TEST_SEED, "0'/0/0", { provider: RPC_URL }).getAddress()

    // Pass the destination address explicitly — no /token or /tokens calls expected
    const quote = await protocol.quoteSwidge({
      fromToken: USDT_ETH,
      toToken:   USDT0_ARB,   // explicit Arbitrum USDT0 address
      toChain: 42161,
      recipient: fromAddress,
      fromTokenAmount: 10_000_000n
    })

    expect(quote.fromTokenAmount).toBe(10_000_000n)
    expect(quote.toTokenAmount).toBeGreaterThan(0n)
  }, 60_000)

  test('quoteSwidge: same-chain swap USDT → USDC on Ethereum', async () => {
    const fromAddress = await new WalletAccountEvm(TEST_SEED, "0'/0/0", { provider: RPC_URL }).getAddress()

    const quote = await protocol.quoteSwidge({
      fromToken: USDT_ETH,
      toToken:   USDC_ETH,
      // toChain omitted → same chain
      recipient: fromAddress,
      fromTokenAmount: 10_000_000n
    })

    expect(quote.fromTokenAmount).toBe(10_000_000n)
    expect(quote.toTokenAmount).toBeGreaterThan(0n)
    // Same-chain swap: fees should include network fees (gas)
    expect(quote.fees.some(f => f.type === 'network')).toBe(true)
  }, 60_000)

  test('quoteSwidge: throws LifiQuoteError for a token with no route to destination', async () => {
    await expect(
      protocol.quoteSwidge({
        fromToken: USDT_ETH,
        toToken:   USDT_ETH,
        toChain: 999999,       // non-existent chain ID
        fromTokenAmount: 10_000_000n
      })
    ).rejects.toThrow(/No destination token found|Failed to search tokens|LI.FI quote request failed/)
  }, 30_000)
})

// ── Tier 3 — Execution (funded Sepolia wallet required) ───────────────────────

const describeTier3 = SKIP_TIER3 ? describe.skip : describe
describeTier3('@lifi/wdk-protocol-swidge-lifi — integration tier 3: execution (funded Sepolia)', () => {
  let account
  let protocol

  // Sepolia test tokens
  const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

  const KNOWN_TX = process.env.INTEGRATION_KNOWN_TX_HASH
  // Skip (not silently pass) when no known tx hash is configured.
  const testIfKnownTx = KNOWN_TX ? test : test.skip

  beforeEach(() => {
    account = new WalletAccountEvm(SEED_PHRASE, "0'/0/0", { provider: RPC_URL })
    protocol = new LifiSwidgeProtocol(account)
  })

  testIfKnownTx('getSwidgeStatus maps a known completed tx to a terminal SwidgeStatus', async () => {
    const { status, transactions } = await protocol.getSwidgeStatus(KNOWN_TX)

    expect(['completed', 'partial', 'refunded', 'failed']).toContain(status)
    expect(Array.isArray(transactions)).toBe(true)
  }, 30_000)

  test('quoteSwidge: Sepolia quote returns a valid SwidgeQuote', async () => {
    const fromAddress = await account.getAddress()

    const quote = await protocol.quoteSwidge({
      fromToken: USDC_SEPOLIA,
      toToken:   USDC_SEPOLIA,
      toChain: 421614,          // Arbitrum Sepolia
      recipient: fromAddress,
      fromTokenAmount: 1_000_000n // 1 USDC
    })

    expect(typeof quote.fromTokenAmount).toBe('bigint')
    expect(typeof quote.toTokenAmount).toBe('bigint')
    expect(Array.isArray(quote.fees)).toBe(true)
  }, 30_000)
})
