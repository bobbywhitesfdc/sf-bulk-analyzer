import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { BulkJobInfo, fetchUploadFields, getJobInfo, listJobs } from '../../lib/bulkApiClient.js';
import { pooled } from '../../lib/pool.js';
import { classifyUploadFields, formatUploadFields } from '../../lib/uploadFields.js';
import { makeDescribeCache, resolveLookupTargets } from '../../lib/schemaResolver.js';

const QUERY_OPERATIONS = new Set(['query', 'queryall']);

export default class BulkListJobs extends SfCommand<BulkJobInfo[]> {
  public static readonly summary = 'List Bulk API jobs for an org.';
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
    'target-org': Flags.requiredOrg({ summary: 'Org alias or username.', char: 'o' }),
    object: Flags.string({
      summary: 'Filter by Salesforce object name (case-insensitive).',
      char: 'b',
    }),
    'job-type': Flags.option({
      summary: 'Filter by API version.',
      options: ['v1', 'v2'] as const,
    })(),
    state: Flags.string({
      summary: 'Filter by job state (e.g. JobComplete, Failed, Closed).',
      char: 's',
    }),
    'all-operations': Flags.boolean({
      summary: 'Include query and queryAll jobs (excluded by default).',
      default: false,
    }),
    'with-metrics': Flags.boolean({
      summary: 'Fetch processed/failed record counts for each job (one extra API call per job).',
      default: false,
    }),
    fields: Flags.boolean({
      summary: 'Recover the upload field list per load (Bulk v1, and v2 JobComplete jobs).',
      default: false,
    }),
  };

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
        numberRecordsFailed: details[i]?.numberRecordsFailed ?? j.numberRecordsFailed,
        numberRecordsProcessed: details[i]?.numberRecordsProcessed ?? j.numberRecordsProcessed,
        errorMessage: details[i]?.errorMessage ?? j.errorMessage,
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
          id: j.id,
          date: j.createdDate?.slice(0, 10) ?? '',
          type: j.apiVersion,
          operation: j.operation,
          object: j.object,
          state: j.state,
          failed: j.numberRecordsFailed != null ? String(j.numberRecordsFailed) : '—',
          processed: j.numberRecordsProcessed != null ? String(j.numberRecordsProcessed) : '—',
        }));

        if (flags['with-metrics']) {
          this.table({ data: rows, columns: ['id', 'date', 'type', 'operation', 'object', 'state', 'failed', 'processed'] });
        } else {
          this.table({ data: rows, columns: ['id', 'date', 'type', 'operation', 'object', 'state'] });
        }

        const failedWithError = result.filter((j) => j.state === 'Failed' && j.errorMessage);
        if (failedWithError.length > 0) {
          this.log('\n--- Failed Job Errors ---');
          for (const j of failedWithError) {
            this.log(`  ${j.id}: ${j.errorMessage}`);
          }
        }

        if (flags.fields) {
          this.log('\n--- Upload Fields (by load) ---');
          const withFields = result.filter((j) => j.uploadFields);
          if (withFields.length === 0) {
            this.log('  No eligible jobs to recover fields from (v2 needs JobComplete).');
          } else {
            for (const j of withFields) {
              this.log(`\n${j.id}  ${j.object}  (${j.apiVersion}, ${j.state})`);
              for (const line of formatUploadFields(j.uploadFieldsClassified!)) this.log(line);
            }
          }
        }
      }
      this.log(`\n${result.length} job(s)${all.length !== result.length ? ` (${all.length - result.length} filtered out)` : ''}`);
    }

    return result;
  }
}
