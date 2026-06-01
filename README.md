# @kenny_io/wdk-protocol-swidge-lifi

[![Powered by WDK](https://img.shields.io/badge/Powered%20by-WDK-blueviolet)](https://docs.wdk.tether.io)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

WDK Swidge module for [LI.FI](https://li.fi) — lets any WDK wallet account swap and bridge tokens across chains via LI.FI using the `ISwidgeProtocol` interface.

Implements [`ISwidgeProtocol`](https://github.com/tetherto/wdk-wallet/blob/main/src/protocols/swidge-protocol.js) from `@tetherto/wdk-wallet >= 1.0.0-beta.9`.
By implementing `SwidgeProtocol`, this module automatically satisfies both `ISwapProtocol` and `IBridgeProtocol` — one module, every route LI.FI supports.

## Install

```bash
npm install @kenny_io/wdk-protocol-swidge-lifi
```

Peer dependencies (install the ones you need):

```bash
npm install @tetherto/wdk-wallet-evm          # EOA accounts
npm install @tetherto/wdk-wallet-evm-erc-4337  # ERC-4337 smart accounts (optional)
```

## Usage

### Quote and bridge USDT from Ethereum to Arbitrum

```js
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { LifiSwidgeProtocol } from '@kenny_io/wdk-protocol-swidge-lifi'

const account = new WalletAccountEvm(seedPhrase, "0'/0/0", {
  provider: 'https://mainnet.infura.io/v3/YOUR_KEY'
})

const protocol = new LifiSwidgeProtocol(account, {
  integrator: 'your-integrator-id',  // optional
  order: 'RECOMMENDED'
})

// Non-binding quote
const quote = await protocol.quoteSwidge({
  fromToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT on Ethereum
  toToken:   '0xdAC17F958D2ee523a2206206994597C13D831ec7', // same — resolved to symbol cross-chain
  toChain: 'arbitrum',
  fromTokenAmount: 10_000_000n // 10 USDT (6 decimals)
})

console.log(`Receive ~${quote.toTokenAmount} USDT on Arbitrum`)

// Execute
const result = await protocol.swidge({
  fromToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  toToken:   '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  toChain: 'arbitrum',
  fromTokenAmount: 10_000_000n
})

console.log(`Bridge tx: ${result.hash}`)

// Poll status
let { status } = await protocol.getSwidgeStatus(result.id, { fromChain: 1, toChain: 42161 })
```

### Same-chain swap

```js
const result = await protocol.swidge({
  fromToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  toToken:   '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  // toChain omitted → same chain as wallet
  fromTokenAmount: 10_000_000n
})
```

### Discovery (no account needed)

```js
const protocol = new LifiSwidgeProtocol(undefined, {
  provider: 'https://mainnet.infura.io/v3/YOUR_KEY'
})

const chains = await protocol.getSupportedChains()
const tokens = await protocol.getSupportedTokens({ fromChain: 1 })
```

## Configuration

```js
new LifiSwidgeProtocol(account, {
  // WDK fee caps (basis points of input amount)
  maxNetworkFeeBps: 100,       // reject if gas > 1% of input (USD-based for cross-token)
  maxProtocolFeeBps: 50,       // reject if LI.FI fee > 0.5% of input (source token units)

  // LI.FI options
  integrator: 'my-app',        // integrator identifier header
  apiKey: 'sk-...',            // API key for higher rate limits — server-side only
  order: 'RECOMMENDED',        // 'RECOMMENDED' | 'FASTEST' | 'CHEAPEST'
  allowBridges: ['stargate'],  // whitelist specific bridges
  denyBridges: ['across'],     // blacklist specific bridges
})
```

Fee caps can also be overridden per call:

```js
await protocol.swidge(options, { maxProtocolFeeBps: 20 })
```

## Supported chains

All chains supported by LI.FI — call `getSupportedChains()` for the live list.
Common string aliases for `toChain`: `ethereum`, `arbitrum`, `base`, `optimism`, `polygon`, `bsc`, `avalanche`, `scroll`, `zksync`, and [60+ more](src/lifi-config.js).
Raw numeric chain IDs are also accepted.

## Status mapping

| LI.FI status | Substatus | SwidgeStatus |
|---|---|---|
| PENDING | — | `pending` |
| DONE | COMPLETED | `completed` |
| DONE | PARTIAL | `partial` |
| DONE | REFUNDED | `refunded` |
| DONE | NOT_PROCESSABLE_REFUND_NEEDED | `refund-pending` |
| FAILED | — | `failed` |
| any | requiredActions non-empty | `action-required` |

## Fee mapping

| LI.FI cost type | SwidgeFeeType | Legacy field |
|---|---|---|
| `gasCosts[].type === 'SEND'` | `network` | `fee` |
| `feeCosts[]` | `protocol` | `bridgeFee` |

## Error types

| Class | When thrown |
|---|---|
| `LifiConfigurationError` | Missing or invalid provider/config |
| `LifiQuoteError` | LI.FI quote or token API error |
| `LifiExecutionError` | Fee cap exceeded before any transaction |
| `LifiStatusError` | LI.FI status API error or unknown id |
| `LifiReadOnlyAccountError` | `swidge()` called with read-only or absent account |
| `LifiUnsupportedChainError` | Unknown chain name string passed as `toChain` |

All errors extend `LifiProtocolError` which extends `Error`.

## Support

- **Integration questions**: open an issue on [GitHub](https://github.com/kenny-io/wdk-lifi-swidge-protocol/issues) or reach the LI.FI developer relations team at [help.li.fi/hc/en-us](https://help.li.fi/hc/en-us).
- **WDK-specific questions**: use your assigned Tether partner Slack channel.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.

## License

Apache 2.0 — see [LICENSE](LICENSE).
