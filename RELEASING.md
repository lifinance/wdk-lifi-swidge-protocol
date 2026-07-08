# Releasing

This package uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing to npm. The release pipeline runs entirely through GitHub Actions — no manual `npm publish` is needed.

---

## How it works

```
Developer opens PR
  └─▶ [CI] lint + test + build:types run automatically

Developer adds a changeset to the PR
  └─▶ npm run changeset   (select bump type: patch / minor / major)
  └─▶ commit the generated .changeset/<random>.md file

PR is merged to main
  └─▶ [release.yml] Changesets bot opens "Version Packages" PR
        • bumps version in package.json
        • updates CHANGELOG.md

"Version Packages" PR is reviewed and merged
  └─▶ [release.yml] no pending changesets detected
        • runs npm run build:types
        • publishes to npm (OIDC, no token stored in secrets)
        • creates a GitHub Release with the changelog entry
```

---

## Step-by-step guide

### 1. Make your code changes in a feature branch

Open a pull request as usual.

### 2. Add a changeset

Run this command inside the repo:

```bash
npm run changeset
```

The interactive CLI will ask:

- Which packages are affected (just this one in a single-package repo)
- What kind of change: `patch` (bug fix), `minor` (new feature), `major` (breaking change)
- A summary of the change

This creates a small Markdown file under `.changeset/`. Commit it along with your code changes.

> If your PR is a chore (docs update, CI fix, dependency bump) that should **not** produce a release, skip this step — no changeset needed.

### 3. Get the PR reviewed and merge it

Use **Squash and merge** into `main`.

### 4. Changesets bot opens a "Version Packages" PR

Within seconds the `release.yml` workflow runs and the `github-actions` bot opens (or updates) a PR titled **"chore: version packages"**. This PR:

- Bumps the version in `package.json`
- Rewrites `CHANGELOG.md` with a formatted entry linking to your PR

Review the changelog entry, then merge this PR (Squash and merge is fine).

### 5. npm publish happens automatically

The `release.yml` workflow runs again. Because there are no pending changesets, it publishes the new version to npm and creates a GitHub Release.

---

## Pre-release / preview releases

### Preview from a PR (throwaway)

Add the `release-preview` label to any open PR. The `release.yml` workflow will publish a short-lived version to npm under the `preview` dist-tag:

```
@lifi/wdk-protocol-swidge-lifi@0.0.0-preview-<short-sha>
```

A bot comment on the PR shows the exact install command. This version is not meant to be permanent — it's for integration testing only.

### Alpha / beta channels (pre mode)

For longer-lived pre-release channels (e.g. a `beta` branch), use Changesets' `pre` mode:

```bash
# Enter pre mode on a dedicated branch
npx changeset pre enter beta

# Work and add changesets as usual, then version and publish:
npm run changeset:version
npm run changeset:publish   # publishes with --tag beta
```

Exit pre mode before merging back to main:

```bash
npx changeset pre exit
```

---

## Local commands reference

| Command                     | Description                                                 |
| --------------------------- | ----------------------------------------------------------- |
| `npm run changeset`         | Start the interactive changeset wizard                      |
| `npm run changeset:version` | Apply pending changesets (bump versions + update changelog) |
| `npm run changeset:publish` | Build types then publish to npm                             |
| `npm run lint`              | Run Standard linter                                         |
| `npm test`                  | Run unit tests                                              |
| `npm run build:types`       | Generate TypeScript declarations                            |

---

## Troubleshooting

**The "Version Packages" PR isn't being created**

- Check the `release.yml` run in the Actions tab for errors
- Ensure the workflow has `pull-requests: write` permission (already set)
- Confirm the push is to `main` and the repo name matches `lifinance/wdk-lifi-swidge-protocol`

**npm publish fails with 403**

- OIDC trusted publishing is not configured — follow the one-time setup above
- Or add `NPM_TOKEN` to the repository secrets as a fallback

**Preview publish fails**

- Ensure the `release-preview` label exists in the repository
- Only pushes from within the same repo (not forks) can trigger preview releases

**No changeset on a PR**

- The Changesets bot may add a comment reminding you. This is intentional — if the change is intentionally chore-only, you can ignore it.
