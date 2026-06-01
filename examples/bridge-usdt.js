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
 * Example: bridge 10 USDT from Ethereum to Arbitrum using LI.FI.
 *
 * Run with:
 *   cp .env.example .env   # fill in your values
 *   node examples/bridge-usdt.js
 */

import 'dotenv/config'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { LifiSwidgeProtocol } from '@kenny_io/wdk-protocol-swidge-lifi'

const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const AMOUNT = 10_000_000n // 10 USDT at 6 decimals

const account = new WalletAccountEvm(process.env.SEED_PHRASE, "0'/0/0", {
  provider: process.env.RPC_URL // e.g. https://mainnet.infura.io/v3/YOUR_KEY
})

const protocol = new LifiSwidgeProtocol(account, {
  integrator: 'your-integrator-id',  // optional — register at li.fi
  order: 'RECOMMENDED'
})

// 1. Get a non-binding quote first
const quote = await protocol.quoteSwidge({
  fromToken: USDT_ETHEREUM,
  toToken: USDT_ETHEREUM,  // same symbol, LI.FI resolves destination address
  toChain: 'arbitrum',
  fromTokenAmount: AMOUNT
})

console.log('Quote:')
console.log(`  From: ${quote.fromTokenAmount} USDT (Ethereum)`)
console.log(`  To:   ~${quote.toTokenAmount} USDT (Arbitrum)`)
console.log(`  Min:  ${quote.toTokenAmountMin} USDT after slippage`)
console.log(`  ETA:  ${quote.estimatedDuration}s`)
console.log('  Fees:')
for (const fee of quote.fees) {
  console.log(`    [${fee.type}] ${fee.amount} ${fee.token} — ${fee.description || ''}`)
}

// 2. Execute (uncomment when ready)
// const result = await protocol.swidge({
//   fromToken: USDT_ETHEREUM,
//   toToken: USDT_ETHEREUM,
//   toChain: 'arbitrum',
//   fromTokenAmount: AMOUNT
// })
//
// console.log('\nExecuted:')
// console.log(`  Bridge tx: ${result.hash}`)
// console.log(`  Track at: https://scan.li.fi/tx/${result.id}`)
//
// // 3. Poll status until terminal
// let status
// do {
//   await new Promise(r => setTimeout(r, 10_000))
//   ;({ status } = await protocol.getSwidgeStatus(result.id, { fromChain: 1, toChain: 42161 }))
//   console.log(`  Status: ${status}`)
// } while (!['completed', 'failed', 'refunded', 'partial'].includes(status))
