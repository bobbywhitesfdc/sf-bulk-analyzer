# sf-bulk-analyzer skill

Analyze Salesforce Bulk API job failures and produce a structured summary.

## When to invoke

Use this skill when:
- A user provides a Bulk API job ID and wants to know why it failed
- A user pastes a Slack thread URL referencing a Bulk API job failure
- A code review or incident post-mortem needs a failure breakdown
- The user says "analyze bulk job", "why did job X fail", or "bulk job errors"

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
     }
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

## Notes

- If `sf bulk analyze` fails with an auth error, prompt the user to run `sf org login web --alias <alias>`.
- If the job is still in progress (`state != JobComplete`), warn the user the analysis is partial.
- If `sampled: true`, always note that figures are estimates from a stratified sample.
- The skill does not deploy or modify any Salesforce data — it is read-only.
