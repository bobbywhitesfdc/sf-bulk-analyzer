# sf-bulk-analyzer — Bootstrap Notes

## What this is

A Salesforce CLI plugin that analyzes Bulk API job failures, packaged alongside a Claude Code skill wrapper. The CLI plugin is the core artifact; the skill wraps it for use inside code reviews and AI-assisted workflows.

---

## Architecture Decision: CLI Plugin + Skill Wrapper

**Why a CLI plugin, not a standalone Node script:**

- SF CLI plugins get `this.org.getConnection()` for free — no `sf org display` JSON parsing, no manual token extraction, no auth reimplementation
- `sf bulk analyze <job_id> --target-org <alias>` is immediately useful to a human at the terminal, independent of Claude
- Installable via `sf plugins install sf-bulk-analyzer` — works everywhere SF CLI works, which is the portability guarantee (macOS, Windows, Linux)
- oclif (the SF CLI plugin framework) provides flags, help text, shell completion, and error handling for free
- Avoids the `jq`/`awk`/`curl` dependencies in the original Bash script — pure Node.js throughout

**Why a skill wrapper on top:**

- The skill resolves context that a CLI plugin cannot: job ID from a Slack thread, org alias from `project.properties`, integration with review artifacts
- Lets Claude call the plugin, capture its output, and synthesize a summary for a code review or incident post-mortem
- Keeps the plugin dumb and composable; the skill holds the orchestration logic

---

## Reference Implementation

The original Bash script is at `~/projects/MM/FSCMAIN/analyze_bulk_job.sh`. It works on macOS and is the source of truth for:

- v1 vs v2 detection logic (probe `/services/data/v{api}/jobs/ingest/{id}` first; fall through to `/services/async/` if not v2)
- Error signature classifiers (`INVALID_EMAIL_ADDRESS`, `REQUIRED_FIELD_MISSING`, `INVALID_FIELD`, `DUPLICATE_VALUE`, `INVALID_VALUE`, `INVALID_REFERENCE`, `FIELD_INTEGRITY_EXCEPTION`, catch-all `UNKNOWN`)
- Two-level summary: Level 1 by normalized signature (noise stripped), Level 2 raw messages
- Sampling logic: if failures > 10,000 or > 80% of processed records, summarize a stratified 500-row sample rather than the full set
- `--list-jobs` uses Bulk API v2 REST (`/services/data/`)
- `--analyze-files` analyzes locally downloaded CSVs without an org connection

All of these should be ported faithfully to the plugin.

---

## Suggested Project Structure

```
sf-bulk-analyzer/
  docs/
    bootstrap.md          ← this file
  src/
    commands/
      bulk/
        analyze.ts        ← sf bulk analyze <job_id>
        list.ts           ← sf bulk list-jobs
        analyze-files.ts  ← sf bulk analyze-files <dir>
    lib/
      bulkApiClient.ts    ← v1/v2 detection + API calls (wraps SF connection)
      errorClassifier.ts  ← port of awk error signature processors
      summarizer.ts       ← Level 1 (by signature) + Level 2 (raw) rollup
      sampler.ts          ← stratified sampling logic
  ~/.claude/skills/
    sf-bulk-analyzer/
      SKILL.md            ← Claude skill wrapper instructions
```

---

## CLI Commands

```
sf bulk analyze <job_id> --target-org <alias>
  --output-dir <dir>        # default: ./bulk_analysis_<job_id>
  --sample-size <n>         # default: 500
  --sample-threshold <pct>  # default: 80 (pct failed before sampling kicks in)
  --json                    # oclif standard — machine-readable output

sf bulk list-jobs --target-org <alias>
  --json

sf bulk analyze-files <dir>
  --json
```

---

## API Version Handling

The Bash script dynamically reads API version from `sf org display`. The plugin should read it from the SF connection object. The key branching logic:

1. Probe `GET /services/data/v{api}/jobs/ingest/{job_id}` with Bearer token
2. If HTTP 200 and `jobType == "V2Ingest"` → use v2 path
3. Otherwise → use v1 SOAP path (`/services/async/{api}/job/{job_id}`)

**v2 result extraction:** single call to `GET /services/data/v{api}/jobs/ingest/{job_id}/failedResults` — returns a CSV where every row is a failure, columns `sf__Id`, `sf__Error`, plus the submitted fields.

**v1 result extraction:** enumerate batches via `/services/async/{api}/job/{job_id}/batch`, then download each batch's result CSV and filter for `Success == "false"`.

---

## Error Classifier Port (awk → TypeScript)

The awk processors in the Bash script map directly to TypeScript functions. Preserve the same signal/noise philosophy: strip record IDs, email addresses, and data values; keep error code, field name, and entity name.

| awk function | TS equivalent | Notes |
|---|---|---|
| `proc_INVALID_EMAIL_ADDRESS` | trivial | returns constant string |
| `proc_REQUIRED_FIELD_MISSING` | extract field from `[...]` | |
| `proc_INVALID_FIELD` | two branches: foreign key vs invalid field name | |
| `proc_DUPLICATE_VALUE` | extract field from `[...]` | |
| `proc_INVALID_VALUE` | extract last colon-segment before ` --` | |
| `proc_INVALID_REFERENCE` | extract field after `is invalid: ` | |
| `proc_FIELD_INTEGRITY_EXCEPTION` | extract field after `)` | |
| `proc_UNKNOWN` | scan for `__c`/`__r` tokens + `in entity` | catch-all |

---

## Skill Wrapper (SKILL.md) — Intent

The skill sits in `~/.claude/skills/sf-bulk-analyzer/`. It should:

1. Accept a Slack thread URL, a job ID, or a work directory as input
2. If given a Slack thread — read the thread to extract the job ID and org alias
3. Resolve the org alias from the invocation or from `project.properties`
4. Run `sf bulk analyze <job_id> --target-org <alias> --json` via the Bash tool
5. Parse the JSON output and produce a human-readable summary: total failures, top-N signatures (Level 1), sample of raw messages (Level 2)
6. Optionally post to a Slack thread (same confirmation gate as sf-code-review)

---

## Bootstrap Checklist for New Session

- [ ] `sf generate plugin` to scaffold the oclif project
- [ ] Wire up `bulkApiClient.ts` — v1/v2 detection first, using the SF connection from `this.org`
- [ ] Port `errorClassifier.ts` from the awk processors; add unit tests for each code
- [ ] Port `summarizer.ts` — Level 1 + Level 2 rollup, sort by count descending
- [ ] Port `sampler.ts` — stratified even-spacing sample
- [ ] Implement `bulk analyze` command end-to-end
- [ ] Implement `bulk list-jobs` and `bulk analyze-files`
- [ ] Write `SKILL.md`
- [ ] Smoke test against INTQA with job `750dy00000ZlJW5`
