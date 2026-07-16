# @lifi/wdk-protocol-swidge-lifi

[![Powered by WDK](https://img.shields.io/badge/Powered%20by-WDK-blueviolet)](https://docs.wdk.tether.io)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

WDK Swidge module for [LI.FI](https://li.fi) — lets any WDK wallet account swap and bridge tokens across chains via LI.FI using the `ISwidgeProtocol` interface.

Implements [`ISwidgeProtocol`](https://github.com/tetherto/wdk-wallet/blob/main/src/protocols/swidge-protocol.js) from `@tetherto/wdk-wallet >= 1.0.0-beta.9`.
By implementing `SwidgeProtocol`, this module automatically satisfies both `ISwapProtocol` and `IBridgeProtocol` — one module, every route LI.FI supports.

## Install

```bash
npm install @lifi/wdk-protocol-swidge-lifi
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
import { LifiSwidgeProtocol } from '@lifi/wdk-protocol-swidge-lifi'

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
  allowDestinationCall: true,  // include routes with a destination-chain call/swap (LI.FI default)
  allowNativeValue: true,      // set false to reject routes that require native token value (gasless)

  // Reliability (defaults shown — modeled on the LI.FI SDK)
  timeout: 30_000,             // ms per API request attempt
  retries: 1,                  // extra attempts on 5xx / 429 / network errors / timeouts; 0 disables
  retryDelay: 500,             // base backoff in ms, doubled per attempt, capped at 5000

  // Security (opt-in)
  trustedContracts: true,      // require quote tx target + approval address to be known LI.FI contracts
})
```

Fee caps can also be overridden per call:

```js
await protocol.swidge(options, { maxProtocolFeeBps: 20 })
```

### Quote-first flows: `minAmountOut`

`swidge()` always fetches a fresh quote at execution time, so in a quote-first UI the route the
user accepted can differ from the route that executes if the market moves in between. Pass the
displayed quote's `toTokenAmountMin` as the `minAmountOut` option (WDK-standard `SwidgeOptions`
field since `@tetherto/wdk-wallet` 1.0.0-beta.14): if the fresh execution quote's worst-case
output falls below it, `swidge()` throws before any approval or transaction is sent, and the app
can re-quote and ask the user again.

```js
const quote = await protocol.quoteSwidge(options)
// ... user reviews and accepts the displayed quote ...
const result = await protocol.swidge({ ...options, minAmountOut: quote.toTokenAmountMin })
```

`minAmountOut` is enforced at execution only — `quoteSwidge()` ignores it and always returns the
quoted amounts, so the app can display the fresh numbers when re-quoting. It is not forwarded to
LI.FI. When omitted, behavior is unchanged.

By default the module mirrors LI.FI's own routing behavior: no bridges are denied, routes with a
destination-chain call are allowed (`allowDestinationCall` is only forwarded when explicitly set),
and quotes whose transaction carries native token value are executed as-is. Setting
`allowDestinationCall: false` excludes routes that need a destination-chain call, such as a swap
after bridging, avoiding `PARTIAL` outcomes where the bridge succeeds but the destination swap
cannot complete and the user receives an intermediary token.

### Gasless integrations

Wallets that cannot spend native tokens (e.g. ERC-4337 accounts with a paymaster) should opt into
gasless mode explicitly:

```js
import LifiSwidgeProtocol, { NATIVE_VALUE_BRIDGE_DENY_LIST } from '@lifi/wdk-protocol-swidge-lifi'

new LifiSwidgeProtocol(account, {
  denyBridges: NATIVE_VALUE_BRIDGE_DENY_LIST, // filter out native-fee bridges at quote time
  allowNativeValue: false                     // reject any remaining native-value quote before execution
})
```

`NATIVE_VALUE_BRIDGE_DENY_LIST` is the maintained list of bridges known to require native token
value in the source transaction (`glacis`, `stargateV2`, `stargateV2Bus`, `squid`, `arbitrum`, and
`gasZipBridge`). With `allowNativeValue: false`, `swidge()` rejects any quote whose
`transactionRequest.value` is greater than zero before sending approvals or the bridge transaction.

## Reliability

All LI.FI API calls go through a central request layer modeled on the
[LI.FI SDK](https://github.com/lifinance/sdk):

- **Timeouts** — every request is aborted after `timeout` ms (default 30s) instead of hanging.
- **Retries** — transient failures (5xx, network errors, timeouts) are retried with exponential
  backoff. 429 responses honor the `Retry-After` header when present.
- **Error classification** — HTTP statuses map to typed errors: 409 → `LifiSlippageError`
  (stale quote, request a new one), 429 → `LifiRateLimitError`, timeouts → `LifiTimeoutError`,
  persistent network failures → `LifiNetworkError`.

When polling `getSwidgeStatus()`, a `LifiStatusError` with `err.lifiStatus === 'NOT_FOUND'`
means the transaction is not indexed yet — treat it as still pending (see
[examples/bridge-usdt.js](examples/bridge-usdt.js)).

## Security

The transaction data returned by the LI.FI quote API is always structurally validated
(valid target address, hex calldata, parseable amounts) before being forwarded to the wallet.

Setting `trustedContracts` additionally requires the transaction target and approval address
to be known LI.FI contracts, rejecting with `LifiUntrustedContractError` *before any approval
is granted*:

```js
// Built-in allowlist: per-chain LI.FI Diamond deployments + Permit2
new LifiSwidgeProtocol(account, { trustedContracts: true })

// Extend the built-ins with additional trusted addresses per chain ID
new LifiSwidgeProtocol(account, { trustedContracts: { 137: '0x...' } })
```

This check is opt-in to match LI.FI SDK behavior and because some chains use non-canonical
Diamond deployments. The built-in allowlist covers the canonical address and known exceptions
(e.g. zkSync Era); verify against [LI.FI deployments](https://github.com/lifinance/contracts/tree/main/deployments)
before enabling on uncommon chains.

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

Each fee uses its LI.FI cost token's `chainId` when available. This identifies
the chain where the fee token is charged or denominated, which may differ from
the chain where the underlying execution or gas consumption occurs. If LI.FI
does not identify the token chain, the optional `chain` field is omitted rather
than inferred from the route.

## Error types

| Class | When thrown |
|---|---|
| `LifiConfigurationError` | Missing or invalid provider/config |
| `LifiQuoteError` | LI.FI quote or token API error |
| `LifiExecutionError` | Fee cap exceeded before any transaction |
| `LifiStatusError` | LI.FI status API error or unknown id |
| `LifiReadOnlyAccountError` | `swidge()` called with read-only or absent account |
| `LifiUnsupportedChainError` | Unknown chain name string passed as `toChain` |
| `LifiTimeoutError` | API request exceeded the configured `timeout` |
| `LifiNetworkError` | Network-level failure persisted after all retries |
| `LifiRateLimitError` | 429 from the API after retries were exhausted |
| `LifiSlippageError` | 409 from the quote API — stale quote, request a new one (subclass of `LifiQuoteError`) |
| `LifiValidationError` | Invalid user input or malformed API response, thrown before execution |
| `LifiUntrustedContractError` | Quote target/approval address not in the `trustedContracts` allowlist (subclass of `LifiExecutionError`) |

All errors extend `LifiProtocolError` which extends `Error`.

## TypeScript

Type declarations are generated from JSDoc and shipped in `types/`. Consumers get full typings
for the protocol class, config, and all error classes. After changing public JSDoc, regenerate
with:

```bash
npm run build:types
```

## Publishing

This package does not bundle or transpile its runtime JavaScript. It ships ESM source files
directly from `index.js`, `src/`, and `bare.js`, plus generated type declarations in `types/`.
Before handing off a release, run:

```bash
npm run lint
npm test
npm run build:types
npm audit --omit=dev
npm publish --dry-run
```

The actual npm release command is:

```bash
npm publish --access public
```

## Support

- **Integration questions**: open an issue on [GitHub](https://github.com/lifinance/wdk-lifi-swidge-protocol/issues) or reach the LI.FI developer relations team at [help.li.fi/hc/en-us](https://help.li.fi/hc/en-us).
- **WDK-specific questions**: use your assigned Tether partner Slack channel.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.

## License

Apache 2.0 — see [LICENSE](LICENSE).
