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
 
 