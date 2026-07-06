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
 * Example: discover supported chains and tokens without a wallet account.
 *
 * getSupportedChains() and getSupportedTokens() do not require a wallet account.
 * Wallet apps can use these to populate chain/token pickers before the user connects.
 *
 * Run with:
 *   node examples/discover-chains-and-tokens.js
 */

import { LifiSwidgeProtocol } from '@lifi/wdk-protocol-swidge-lifi'

// No account needed for discovery — pass a provider for chain-ID resolution
// or omit it entirely if you only need static chain/token lists.
const protocol = new LifiSwidgeProtocol()

// ── Supported chains ──────────────────────────────────────────────────────────
const chains = await protocol.getSupportedChains()
console.log(`\nSupported chains (${chains.length} total):\n`)
for (const chain of chains.slice(0, 10)) {
  console.log(`  ${String(chain.id).padStart(8)}  ${chain.name.padEnd(24)}  ${chain.type.toUpperCase()}  native: ${chain.nativeToken}`)
}
if (chains.length > 10) console.log(`  … and ${chains.length - 10} more`)

// ── Tokens on Ethereum ────────────────────────────────────────────────────────
const ethTokens = await protocol.getSupportedTokens({ fromChain: 1 })
console.log(`\nTokens on Ethereum (${ethTokens.length} total):\n`)
for (const token of ethTokens.slice(0, 8)) {
  console.log(`  ${token.symbol.padEnd(8)}  ${token.address}  decimals: ${token.decimals}`)
}
if (ethTokens.length > 8) console.log(`  … and ${ethTokens.length - 8} more`)
