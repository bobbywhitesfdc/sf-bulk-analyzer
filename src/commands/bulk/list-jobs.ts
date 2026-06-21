import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { BulkJobInfo, fetchUploadFields, getJobInfo, listJobs } from '../../lib/bulkApiClient.js';
import { pooled } from '../../lib/pool.js';
import { makeDescribeCache, resolveLookupTargets } from '../../lib/schemaResolver.js';
import { classifyUploadFields, formatUploadFields } from '../../lib/uploadFields.js';

const QUERY_OPERATIONS = new Set(['query', 'queryall']);

export default class BulkListJobs extends SfCommand<BulkJobInfo[]> {
  public static readonly description =
    'Lists Bulk API jobs. Query and queryAll operations are excluded by default — use --all-operations to include them.';
  public static readonly examples = [
    '$ sf bulk list-jobs --target-org myorg',
    '$ sf bulk list-jobs --target-org myorg --with-metrics',
    '$ sf bulk list-jobs --target-org myorg --object Contact',
    '$ sf bulk list-jobs --target-org myorg --job-type v2 --state JobComplete',
    '$ sf bulk list-jobs --target-org myorg --all-operations',
    '$ sf bulk list-jobs --target-org myorg --fields',
    '$ sf bulk list-jobs --target-org myorg --json',
  ];
public static readonly flags = {
    'all-operations': Flags.boolean({
      default: false,
      summary: 'Include query and queryAll jobs (excluded by default).',
    }),
    fields: Flags.boolean({
      default: false,
      summary: 'Recover the upload field list per load (Bulk v1, and v2 JobComplete jobs).',
    }),
    'job-type': Flags.option({
      options: ['v1', 'v2'] as const,
      summary: 'Filter by API version.',
    })(),
    object: Flags.string({
      char: 'b',
      summary: 'Filter by Salesforce object name (case-insensitive).',
    }),
    state: Flags.string({
      char: 's',
      summary: 'Filter by job state (e.g. JobComplete, Failed, Closed).',
    }),
    'target-org': Flags.requiredOrg({ char: 'o', summary: 'Org alias or username.' }),
    'with-metrics': Flags.boolean({
      default: false,
      summary: 'Fetch processed/failed record counts for each job (one extra API call per job).',
    }),
  };
public static readonly summary = 'List Bulk API jobs for an org.';

  public async run(): Promise<BulkJobInfo[]> {
    const { flags } = await this.parse(BulkListJobs);
    const conn = flags['target-org'].getConnection();

    this.spinner.start('Fetching jobs');
    const all = await listJobs(conn);
    this.spinner.stop(`${all.length} total`);

    const filtered = all.filter((j) => {
      if (!flags['all-operations'] && QUERY_OPERATIONS.has(j.operation.toLowerCase())) return false;
      if (flags.object && j.object.toLowerCase() !== flags.object.toLowerCase()) return false;
      if (flags['job-type'] && j.apiVersion !== flags['job-type']) return false;
      if (flags.state && j.state.toLowerCase() !== flags.state.toLowerCase()) return false;
      return true;
    });

    let result = filtered;

    if (flags['with-metrics'] && filtered.length > 0) {
      this.spinner.start(`Fetching metrics for ${filtered.length} job(s)`);
      const details = await Promise.all(
        filtered.map((j) =>
          getJobInfo(conn, j.id, j.apiVersion).catch(() => null)
        )
      );
      this.spinner.stop();
      result = filtered.map((j, i) => ({
        ...j,
        errorMessage: details[i]?.errorMessage ?? j.errorMessage,
        numberRecordsFailed: details[i]?.numberRecordsFailed ?? j.numberRecordsFailed,
        numberRecordsProcessed: details[i]?.numberRecordsProcessed ?? j.numberRecordsProcessed,
      }));
    }

    if (flags.fields) {
      // One fieldset per load — the same object can be loaded with different field
      // sets in separate jobs, so do NOT dedup by object. One GET per eligible job.
      const eligible = result.filter(
        (j) => (j.apiVersion === 'v2' && j.state === 'JobComplete') || j.apiVersion === 'v1',
      );
      if (eligible.length > 0) {
        this.spinner.start(`Recovering upload fields for ${eligible.length} load(s)`);
        const fetched = await pooled(
          eligible.map((j) => async () => {
            try {
              return [j.id, await fetchUploadFields(conn, j.id, j.apiVersion)] as [string, string[]];
            } catch {
              return [j.id, [] as string[]] as [string, string[]];
            }
          }),
          10,
        );
        this.spinner.stop();
        const byId = new Map(fetched);
        // Resolve lookup targets only for JSON output; one describe per object (cached).
        const resolveTargets = this.jsonEnabled();
        const cache = makeDescribeCache();
        result = await Promise.all(
          result.map(async (j) => {
            const headers = byId.get(j.id);
            if (!headers) return j;
            let classified = classifyUploadFields(headers);
            if (resolveTargets) classified = await resolveLookupTargets(conn, j.object, classified, cache);
            return { ...j, uploadFields: headers, uploadFieldsClassified: classified };
          }),
        );
      }
    }

    if (!this.jsonEnabled()) {
      if (result.length === 0) {
        this.log('No jobs match the specified filters.');
      } else {
        const rows = result.map((j) => ({
          date: j.createdDate?.slice(0, 10) ?? '',
          failed: j.numberRecordsFailed === undefined || j.numberRecordsFailed === null ? '—' : String(j.numberRecordsFailed),
          id: j.id,
          object: j.object,
          operation: j.operation,
          processed:
            j.numberRecordsProcessed === undefined || j.numberRecordsProcessed === null
              ? '—'
              : String(j.numberRecordsProcessed),
          state: j.state,
          type: j.apiVersion,
        }));

        if (flags['with-metrics']) {
          this.table({ columns: ['id', 'date', 'type', 'operation', 'object', 'state', 'failed', 'processed'], data: rows });
        } else {
          this.table({ columns: ['id', 'date', 'type', 'operation', 'object', 'state'], data: rows });
        }

        const failedWithError = result.filter((j) => j.state === 'Failed' && j.errorMessage);
        if (failedWithError.length > 0) {
          this.log('\n--- Failed Job Errors ---');
          for (const j of failedWithError) {
            this.log(`  ${j.id}: ${j.errorMessage}`);
          }
        }

        if (flags.fields) this.logUploadFields(result);
      }

      this.log(`\n${result.length} job(s)${all.length === result.length ? '' : ` (${all.length - result.length} filtered out)`}`);
    }

    return result;
  }

  private logUploadFields(result: BulkJobInfo[]): void {
    this.log('\n--- Upload Fields (by load) ---');
    const withFields = result.filter((j) => j.uploadFields);
    if (withFields.length === 0) {
      this.log('  No eligible jobs to recover fields from (v2 needs JobComplete).');
      return;
    }

    for (const j of withFields) {
      this.log(`\n${j.id}  ${j.object}  (${j.apiVersion}, ${j.state})`);
      for (const line of formatUploadFields(j.uploadFieldsClassified!)) this.log(line);
    }
  }
}
