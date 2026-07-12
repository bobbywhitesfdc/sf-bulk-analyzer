# sf-bulk-analyzer — Contributor Workflow

Use this when contributing to the sf-bulk-analyzer OSS plugin: switching between
the local dev build and the published version, publishing a new release, or
checking which version is active.

---

## Switch to local build (test in-progress changes)

```zsh
cd ~/projects/sf-bulk-analyzer
npm run build
sf plugins link ~/projects/sf-bulk-analyzer
```

Verify: `sf plugins` — entry should show `sf-bulk-analyzer (link)`

---

## Revert to published version

`sf plugins install` hits npm's `min-release-age=7` guard in `~/.npmrc` for
recently published packages. Correct sequence:

1. Remove the guard:
   Edit `~/.npmrc` — remove the `min-release-age=7` line.

2. Install the published version:
   ```zsh
   sf plugins unlink sf-bulk-analyzer 2>/dev/null
   sf plugins install sf-bulk-analyzer@<version>
   ```
   Use an explicit version, not `@latest` — oclif's `@latest` tag resolution
   has a known bug with recently published packages.

3. Restore the guard immediately after install:
   Edit `~/.npmrc` — add `min-release-age=7` back as the first line.

Verify: `sf plugins` — entry should show `sf-bulk-analyzer <version>` without `(link)`

---

## Publish a new version

Prerequisites: working tree must be clean (all changes committed).

```zsh
cd ~/projects/sf-bulk-analyzer
npm version patch        # or minor / major
git push
npm publish --access public
```

`npm version patch` will:
- Bump `package.json`
- Run `prepack` (oclif manifest + readme regeneration) via the version script
- Create a git commit and tag

After publish, commit any README changes oclif regenerated:
```zsh
git add README.md && git commit -m "Update README command reference for vX.Y.Z" && git push
```

Newly published versions are blocked by `min-release-age=7` for 7 days —
use the "Revert to published" flow above when installing immediately after publish.

---

## Check active version

```zsh
sf plugins
```

- `sf-bulk-analyzer X.Y.Z (link)` → local build active
- `sf-bulk-analyzer X.Y.Z` → published version active
