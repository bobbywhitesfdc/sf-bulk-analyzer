# sf-bulk-analyzer Backlog

## [BACKLOG] `--fields` flag: show ETL field list via successfulResults headers

**Command(s):** `sf bulk list-jobs`, possibly `sf bulk analyze`  
**Priority:** Medium  
**Origin:** Forensic ETL analysis on INTQA, 2026-06-20

### Background

The Bulk v2 successful results endpoint returns the original upload CSV, including its header row:

```
GET /services/data/vXX.0/jobs/ingest/{jobId}/successfulResults
```

Response headers: `sf__Created`, `sf__Id`, `<original upload columns...>`

This is the only passive forensic method to determine which fields an ETL (or any bulk ingest process) is writing per object — without access to source system config, field history tracking, or Splunk/Huron logs.

Only one completed job per object is needed; the column schema is consistent across runs.

> **CORRECTION (verified on FSCDEMO, 2026-06-20):** the "consistent across runs"
> assumption does NOT hold. Different jobs against the same object can upload
> different field sets (e.g. distinct ETL stages — one Account job loads
> `Name,Agency_BP_Id__c,RecordType.Name`, another loads
> `FirstName,LastName,MM_Member_Id__c,MM_Member_Id__pc,RecordType.Name`).
> Item 1 ships dedup-by-most-recent (one GET per object), which is LOSSY.
> For forensic completeness (and before Item 3 generates a permission set), the
> **union of upload fields across all completed jobs per object** is the safer
> input. Open decision: add a `--union` mode (one GET per job) vs. keep
> most-recent as the default.

### Proposed UX

```
sf bulk list-jobs --target-org myorg --fields
```

Output: augment the existing job list with a `Fields` column (or a sub-table) showing the upload column list for each unique object. 

Alternatively (or additionally), as a flag on `sf bulk analyze`:

```
sf bulk analyze <jobId> --target-org myorg --fields
```

Would print the field list alongside the failure summary.

JSON representation would show the fields as a collection.

### Implementation notes Bulk V2

- Endpoint only available for v2 ingest jobs (not v1 Classic, not queryAll)
- Skip jobs in states other than `JobComplete` — results may be incomplete or unavailable
- Only fetch headers (first line of CSV response) — no need to download the full result set
- One `GET` per unique object, not per job — dedup before fetching
- Relevant source file: `src/commands/bulk/list-jobs.ts`, `src/lib/bulkApiClient.ts`

### Implementation thoughts Bulk V1
- https://www.postman.com/content-platform-6481/sf-platform-apis/example/20195085-dbc6a085-dcee-4060-9d97-8d30bff95fcd?sideView=agentMode

### Bonus points
- Header fields with dot notation are lookups by externalId
  - **Exception — `RecordType.*`:** dot notation does NOT always mean external-id lookup.
    `RecordType.Name` resolves `RecordTypeId` by matching the RecordType **Label** (the
    `Name` field), NOT `DeveloperName` (DeveloperName is not indexed, so it can't back a
    Bulk match). Effective resolution:
    `SELECT Id FROM RecordType WHERE SobjectType = '<object>' AND Name = '<label value>'`
    Caveat: labels are not guaranteed unique, so an ambiguous label can break the match.
    Permission-side, record-type access is granted via `recordTypeVisibilities` keyed by
    `Object.DeveloperName` — do not conflate the load-time match key (label) with the
    permission key (DeveloperName).
  - Ex:  Object: Contact. Field: Account.MyExternalId__c
  	- Header:  FirstName,LastName,Account.MyExternalId__c
  	- Data:   "Bobby", "White", "ABC-01234"
  	- This is resolving the field Contact.AccountId by matching the supplied value
  		- select Id from Account Where MyExternalId__c = 'ABC-01234'
  - Ex:  Object: InsurancePolicy Field: NamedInsured.MyExternalId__c
  	- Header:  Name,NamedInsured.MyExternalId__c
  	- Data:   "POL-123", "ABC-01234"
  	- This is resolving the field InsurancePolicy.NamedInsuredId by matching the supplied value
  		- select Id from Account Where MyExternalId__c = 'ABC-01234'
  - Ex:  Object: Foo__c Field: Contact__r.MyExternalId__c
  	- Header:  Name,Contact__r.MyExternalId__c
  	- Data:   "FOO-123", "ABC-01234"
  	- This is resolving the field Foo__c.Contact__c by matching the supplied value
  		- select Id from Contact Where MyExternalId__c = 'ABC-01234'
 
 # Item 2 -- Targeted schema enrichment for permission analysis

**Status (2026-06-21):** lookup-target resolution shipped in 0.2.0 — `--fields --json`
already enriches dot-notation columns with `targetField` / `targetObject` / `required`
via one cached describe per object.

**Decision:** do NOT build a broad "describe the whole load schema" feature. The
remaining work is a *surgical* enrichment of the existing `--fields` classified output,
scoped to exactly what's needed to build a deployable permission set (see Item 3).
The plugin already calls describe for lookup resolution, so adding a few fields per
column is nearly free.

Add to each `uploadFieldsClassified` entry:
- `apiName` — the canonical field API name (correct casing). Headers arrive as
  `agreement_key__c` or `NameInsured.mm_member_id__c`; permission-set XML needs the exact
  `Object.Field`, so the resolved describe name is required.
- `flsEligible` — describe `permissionable`. Fields that can't take FLS (Name,
  required/master-detail, formula/read-only, system fields) must be SKIPPED or a permset
  deploy fails. This is the single most important addition.
- `type` — to spot formula/read-only/calculated fields (no Edit FLS possible).
- (optional) `createable` / `updateable` — for upsert semantics.

For `recordType` columns, also surface the object's `recordTypeInfos` (label → DeveloperName)
so the consumer can map the label match key to the `recordTypeVisibilities` DeveloperName.
Note: which record types are actually used lives in the data rows, not the header — so this
can only enumerate candidates, not pick the exact ones.

# Item 3 - Permissions (let Claude generate; plugin only informs)

**Decision (2026-06-21):** do NOT generate permission-set metadata in the plugin.
Permset XML generation is deterministic and trivial for an agent — once `--fields --json`
carries the Item 2 enrichment (canonical names + FLS-eligibility + recordtype dev-names),
Claude can author or update the `.permissionset-meta.xml` directly across all jobs.

What a permset needs and where it comes from:
- **OLS** (object Create/Read/Edit) — derivable today from `object` + `operation`
  (upsert ⇒ Create+Read+Edit). No `--fields` required.
- **FLS edit** on each written field — `apiName`, gated by `flsEligible` (Item 2).
- **FLS read** on the referenced object's external-id match field — `targetObject` +
  `matchField` (shipped).
- **recordTypeVisibilities** — keyed by `Object.DeveloperName` (Item 2 `recordTypeInfos`).

Caveat: this assumes an interactive (Claude-in-the-loop) flow. If headless/CI permset
generation is ever wanted (no LLM), deterministic code generation regains its value and
Item 3 would come back as a real command.


 