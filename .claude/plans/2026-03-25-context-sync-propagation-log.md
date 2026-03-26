# Context Sync Propagation Log — 2026-03-25

## What happened

`organvm context sync` was blocked since 2026-03-21 by 10 registry validation errors:
- 7 contrib repos missing `implementation_status`
- `contrib--adenhq-hive` had invalid tier `"contrib"`
- `cvrsvs-honorvm` had invalid `"INCUBATOR"` for both `implementation_status` and `promotion_status`

## What was fixed

1. **Registry** (`organvm-corpvs-testamentvm/registry-v2.json`): All 10 errors resolved, committed, pushed.
2. **stakeholder-portal/CLAUDE.md**: Context sync refreshed, committed, pushed.
3. **meta-organvm superproject CLAUDE.md**: Updated by sync (workspace-level, tracks via allowlist).

## What remains — 59 repos with dirty CLAUDE.md

The full `organvm context sync --write` was run, which updated CLAUDE.md files across the entire workspace. These changes are on disk but uncommitted. Each repo needs its CLAUDE.md committed and pushed.

### META-ORGANVM (7 repos)
- `organvm-engine`
- `system-dashboard`
- `organvm-mcp-server`
- `alchemia-ingestvm`
- `organvm-ontologia`
- `praxis-perpetua` (also has 9 uncommitted research files — IRF-SGO-008)
- `schema-definitions`

### ORGAN-I (12 repos)
See: `cd ~/Workspace/organvm-i-theoria && for r in */; do git -C "$r" diff --name-only CLAUDE.md 2>/dev/null | grep -q . && echo "$r"; done`

### ORGAN-II (8 repos)
### ORGAN-III (7 repos)
### ORGAN-IV (16 repos)
### ORGAN-V (1 repo)
### ORGAN-VI (5 repos)
### ORGAN-VII (3 repos)

## Recommended batch commit

From each organ directory:
```bash
for repo in */; do
  (cd "$repo" && git diff --quiet CLAUDE.md 2>/dev/null || \
    (git add CLAUDE.md && git commit -m "docs: context sync refresh 2026-03-25" && git push))
done
```

Or use the engine's bulk tool if available:
```bash
organvm git sync-all --message "docs: context sync refresh 2026-03-25"
```
