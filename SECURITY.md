# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

**Do not file a public GitHub issue for security vulnerabilities.**

Report security issues to **security@li.fi**. Include:
- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept (if safe to share).
- Any suggested mitigations.

We will acknowledge receipt within 2 business days and aim to ship a fix within 14 days for critical issues.

## Scope

This module handles token approvals and transaction construction on behalf of wallet users. Key areas of concern:

- ERC-20 allowance logic (approval amounts must be exact minimum — never infinite).
- Transaction data forwarded from the LI.FI API. Structural validation (valid target address, hex calldata, parseable amounts) always runs before any transaction is built. For production use, enable the `trustedContracts` config so the transaction target and approval address are additionally checked against a per-chain allowlist of LI.FI Diamond deployments — an untrusted address is rejected with `LifiUntrustedContractError` before any approval is granted. When `trustedContracts` is unset (the default, matching LI.FI SDK behavior), the transport layer (TLS to `li.quest`) is the trust boundary for these fields.
- API key and seed phrases must never be committed to version control. Use `.env` files and the provided `.env.example` as a template.

## Out of Scope

- Issues in `@tetherto/wdk-wallet` or the LI.FI API itself — report those to Tether and LI.FI respectively.
- Issues requiring physical access to the user's device.
