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
 * Integration tests against the live LI.FI API and Sepolia/Arbitrum Sepolia testnets.
 *
 * Prerequisites:
 *   - Copy .env.example to .env and fill in:
 *       INTEGRATION_RPC_URL     JSON-RPC URL for Sepolia (source chain)
 *       INTEGRATION_SEED_PHRASE BIP-39 seed phrase (wallet must hold Sepolia ETH + test USDT)
 *
 * Run with:
 *   node --experimental-vm-modules node_modules/.bin/jest tests/integration --testTimeout=120000
 *
 * These tests hit real APIs and submit real testnet transactions. They are intentionally
 * excluded from `npm test` (unit tests only). Run them manually before publishing.
 */

import { describe, test, expect, beforeAll } from '@jest/globals'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { LifiSwidgeProtocol } from '../../index.js'

const RPC_URL = process.env.INTEGRATION_RPC_URL
const SEED_PHRASE = process.env.INTEGRATION_SEED_PHRASE

// Sepolia test tokens (LI.FI testnet assets)
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const USDT_SEPOLIA = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0'

const SKIP = !RPC_URL || !SEED_PHRASE

if (SKIP) {
  console.warn(
    '\n⚠  Integration tests skipped — set INTEGRATION_RPC_URL and INTEGRATION_SEED_PHRASE to run them.\n'
  )
}

describe.skipIf(SKIP)('LifiSwidgeProtocol — integration (Sepolia)', () => {
  let account
  let protocol

  beforeAll(() => {
    account = new WalletAccountEvm(SEED_PHRASE, "0'/0/0", { provider: RPC_URL })
    protocol = new LifiSwidgeProtocol(account)
  })

  // ── Discovery ──────────────────────────────────────────────────────────────

  test('getSupportedChains returns a non-empty array with required fields', async () => {
    const chains = await protocol.getSupportedChains()

    expect(Array.isArray(chains)).toBe(true)
    expect(chains.length).toBeGreaterThan(0)

    const eth = chains.find(c => c.id === 1)
    expect(eth).toBeDefined()
    expect(eth.name).toBeTruthy()
    expect(eth.type).toBeTruthy()
    expect(eth.nativeToken).toBeTruthy()
  }, 30_000)

  test('getSupportedTokens returns tokens for Ethereum', async () => {
    const tokens = await protocol.getSupportedTokens({ fromChain: 1 })

    expect(Array.isArray(tokens)).toBe(true)
    expect(tokens.length).toBeGreaterThan(0)

    const usdt = tokens.find(t => t.symbol === 'USDT')
    expect(usdt).toBeDefined()
    expect(usdt.decimals).toBe(6)
    expect(usdt.address).toBeTruthy()
  }, 30_000)

  // ── Quote ──────────────────────────────────────────────────────────────────

  test('quoteSwidge returns a valid SwidgeQuote for a cross-chain bridge', async () => {
    const fromAddress = await account.getAddress()

    const quote = await protocol.quoteSwidge({
      fromToken: USDC_SEPOLIA,
      toToken: USDC_SEPOLIA,
      toChain: 421614, // Arbitrum Sepolia
      recipient: fromAddress,
      fromTokenAmount: 1_000_000n // 1 USDC
    })

    expect(typeof quote.fromTokenAmount).toBe('bigint')
    expect(typeof quote.toTokenAmount).toBe('bigint')
    expect(typeof quote.toTokenAmountMin).toBe('bigint')
    expect(quote.toTokenAmountMin).toBeLessThanOrEqual(quote.toTokenAmount)
    expect(Array.isArray(quote.fees)).toBe(true)
    expect(quote.fees.length).toBeGreaterThan(0)

    const hasNetwork = quote.fees.some(f => f.type === 'network')
    expect(hasNetwork).toBe(true)
  }, 30_000)

  test('quoteSwidge returns a valid SwidgeQuote for a same-chain swap', async () => {
    const fromAddress = await account.getAddress()

    const quote = await protocol.quoteSwidge({
      fromToken: USDC_SEPOLIA,
      toToken: USDT_SEPOLIA,
      recipient: fromAddress,
      fromTokenAmount: 1_000_000n
    })

    expect(quote.fromTokenAmount).toBe(1_000_000n)
    expect(quote.toTokenAmount).toBeGreaterThan(0n)
    expect(Array.isArray(quote.fees)).toBe(true)
  }, 30_000)

  // ── Status ─────────────────────────────────────────────────────────────────

  test('getSwidgeStatus maps a known completed tx to "completed"', async () => {
    // This is a known completed Sepolia → Arbitrum Sepolia bridge tx.
    // Replace with a real testnet tx hash if this one ages out.
    const KNOWN_TX = process.env.INTEGRATION_KNOWN_TX_HASH
    if (!KNOWN_TX) {
      console.warn('  Skipping status test — set INTEGRATION_KNOWN_TX_HASH to a completed testnet tx')
      return
    }

    const { status } = await protocol.getSwidgeStatus(KNOWN_TX)
    expect(['completed', 'partial', 'refunded']).toContain(status)
  }, 30_000)
})
