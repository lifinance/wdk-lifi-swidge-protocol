---
"@lifi/wdk-protocol-swidge-lifi": minor
---

Add optional `minAmountOut` execution guard for quote-first flows. Pass a displayed quote's `toTokenAmountMin` as `swidge(options, { minAmountOut })`: if the fresh execution quote's `toAmountMin` falls below it, `swidge()` throws `LifiExecutionError` before any approval or transaction is sent. Not forwarded to LI.FI; behavior is unchanged when omitted.
