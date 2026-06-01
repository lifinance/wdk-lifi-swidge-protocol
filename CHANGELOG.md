# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
