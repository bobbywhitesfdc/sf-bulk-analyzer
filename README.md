sf-bulk-analyzer
================

A Salesforce CLI plugin that analyzes Bulk API job failures and summarizes them by normalized error signature — so you can tell at a glance whether 130,000 failures are one problem or twenty.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/sf-bulk-analyzer.svg)](https://npmjs.org/package/sf-bulk-analyzer)
[![Downloads/week](https://img.shields.io/npm/dw/sf-bulk-analyzer.svg)](https://npmjs.org/package/sf-bulk-analyzer)

## Installation

This is a plugin for the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli). Install it with:

```sh-session
sf plugins install sf-bulk-analyzer
```

Verify:

```sh-session
sf bulk --help
```

## Claude Code Skill

The plugin ships with a bundled [Claude Code](https://claude.ai/code) skill that lets Claude analyze bulk job failures on your behalf — resolving job IDs from Slack threads, running the analysis, and synthesizing a summary.

Install the skill after installing the plugin:

```sh-session
sf bulk install-skill
```

This copies `SKILL.md` to `~/.claude/skills/sf-bulk-analyzer/`. Restart Claude Code to activate it. Once active, you can say things like:

- "Analyze bulk job 750dy00000ZlJW5 on INTQA"
- "Why did this job fail?" (paste a Slack thread URL)
- "List all failed bulk jobs on UAT from the last week"

## Usage

### List jobs and identify failures

```sh-session
# Show all ingest jobs (query/queryAll excluded by default)
sf bulk list-jobs --target-org myorg

# Include processed/failed counts — fastest way to spot jobs worth digging into
sf bulk list-jobs --target-org myorg --with-metrics

# Filter by object or state
sf bulk list-jobs --target-org myorg --object Producer --with-metrics
sf bulk list-jobs --target-org myorg --job-type v2 --state JobComplete
```

### Analyze a job

```sh-session
# Human-readable two-level summary
sf bulk analyze 750dy00000ZlJW5 --target-org myorg

# Machine-readable JSON (for scripting or the Claude skill)
sf bulk analyze 750dy00000ZlJW5 --target-org myorg --json
```

Output:
```
=== Bulk Job 750dy00000ZlJW5 — Failure Analysis ===
Total failures: 500 (sampled 500)

--- Level 1: By Error Signature ---
     381  MISSING_ARGUMENT: Agency_BP_Id__c
      80  INVALID_FIELD: foreign key Producer_BP_Id__c not found in Contact
      39  INVALID_FIELD: foreign key Agency_BP_Id__c not found in Account

--- Level 2: Sample of Raw Messages (first 20) ---
  [] MISSING_ARGUMENT:Agency_BP_Id__c not specified:--
  ...
```

**Level 1** groups failures by normalized signature — record IDs, data values, and other noise are stripped so thousands of identical errors collapse to a single counted line.

**Level 2** shows raw messages for spot-checking.

If failures exceed 10,000 records or 80% of processed records, a stratified sample of 500 rows is analyzed instead of the full set.

### Analyze local CSV files (no org connection)

```sh-session
sf bulk analyze-files ./bulk_failures/
```

Accepts directories containing v2 failed results CSVs (`sf__Id`, `sf__Error` columns) or v1 batch result CSVs (`Success`, `Error` columns).

## Customizing Error Classifiers

Error classifiers are defined in `classifiers.yaml`, which ships with the plugin. Each classifier maps an error code to one or more regex patterns that normalize the raw error message into a stable signature.

To extend or override classifiers for your org, create `~/.sf-bulk-analyzer/classifiers.yaml`:

```yaml
classifiers:
  # Override an existing code — replaces the bundled definition entirely
  - code: MISSING_ARGUMENT
    patterns:
      - match: 'MISSING_ARGUMENT:(.+?) not specified'
        signature: "MISSING_ARGUMENT: {1}"
      - signature: "MISSING_ARGUMENT [?]"

  # Add a new code — inserted before UNKNOWN in the matching order
  - code: MY_CUSTOM_ERROR
    patterns:
      - match: 'MY_CUSTOM_ERROR: field (\S+)'
        signature: "MY_CUSTOM_ERROR: {1}"
      - signature: "MY_CUSTOM_ERROR [?]"
```

Pattern fields:
- `match` — JavaScript regex string. Omit to use this pattern as a catch-all fallback.
- `signature` — output string. Use `{1}`, `{2}`, etc. to reference capture groups.

You can also point either analyze command at a specific file:

```sh-session
sf bulk analyze 750dy00000ZlJW5 --target-org myorg --classifiers ./project-classifiers.yaml
```

## Command Reference

<!-- commands -->
* [`sf-bulk-analyzer bulk analyze JOBID`](#sf-bulk-analyzer-bulk-analyze-jobid)
* [`sf-bulk-analyzer bulk analyze-files DIR`](#sf-bulk-analyzer-bulk-analyze-files-dir)
* [`sf-bulk-analyzer bulk install-skill`](#sf-bulk-analyzer-bulk-install-skill)
* [`sf-bulk-analyzer bulk list-jobs`](#sf-bulk-analyzer-bulk-list-jobs)
* [`sf-bulk-analyzer help [COMMAND]`](#sf-bulk-analyzer-help-command)

## `sf-bulk-analyzer bulk analyze JOBID`

Analyze failures for a Bulk API job.

```
USAGE
  $ sf bulk analyze JOBID -o <value> [--json] [--output-dir <value>]
    [--sample-size <value>] [--sample-threshold <value>] [--classifiers <value>]

ARGUMENTS
  JOBID  Bulk API job ID to analyze.

FLAGS
  -o, --target-org=<value>        (required) Org alias or username.
      --classifiers=<value>       Path to a custom classifiers YAML file.
      --output-dir=<value>        Write analysis files to this directory.
      --sample-size=<value>       [default: 500] Max records to include in sample.
      --sample-threshold=<value>  [default: 80] Failure % of processed records that triggers sampling.

GLOBAL FLAGS
  --json  Format output as json.
```

_See code: [src/commands/bulk/analyze.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.1/src/commands/bulk/analyze.ts)_

## `sf-bulk-analyzer bulk analyze-files DIR`

Analyze locally downloaded Bulk API failure CSVs without an org connection.

```
USAGE
  $ sf bulk analyze-files DIR [--json] [--sample-size <value>] [--sample-threshold <value>] [--classifiers <value>]

ARGUMENTS
  DIR  Directory containing failure CSV files.

FLAGS
  --classifiers=<value>       Path to a custom classifiers YAML file.
  --sample-size=<value>       [default: 500] Max records to include in sample.
  --sample-threshold=<value>  [default: 80] Failure % that triggers sampling.

GLOBAL FLAGS
  --json  Format output as json.
```

_See code: [src/commands/bulk/analyze-files.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.1/src/commands/bulk/analyze-files.ts)_

## `sf-bulk-analyzer bulk install-skill`

Install the bundled Claude Code skill to `~/.claude/skills/`.

```
USAGE
  $ sf bulk install-skill [--json]

GLOBAL FLAGS
  --json  Format output as json.
```

_See code: [src/commands/bulk/install-skill.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.1/src/commands/bulk/install-skill.ts)_

## `sf-bulk-analyzer bulk list-jobs`

List Bulk API jobs for an org.

```
USAGE
  $ sf bulk list-jobs -o <value> [--json] [-b <value>] [--job-type v1|v2]
    [-s <value>] [--all-operations] [--with-metrics]

FLAGS
  -b, --object=<value>      Filter by Salesforce object name (case-insensitive).
  -o, --target-org=<value>  (required) Org alias or username.
  -s, --state=<value>       Filter by job state (e.g. JobComplete, Failed, Closed).
      --all-operations      Include query and queryAll jobs (excluded by default).
      --job-type=<option>   Filter by API version. <options: v1|v2>
      --with-metrics        Fetch processed/failed record counts for each job.

GLOBAL FLAGS
  --json  Format output as json.
```

_See code: [src/commands/bulk/list-jobs.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.1/src/commands/bulk/list-jobs.ts)_

## `sf-bulk-analyzer help [COMMAND]`

Display help for sf-bulk-analyzer.

```
USAGE
  $ sf-bulk-analyzer help [COMMAND...] [-n]

FLAGS
  -n, --nested-commands  Include all nested commands in the output.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.50/src/commands/help.ts)_
<!-- commandsstop -->
