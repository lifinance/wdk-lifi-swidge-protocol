# Implementation Notes — `LifiSwidgeProtocol`

This document explains every non-obvious implementation decision in `LifiSwidgeProtocol`.

---

## How the module fits into WDK

```
SwidgeProtocol (base, @tetherto/wdk-wallet)
  implements ISwapProtocol + IBridgeProtocol
  └── LifiSwidgeProtocol  — LI.FI, HTTP-based routing
```

Because `SwidgeProtocol` already satisfies both `ISwapProtocol` and `IBridgeProtocol`, a wallet wiring in `LifiSwidgeProtocol` gets swap, bridge, and combined cross-chain swap+bridge from one module. We implement all five abstract methods (`quoteSwidge`, `swidge`, `getSwidgeStatus`, `getSupportedChains`, `getSupportedTokens`) and do not override the four legacy delegation methods — those are handled entirely by the base class.

The module accepts all three constructor shapes the interface contract requires: a full writable account, a read-only account, or no account at all (for discovery and quote-only use). Calling `swidge()` without a writable account throws `LifiReadOnlyAccountError` immediately, before any API call or transaction attempt.

---

## Legacy delegation

The base class implements `bridge()`, `quoteBridge()`, `swap()`, and `quoteSwap()` by mapping their options into `SwidgeOptions` and delegating to our `swidge()` / `quoteSwidge()`. It extracts `fee` (network fees) and `bridgeFee` (protocol fees) from the returned `SwidgeFee[]` array. Any wallet using the legacy API continues to work without changes, and the test suite covers all four delegation paths.

---

## Fee structure

Fees are always returned as a populated `SwidgeFee[]` array. There is no aggregated fee field.

| LI.FI field | `SwidgeFeeType` | Notes |
|---|---|---|
| `estimate.gasCosts[].type === 'SEND'` | `'network'` | Gas for the bridge tx itself |
| `estimate.feeCosts[]` | `'protocol'` | LI.FI's own fee, deducted from bridged amount |
| `estimate.gasCosts[].type === 'APPROVE'` | excluded | May not be paid if allowance is already sufficient |

`APPROVE`-type costs are excluded because including them would inflate the quoted fee for wallets that already have a valid allowance.

**Denomination matters.** `network` fees are in native token wei (ETH, MATIC); `protocol` fees are in source token base units. The `token` field on each fee entry identifies which denomination applies. Wallet UIs need to handle both when rendering.

**Fee caps** (`maxNetworkFeeBps`, `maxProtocolFeeBps`) are in basis points of the input amount and checked after the quote, before any transaction. Protocol fees use a direct bigint comparison since they share the source token's denomination. Network fees require a USD-based comparison because gas is in native token while the input is in the source token — we use the USD values LI.FI includes in the quote response for this.

---

## Status mapping

| LI.FI `status` | LI.FI `substatus` | `SwidgeStatus` |
|---|---|---|
| `PENDING` | any | `'pending'` |
| `DONE` | `COMPLETED` | `'completed'` |
| `DONE` | `PARTIAL` | `'partial'` |
| `DONE` | `REFUNDED` | `'refunded'` |
| `DONE` | `NOT_PROCESSABLE_REFUND_NEEDED` | `'refund-pending'` |
| `FAILED` | any | `'failed'` |
| any | — | `'action-required'` if `requiredActions.length > 0` |
| `NOT_FOUND` or `INVALID` | — | throws `LifiStatusError` |

`NOT_FOUND` and `INVALID` throw rather than return a status — they indicate a bad `id` or a transaction not yet indexed, both developer-actionable conditions. No status values beyond the nine defined in the interface are returned.

---

## Cross-chain token resolution

`SwidgeCommonOptions` requires both `fromToken` and `toToken`. For a bridge-only operation the natural thing is to pass the same address for both, but token addresses differ per chain (USDT on Arbitrum is not the same contract as USDT on Optimism). Passing the source chain's address as `toToken` on a cross-chain route causes LI.FI to reject the quote.

When `fromToken === toToken` and the chains differ, `_resolveToToken` calls the LI.FI `/token` endpoint to resolve the contract address to its symbol (`'USDT'`). Symbols are chain-agnostic — LI.FI accepts them as `toToken` and resolves the correct contract on the destination chain. The method throws on failure rather than falling back silently, because a silent fallback would reintroduce the exact bug it exists to prevent.

