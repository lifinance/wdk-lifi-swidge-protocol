# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-07-08

### Added
- Added `allowDestinationCall` config forwarding to LI.FI quote requests.

### Changed
- LI.FI quote requests now default to `allowDestinationCall=false`, filtering out routes that require destination-chain calls/swaps and may leave users with intermediary tokens. Callers can set `allowDestinationCall: true` to opt back in.

## [0.2.0] — 2026-07-06

### Added
- TypeScript declarations generated from JSDoc: `npm run build:types` emits `types/` via `tsc`; `types` field and `types` export condition added to package.json. Public typedefs (`LifiSwidgeProtocolConfig`, `LifiRouteOrder`, `SwidgeStatusOptions`) re-exported from `index.js` and `bare.js`.
- Central HTTP request layer (`src/request.js`) modeled on the LI.FI SDK: per-request timeouts (default 30s), retries with exponential backoff on transient failures (5xx, network errors, timeouts; default 1 retry), and 429 handling that honors the `Retry-After` header. Configurable via new `timeout`, `retries`, and `retryDelay` config keys.
- Typed error classification mirroring the LI.FI SDK's status-code mapping: `LifiTimeoutError`, `LifiNetworkError`, `LifiRateLimitError`, `LifiSlippageError` (409, subclass of `LifiQuoteError`), `LifiValidationError`, `LifiUntrustedContractError` (subclass of `LifiExecutionError`).
- Input validation (`src/validation.js`): recipient address, slippage range, and amounts are validated before any API call.
- Structural validation of the quote's `transactionRequest` (valid target address, hex calldata, parseable value/gasLimit) before it is forwarded to the wallet.
- Opt-in `trustedContracts` config: requires the quote's transaction target and approval address to be known LI.FI contracts (built-in per-chain Diamond allowlist + Permit2, user-extendable), rejected before any approval is granted.
- `LifiStatusError` now carries a machine-readable `lifiStatus` field (`'NOT_FOUND'` / `'INVALID'`) so polling loops can treat not-yet-indexed transactions as pending.
- 26 new unit tests covering retries, timeouts, rate limiting, error classification, input validation, and the contract allowlist.

### Changed
- Renamed the npm package to `@lifi/wdk-protocol-swidge-lifi` and updated package metadata for the `lifinance/wdk-lifi-swidge-protocol` repository.
- `denyBridges` now overrides the built-in native-value bridge deny list instead of appending to it, so callers can pass `denyBridges: []` to clear the default list.
- API requests that previously hung indefinitely now fail with `LifiTimeoutError` after the configured timeout; transient 5xx/429 failures are retried before surfacing an error.
- Conformance pass against Tether's WDK review skills (`tetherto/wdk-agent-skills`: `wdk-review-types-jsdoc`, `wdk-review-tests`):
  - JSDoc: full descriptions and `@throws` on all public methods and constructor overloads; private members reduced to `/** @private */` with rationale moved to code comments; precise types replace bare `object` (`Eip1193Provider`, `Record<...>`, named `SwidgeStatusOptions`/`RequestOptions`/`LifiQuote` typedefs).
  - Tests: fixtures renamed `MOCK_*` → `DUMMY_*` and `mock-` → `dummy-` placeholders; realistic BIP-39 test mnemonic; EOA `getAddress` no longer mocked (pure local derivation); error assertions verify exact messages per the WDK R5 convention — this subsumes the 0.1.2 vacuous-pass fix, since every message is unique to a single throw site and so identifies the error class as well; fetch calls verified with exact URLs and options; partial `toMatchObject`/shape assertions replaced with exact `toEqual` values, including deterministic approve() calldata for ERC-4337 batching tests.

## [0.1.2] — 2026-06-01

### Fixed
- `_resolveToToken` now performs a proper destination-chain token lookup instead of passing the source symbol directly. The old approach failed for tokens that are rebranded on the destination chain (e.g. Ethereum USDT → Arbitrum USDT0). Resolution now fetches source token metadata, searches the destination chain's token list, and selects the highest-market-cap stablecoin matching symbol, `coinKey`, or a `{symbol}0` variant.
- `LifiQuoteError` was missing from test imports, causing four tests to pass vacuously.

### Changed
- Integration tests overhauled: split into three credential tiers, Tier 1 (discovery) runs against the live LI.FI API without any env vars, Tier 2 (quotes) runs against mainnet tokens without funds.
- Status test updated: the all-zeros hash resolves to a real LI.FI transaction (HTTP 200); the test now uses a genuinely non-existent hash that returns 404.

## [0.1.1] — 2026-06-01

### Fixed
- Repository URL updated to `github.com/kenny-io/wdk-lifi-swidge-protocol`.
- Support channel updated to `help.li.fi/hc/en-us`.

## [0.1.0] — 2026-06-01

### Added
- Initial implementation of `LifiSwidgeProtocol` extending `SwidgeProtocol` from `@tetherto/wdk-wallet@1.0.0-beta.9`.
- `quoteSwidge(options)` — non-binding quote supporting exact-in and exact-out modes.
- `swidge(options, config)` — executes swap, bridge, or combined swap+bridge via LI.FI.
- `getSwidgeStatus(id, options)` — polls LI.FI status API, maps to canonical `SwidgeStatus` values.
- `getSupportedChains()` — returns all chains supported by LI.FI.
- `getSupportedTokens(options)` — returns supported tokens, optionally scoped by chain.
- Automatic ERC-20 approval handling (exact minimum, reset-to-zero for USDT-like tokens).
- ERC-4337 smart account support via `WalletAccountEvmErc4337`.
- Typed error classes: `LifiConfigurationError`, `LifiQuoteError`, `LifiExecutionError`, `LifiStatusError`, `LifiReadOnlyAccountError`, `LifiUnsupportedChainError`.
- `maxNetworkFeeBps` and `maxProtocolFeeBps` fee caps at protocol and per-call level.
- `order`, `allowBridges`, `denyBridges`, `integrator`, `apiKey` config options.
- Zero new runtime dependencies beyond `ethers` and `bare-node-runtime`.
