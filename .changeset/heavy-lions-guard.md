---
"@lifi/wdk-protocol-swidge-lifi": minor
---

Add optional `minAmountOut` execution guard for quote-first flows, using the WDK-standard `SwidgeOptions` field introduced in `@tetherto/wdk-wallet` 1.0.0-beta.14 (dependency bumped). Pass a displayed quote's `toTokenAmountMin` as `swidge({ ...options, minAmountOut })`: if the fresh execution quote's `toAmountMin` falls below it, `swidge()` throws `LifiExecutionError` before any approval or transaction is sent. `quoteSwidge()` ignores the field and always returns the quoted amounts. Not forwarded to LI.FI; behavior is unchanged when omitted.