This also fires automatically when the base class `bridge()` delegation calls `swidge()`, since the base class passes `toToken = fromToken` for bridge-only routes.

---

## ERC-20 approval handling

`_handleApproval` runs inside every `swidge()` call before the bridge transaction. Four outcomes:

1. **Skip** — LI.FI's `skipApproval` flag is set (native tokens, some CCTP routes).
2. **Already approved** — current on-chain allowance ≥ amount. No transaction.
3. **Clean approval** — `currentAllowance === 0n`. One `approve(spender, amount)` tx.
4. **Reset then approve** — `0 < currentAllowance < amount`. First `approve(spender, 0)`, then `approve(spender, amount)`. USDT on Ethereum mainnet reverts on a direct non-zero-to-non-zero allowance change. We apply this defensively for any token in that state.

**Why exact amount, not infinite:** An upgradeable bridge contract with `type(uint256).max` approval is a standing permission to drain the wallet. Exact-amount approval limits exposure to only the tokens in the current operation.

**Why we wait for confirmation:** After each approval tx, we call `provider.waitForTransaction` before sending the bridge tx. Without it, the bridge arrives on-chain before the allowance is confirmed and the LI.FI Diamond's `safeTransferFrom` reverts. ERC-4337 accounts skip the wait — the bundler handles confirmation ordering internally. For the same reason, ERC-4337 transactions are wrapped in an array (`account.sendTransaction([tx], config)`) rather than sent directly.

**Approval address comes from the quote** (`estimate.approvalAddress`), never hardcoded. LI.FI deploys the Diamond to different addresses on some chains.

---

## Account type detection — why we don't use instanceof

Two things depend on account type: the `_isWritableAccount` guard on `swidge()` and the `_isErc4337Account` branch that wraps transactions in an array. The obvious approach — `instanceof WalletAccountEvmErc4337` — breaks when the same package resolves to two different module instances in a monorepo (workspace root vs nested `node_modules`). JavaScript compares constructor identity in memory, so two installs of identical source produce two different constructor objects and `instanceof` returns `false` for valid accounts.

We walk the prototype chain and compare constructor names as strings instead:

```js
_isErc4337Account() {
  let proto = this._account
  while (proto && proto !== Object.prototype) {
    if (proto.constructor?.name === 'WalletAccountEvmErc4337') return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}
```

Constructor names survive across module instances and are immune to dual-install issues.

---

## Typed error classes

| Class | Thrown when |
|---|---|
| `LifiConfigurationError` | Missing provider, bad config |
| `LifiQuoteError` | LI.FI quote, token, chains, or tokens API error |
| `LifiExecutionError` | Fee cap exceeded before any tx is sent |
| `LifiStatusError` | Status API error, or `NOT_FOUND`/`INVALID` id |
| `LifiReadOnlyAccountError` | `swidge()` called without a writable account |
| `LifiUnsupportedChainError` | Unknown chain name string passed as `toChain` |

All extend `LifiProtocolError`. The split between user-actionable errors (`LifiReadOnlyAccountError`, `LifiUnsupportedChainError`) and developer errors lets wallet UIs surface appropriate messages rather than raw stack traces.

---

## Routing, chain coverage, and Bare runtime

**Routing options** (`order`, `allowBridges`, `denyBridges`, `integrator`, `apiKey`) are constructor config values forwarded as query params or headers to the LI.FI `/quote` endpoint. `slippage` is a per-call option in `SwidgeOptions` so different routes can use different tolerances without reconstructing the instance.

**Chain coverage:** The `CHAINS` map in `lifi-config.js` covers 66 chains and exists for ergonomics (`'arbitrum'` over `42161`). It is not a gate — passing a raw numeric `toChain` bypasses the map entirely and works for any chain LI.FI supports, including ones added after this release. `getSupportedChains()` returns the live list directly from LI.FI.

**Bare runtime:** The `bare.js` entry point imports `bare-node-runtime` to polyfill the global environment. The module uses no Node.js-specific APIs (`http.request`, `Buffer`, `crypto.randomBytes`, etc.).
