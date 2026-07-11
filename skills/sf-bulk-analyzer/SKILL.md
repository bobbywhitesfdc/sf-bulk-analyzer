---
name: sf-bulk-analyzer
description: Use when a user wants to know why a Salesforce Bulk API job failed, or which fields a load/ETL wrote to an object. Triggers on a Bulk API job ID, a Slack thread about a bulk job failure, phrases like "analyze bulk job", "why did job X fail", "bulk job errors", or "which fields did this load upload / what columns did the ETL map". Orchestrates the `sf bulk` CLI (analyze, analyze-files, list-jobs) and produces a structured failure summary or upload-field breakdown. Read-only — never modifies Salesforce data.
metadata:
  type: skill
  version: "0.2.0"
---

# sf-bulk-analyzer skill

Analyze Salesforce Bulk API job failures and produce a structured summary.

This skill is the orchestration layer for the `sf-bulk-analyzer` CLI plugin: it removes the
burden of remembering the `sf bulk` commands and their flags. The CLI does the heavy lifting
(fetching jobs, sampling, classifying errors, resolving field mappings); the skill decides what
to run, parses the JSON, and presents it.

## Preflight — confirm the CLI plugin is installed

This skill drives the `sf bulk` commands, which are provided by the **separate** `sf-bulk-analyzer`
CLI plugin. Installing this Claude plugin does **not** install the CLI. Before the first analysis
in a session, confirm the command exists:

```
sf bulk analyze --help
```

If that fails with "command not found" / "not installed", stop and tell the user to install the
CLI plugin first, then retry:

```
sf plugins install sf-bulk-analyzer
```

Do not attempt to analyze a job until the `sf bulk` commands resolve.

## When to invoke

Use this skill when:
- A user provides a Bulk API job ID and wants to know why it failed
- A user pastes a Slack thread URL referencing a Bulk API job failure
- A code review or incident post-mortem needs a failure breakdown
- The user says "analyze bulk job", "why did job X fail", or "bulk job errors"
- The user asks **which fields a load/ETL writes** to an object, "what columns did this job upload",
  "what does the ETL map for <object>", or wants to map lookups/external IDs used by a load
  (use the `--fields` flag — see "Recovering upload fields" below)

## Inputs (accept any of these)

| Input | How to handle |
|-------|--------------|
| Job ID (e.g. `750dy00000ZlJW5`) | Use directly |
| Slack thread URL | Read the thread with the Slack MCP tool; extract job ID and org alias from message content |
| Work directory (e.g. `./bulk_analysis_750dy00000ZlJW5`) | Use `sf bulk analyze-files <dir>` instead |
| No explicit org | Resolve from `project.properties` (key `sf.defaultusername`) or ask the user |

## Execution steps

1. **Resolve job ID and org alias** from the input (see table above).
2. **Run the analyzer:**
   ```
   sf bulk analyze <job_id> --target-org <alias> --json
   ```
   Or, if working from local files:
   ```
   sf bulk analyze-files <dir> --json
   ```
3. **Parse the JSON output.** The result shape is:
   ```json
   {
     "jobId": "...",
     "apiVersion": "v1|v2",
     "jobInfo": { "state": "...", "numberRecordsFailed": N, "numberRecordsProcessed": N },
     "summary": {
       "totalFailures": N,
       "sampled": true|false,
       "sampleSize": N,
       "level1": [{ "signature": "...", "count": N, "examples": ["..."] }],
       "level2": [{ "id": "...", "error": "..." }]
     },
     "uploadFields": ["..."],                // present only with --fields
     "uploadFieldsClassified": [ /* ... */ ] // present only with --fields (see below)
   }
   ```
4. **Produce a human-readable summary** (see format below).
5. **Offer to post to Slack** if the input came from a Slack thread — same confirmation gate as other skills (require explicit user approval before sending).

## Output format

```
## Bulk Job Analysis — <job_id>

**Org:** <alias>   **API:** v1|v2   **State:** <state>
**Failures:** <N> of <processed> records (<pct>%)
<if sampled: "(summary based on stratified sample of <N> records)">

### Top Error Signatures

| # | Signature | Count |
|---|-----------|-------|
| 1 | REQUIRED_FIELD_MISSING [LastName] | 4,210 |
| 2 | INVALID_EMAIL_ADDRESS | 1,033 |
...

### Sample Raw Messages (first 5)

- `[<id>]` <error text>
- ...
```

Keep the signature table to the top 10. Keep raw messages to 5 unless the user asks for more.

## Slack post format (requires user confirmation)

Post as a reply to the originating thread:

```
Bulk job analysis for <job_id> (@<alias>):
• <N> failures / <processed> processed (<pct>%)
• Top error: <signature> (<count>)
• Full breakdown: [paste Level 1 table]
```

## Recovering upload fields (`--fields`)

When the user wants to know **which fields a load wrote** (not why it failed), add `--fields`:

```
sf bulk analyze <job_id> --target-org <alias> --fields --json   # one job
sf bulk list-jobs --target-org <alias> --fields --json          # every load, per job
```

This recovers the original upload CSV header — the only passive way to see which fields an
ETL maps per object. Works for v1 and v2 jobs. **`list-jobs --fields` reports one fieldset per
load**, so the same object loaded with different field sets shows up as multiple entries — do not
assume one schema per object.

With `--json`, each column appears in `uploadFieldsClassified`:

```json
{
  "raw": "NameInsured.mm_member_id__c",
  "kind": "externalIdLookup",
  "relationshipName": "NameInsured",
  "matchField": "mm_member_id__c",
  "targetField": "NameInsuredId",
  "targetObject": "Account",
  "required": true
}
```

- `kind`: `direct` | `externalIdLookup` | `recordType` (person-account `__pc` fields are `direct`).
- For `externalIdLookup`/`recordType`, `targetField`/`targetObject`/`required` are resolved via a
  describe — `targetObject` is the object on the other end of the lookup. These appear only in JSON
  (the human output lists raw column names only).
- `recordType` columns (e.g. `RecordType.Name`) resolve `RecordTypeId` by matching the record type
  **Label**, not its DeveloperName.

When summarizing for the user, lead with the object and its lookups: e.g.
"This load writes `InsurancePolicy.NameInsuredId` (required lookup → **Account**) keyed on
`Account.mm_member_id__c`, plus Name, PolicyName, …".

## Notes

- If `sf bulk analyze` fails with an auth error, prompt the user to run `sf org login web --alias <alias>`.
- If the job is still in progress (`state != JobComplete`), warn the user the analysis is partial.
- If `sampled: true`, always note that figures are estimates from a stratified sample.
- The skill does not deploy or modify any Salesforce data — it is read-only.
