# wdk-lifi-swidge-protocol

Public npm package `@lifi/wdk-protocol-swidge-lifi`: a protocol module for Tether's WDK (Wallet Development Kit) that lets any WDK EVM wallet account (EOA or ERC-4337) swap and bridge through the LI.FI API. `LifiSwidgeProtocol` extends `SwidgeProtocol` from `@tetherto/wdk-wallet` and implements its five abstract methods; the base class maps the legacy swap/bridge calls onto them. Plain ESM JavaScript with JSDoc types, no build step except type declarations. Usage and configuration: README.md. Design decisions (fees, status mapping, safety checks): NOTES.md. Release flow: RELEASING.md.

## Commands

Node 26, npm (`package-lock.json`).

```bash
npm ci
npm run lint                 # standard
npm run lint:fix
npm test                     # jest unit tests (no network) + type tests
npm run build:types          # tsc -> types/
npm run test:integration     # live LI.FI API; needs INTEGRATION_RPC_URL, INTEGRATION_SEED_PHRASE for higher tiers
npm run changeset            # add a changeset for any user-facing change
```

CI (`.github/workflows/ci.yml`) runs lint, `npm test` and `build:types` on PRs to `main`.

## Layout

- `src/lifi-swidge-protocol.js` - the protocol class: quotes, execution, status, discovery
- `src/request.js` - HTTP client for the LI.FI API (timeouts, retries, rate limits)
- `src/validation.js` - input validation and checks on quotes before signing
- `src/errors.js` - exported error classes
- `src/lifi-config.js` - API base URL and defaults
- `index.js` / `bare.js` - entry points for Node and the Bare runtime
- `types/` - generated `.d.ts`, committed and published
- `tests/` - unit tests; `tests/types/` compiles a TS consumer against `types/`; `tests/integration/` hits the live API
- `examples/` - runnable scripts (`npm run example:*`); swap and bridge read `.env`

## Rules

- Never edit `types/` by hand: change JSDoc in `src/` or `index.js`, run `npm run build:types`, commit the result.
- Every user-facing change needs a changeset (`.changeset/`); versions and CHANGELOG.md are written by the Changesets release PR, never by hand.
- Do not rename `.github/workflows/publish.yml`: npm trusted publishing is bound to that path.
- Style is `standard` (no semicolons, 2 spaces).
- `.env` is gitignored; never commit seed phrases or API keys.
