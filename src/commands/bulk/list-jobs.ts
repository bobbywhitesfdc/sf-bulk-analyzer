import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { BulkJobInfo, getJobInfo, listJobs } from '../../lib/bulkApiClient.js';

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
      }));
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
      }
      this.log(`\n${result.length} job(s)${all.length !== result.length ? ` (${all.length - result.length} filtered out)` : ''}`);
    }

    return result;
  }
}
