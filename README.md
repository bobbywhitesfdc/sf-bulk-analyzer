sf-bulk-analyzer
================

A Salesforce CLI plugin that analyzes Bulk API job failures and summarizes them by normalized error signature — so you can tell at a glance whether 130,000 failures are one problem or twenty.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/sf-bulk-analyzer.svg)](https://npmjs.org/package/sf-bulk-analyzer)
[![Downloads/week](https://img.shields.io/npm/dw/sf-bulk-analyzer.svg)](https://npmjs.org/package/sf-bulk-analyzer)

## Install

`sf-bulk-analyzer` ships two ways. Most users want the **Claude Code skill** — it drives the CLI for you and bootstraps the CLI plugin on first use.

### Claude Code skill (recommended)

Add this repo as a plugin marketplace, then install the skill:

```sh-session
/plugin marketplace add bobbywhitesfdc/sf-bulk-analyzer
/plugin install sf-bulk-analyzer@sf-bulk-analyzer-marketplace
```

The skill drives the analysis for you — resolving job IDs from Slack threads, running the commands, and synthesizing a summary. On first use it checks for the `sf bulk` CLI plugin and, **with your confirmation**, installs it (`sf plugins trust allowlist add` + `sf plugins install`). Once active you can say things like:

- "Analyze bulk job 750dy00000ZlJW5 on INTQA"
- "Why did this job fail?" (paste a Slack thread URL)
- "List all failed bulk jobs on UAT from the last week"

### SF CLI plugin (direct)

To use the `sf bulk` commands yourself — or if you don't use Claude Code — install the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) plugin directly:

```sh-session
sf plugins install sf-bulk-analyzer
sf bulk --help
```

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

# Reverse engineer the upload field list each load wrote (see "Reverse engineering upload fields" below)
sf bulk list-jobs --target-org myorg --fields
```

### Analyze a job

```sh-session
# Human-readable two-level summary
sf bulk analyze 750dy00000ZlJW5 --target-org myorg

# Machine-readable JSON (for scripting or the Claude skill)
sf bulk analyze 750dy00000ZlJW5 --target-org myorg --json

# Tune the worker pool for large V1 jobs (default 15)
sf bulk analyze 750dy00000ZlJW5 --target-org myorg --concurrency 25

# Also reverse engineer the upload field list this job wrote (see "Reverse engineering upload fields" below)
sf bulk analyze 750dy00000ZlJW5 --target-org myorg --fields
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

Sampling kicks in when failures exceed 10,000 records OR exceed the `--sample-threshold` percentage (default 80%) of processed records AND the failure count is large enough to warrant it. A stratified sample of `--sample-size` rows (default 500) is analyzed instead of the full set.

**Bulk API v1 and v2 are both supported.** The plugin auto-detects which API version a job used. For v1 jobs, batch result CSVs are downloaded in parallel using a worker pool (controlled by `--concurrency`).

### Analyze local CSV files (no org connection)

```sh-session
sf bulk analyze-files ./bulk_failures/
```

Accepts directories containing v2 failed results CSVs (`sf__Id`, `sf__Error` columns) or v1 batch result CSVs (`Success`, `Error` columns).

### Reverse engineering upload fields (`--fields`)

`--fields` reverse engineers the **list of fields a load actually wrote** — the original upload CSV header. This is often the only passive way to determine which fields an ETL (or any bulk ingest process) maps per object, without access to the source system, field history, or pipeline logs.

It works for both API versions:
- **v2** reads the header of the `successfulResults` endpoint (job must be `JobComplete`).
- **v1** reads the header of the first batch's submitted `request` payload.

Only the first line is read — the full result set is never downloaded. Loader-added result columns (`sf__Id`, `sf__Created`, and the v1 loader's `Id`) are stripped.

```sh-session
# Per-job field list alongside the failure summary
sf bulk analyze 750dy00000ZlJW5 --target-org myorg --fields

# Every load's field list (one per job — the same object loaded twice with
# different fields shows up as two distinct entries)
sf bulk list-jobs --target-org myorg --fields
```

Human output lists the raw column names:

```
--- Upload Fields ---
  Name
  PolicyName
  Agreement_Key__c
  NameInsured.mm_member_id__c
  PolicyType
```

`--json` additionally returns `uploadFieldsClassified`, which classifies each column and — for dot-notation references — resolves the **object on the other end** via a single (cached) describe per object:

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

`kind` is one of `direct`, `externalIdLookup`, or `recordType`. A `RecordType.Name` column resolves `RecordTypeId` by matching the record type **Label** (the `Name` field), not its `DeveloperName`.

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
* [`sf-bulk-analyzer bulk list-jobs`](#sf-bulk-analyzer-bulk-list-jobs)
* [`sf-bulk-analyzer help [COMMAND]`](#sf-bulk-analyzer-help-command)

## `sf-bulk-analyzer bulk analyze JOBID`

Analyze failures for a Bulk API job.

```
USAGE
  $ sf-bulk-analyzer bulk analyze JOBID -o <value> [--json] [--flags-dir <value>] [--classifiers <value>]
    [--concurrency <value>] [--fields] [--output-dir <value>] [--sample-size <value>] [--sample-threshold <value>]

ARGUMENTS
  JOBID  Bulk API job ID to analyze.

FLAGS
  -o, --target-org=<value>        (required) Org alias or username.
      --classifiers=<value>       Path to a custom classifiers YAML file.
      --concurrency=<value>       [default: 15] Number of parallel batch workers for large jobs.
      --fields                    Inspect and show the upload field list for the job (Bulk v1 and v2).
      --output-dir=<value>        Write analysis files to this directory.
      --sample-size=<value>       [default: 500] Max records to include in sample.
      --sample-threshold=<value>  [default: 80] Failure % of processed records that triggers sampling.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Analyze failures for a Bulk API job.

  Fetches failed records for a Bulk API v1 or v2 job and summarizes errors by normalized signature.

EXAMPLES
  $ sf bulk analyze 750xx0000000001 --target-org myorg

  $ sf bulk analyze 750xx0000000001 --target-org myorg --fields

  $ sf bulk analyze 750xx0000000001 --target-org myorg --json

  $ sf bulk analyze 750xx0000000001 --target-org myorg --classifiers ./my-classifiers.yaml
```

_See code: [src/commands/bulk/analyze.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.4.0/src/commands/bulk/analyze.ts)_

## `sf-bulk-analyzer bulk analyze-files DIR`

Analyze locally downloaded Bulk API failure CSVs without an org connection.

```
USAGE
  $ sf-bulk-analyzer bulk analyze-files DIR [--json] [--flags-dir <value>] [--classifiers <value>] [--sample-size
    <value>] [--sample-threshold <value>]

ARGUMENTS
  DIR  Directory containing failure CSV files.

FLAGS
  --classifiers=<value>       Path to a custom classifiers YAML file.
  --sample-size=<value>       [default: 500] Max records to include in sample.
  --sample-threshold=<value>  [default: 80] Failure % that triggers sampling.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

EXAMPLES
  $ sf bulk analyze-files ./bulk_analysis_750xx0000000001

  $ sf bulk analyze-files ./bulk_analysis_750xx0000000001 --json
```

_See code: [src/commands/bulk/analyze-files.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.4.0/src/commands/bulk/analyze-files.ts)_

## `sf-bulk-analyzer bulk list-jobs`

List Bulk API jobs for an org.

```
USAGE
  $ sf-bulk-analyzer bulk list-jobs -o <value> [--json] [--flags-dir <value>] [--all-operations] [--fields]
    [--job-type v1|v2] [-b <value>] [-s <value>] [--with-metrics]

FLAGS
  -b, --object=<value>      Filter by Salesforce object name (case-insensitive).
  -o, --target-org=<value>  (required) Org alias or username.
  -s, --state=<value>       Filter by job state (e.g. JobComplete, Failed, Closed).
      --all-operations      Include query and queryAll jobs (excluded by default).
      --fields              Inspect the upload field list per load (Bulk v1, and v2 JobComplete jobs).
      --job-type=<option>   Filter by API version.
                            <options: v1|v2>
      --with-metrics        Fetch processed/failed record counts for each job (one extra API call per job).

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  List Bulk API jobs for an org.

  Lists Bulk API jobs. Query and queryAll operations are excluded by default — use --all-operations to include them.

EXAMPLES
  $ sf bulk list-jobs --target-org myorg

  $ sf bulk list-jobs --target-org myorg --with-metrics

  $ sf bulk list-jobs --target-org myorg --object Contact

  $ sf bulk list-jobs --target-org myorg --job-type v2 --state JobComplete

  $ sf bulk list-jobs --target-org myorg --all-operations

  $ sf bulk list-jobs --target-org myorg --fields

  $ sf bulk list-jobs --target-org myorg --json
```

_See code: [src/commands/bulk/list-jobs.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.4.0/src/commands/bulk/list-jobs.ts)_

## `sf-bulk-analyzer help [COMMAND]`

Display help for sf-bulk-analyzer.

```
USAGE
  $ sf-bulk-analyzer help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for sf-bulk-analyzer.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.50/src/commands/help.ts)_
<!-- commandsstop -->
