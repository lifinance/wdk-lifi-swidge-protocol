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
 * Example: swap 10 USDT → USDC on the same chain (Arbitrum) using LI.FI.
 *
 * Swidge handles same-chain swaps and cross-chain bridges with one interface.
 * For a same-chain swap, simply omit toChain (or set it equal to the source chain).
 *
 * Run with:
 *   cp .env.example .env   # fill in your values (RPC_URL should point to Arbitrum)
 *   node examples/swap-usdt-to-usdc.js
 */

import 'dotenv/config'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { LifiSwidgeProtocol } from '@lifi/wdk-protocol-swidge-lifi'

const USDT_ARBITRUM = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const AMOUNT = 10_000_000n // 10 USDT at 6 decimals

const account = new WalletAccountEvm(process.env.SEED_PHRASE, "0'/0/0", {
  provider: process.env.RPC_URL // e.g. https://arb1.arbitrum.io/rpc
})

const protocol = new LifiSwidgeProtocol(account, {
  integrator: 'your-integrator-id'
})

// 1. Quote — no transaction sent
const quote = await protocol.quoteSwidge({
  fromToken: USDT_ARBITRUM,
  toToken: USDC_ARBITRUM,
  // toChain omitted → same chain as wallet (Arbitrum)
  fromTokenAmount: AMOUNT,
  slippage: 0.005 // 0.5%
})

console.log('Swap quote (USDT → USDC on Arbitrum):')
console.log(`  Send:    ${quote.fromTokenAmount} USDT base units`)
console.log(`  Receive: ~${quote.toTokenAmount} USDC base units`)
console.log(`  Min out: ${quote.toTokenAmountMin} USDC base units`)
console.log('  Fees:')
for (const fee of quote.fees) {
  console.log(`    [${fee.type}] ${fee.amount} ${fee.token} — ${fee.description || ''}`)
}

// 2. Execute (uncomment when ready)
// const result = await protocol.swidge({
//   fromToken: USDT_ARBITRUM,
//   toToken: USDC_ARBITRUM,
//   fromTokenAmount: AMOUNT,
//   slippage: 0.005
// })
//
// console.log('\nSwap executed:')
// console.log(`  Tx: ${result.hash}`)
// console.log(`  Sent:     ${result.fromTokenAmount} USDT base units`)
// console.log(`  Received: ${result.toTokenAmount} USDC base units`)
//
// // Approval tx appears in transactions if it was needed
// for (const tx of result.transactions.filter(t => t.type === 'approval')) {
//   console.log(`  Approval: ${tx.hash}`)
// }
