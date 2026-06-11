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

export const LIFI_API_URL = 'https://li.quest/v1'

// HTTP reliability defaults, modeled on the LI.FI SDK (packages/sdk/src/utils/request.ts).

/** Default timeout in ms per HTTP attempt. */
export const DEFAULT_TIMEOUT = 30_000

/** Default extra attempts on transient failures; mirrors the LI.FI SDK's requestSettings.retries. */
export const DEFAULT_RETRIES = 1

/** Default base backoff in ms, doubled per attempt. */
export const DEFAULT_RETRY_DELAY = 500

/** Cap in ms on the exponential backoff between retries. */
export const MAX_RETRY_DELAY = 5_000

/** Cap in ms on honored Retry-After header values. */
export const MAX_RETRY_AFTER = 60_000

/**
 * LI.FI Diamond contract addresses (lowercased), keyed by chain ID.
 * 'default' is the canonical CREATE2 deployment shared by most EVM chains.
 * Chains where CREATE2 derivation differs get explicit entries.
 * Source: https://github.com/lifinance/contracts/tree/main/deployments
 */
export const LIFI_DIAMOND_ADDRESSES = {
  default: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  324: '0x341e94069f53234fe6dabef707ad424830525715' // zkSync Era
}

/** Uniswap Permit2 — appears as estimate.approvalAddress on permit-based routes. */
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'

/**
 * Convenience map from WDK chain name strings to LI.FI numeric chain IDs.
 * Sourced from GET https://li.quest/v1/chains — all chains LI.FI currently supports.
 *
 * This map is not a gate. Pass a raw numeric chain ID as `toChain` to target any chain
 * not listed here. The numeric ID is forwarded directly to the LI.FI quote API.
 */
export const CHAINS = {
  // Major L1s and L2s
  ethereum: 1,
  arbitrum: 42_161,
  arbitrum_nova: 42_170,
  avalanche: 43_114,
  base: 8453,
  blast: 81_457,
  bsc: 56,
  celo: 42_220,
  gnosis: 100,
  linea: 59_144,
  mantle: 5_000,
  mode: 34_443,
  optimism: 10,
  polygon: 137,
  scroll: 534_352,
  unichain: 130,
  zksync: 324,

  // Additional EVM chains
  abstract: 2_741,
  apechain: 33_139,
  berachain: 80_094,
  bob: 60_808,
  boba: 288,
  cronos: 25,
  corn: 21_000_000,
  etherlink: 42_793,
  flare: 14,
  flow: 747,
  fraxtal: 252,
  fuse: 122,
  gravity: 1_625,
  hemi: 43_111,
  hyper_evm: 999,
  immutable_zkevm: 13_371,
  ink: 57_073,
  kaia: 8_217,
  katana: 747_474,
  lens: 232,
  lisk: 1_135,
  megaeth: 4_326,
  metis: 1_088,
  monad: 143,
  moonbeam: 1_284,
  morph: 2_818,
  opbnb: 204,
  plasma: 9_745,
  plume: 98_866,
  ronin: 2_020,
  rootstock: 30,
  sei: 1_329,
  soneium: 1_868,
  sonic: 146,
  sophon: 50_104,
  stable: 988,
  superposition: 55_244,
  swellchain: 1_923,
  taiko: 167_000,
  telos: 40,
  vana: 1_480,
  viction: 88,
  world_chain: 480,
  xdc: 50,
  xlayer: 196,

  // Non-EVM destination chains
  solana: 1_151_111_081_099_710,
  bitcoin: 20_000_000_000_001,
  sui: 9_270_000_000_000_000,
  tron: 728_126_428
}
