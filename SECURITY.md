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
- Transaction data forwarded from the LI.FI API — verify the `to` address matches the expected LI.FI Diamond contract before production use.
- API key and seed phrases must never be committed to version control. Use `.env` files and the provided `.env.example` as a template.

## Out of Scope

- Issues in `@tetherto/wdk-wallet` or the LI.FI API itself — report those to Tether and LI.FI respectively.
- Issues requiring physical access to the user's device.
