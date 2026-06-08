import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { listJobs } from '../../lib/bulkApiClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);

export default class BulkListJobs extends SfCommand<object[]> {
  public static readonly summary = 'List Bulk API v2 ingest jobs for an org.';

  public static readonly examples = [
    '$ sf bulk list-jobs --target-org myorg',
    '$ sf bulk list-jobs --target-org myorg --json',
  ];

  public static readonly flags = {
    'target-org': Flags.requiredOrg({ summary: 'Org alias or username.', char: 'o' }),
  };

  public async run(): Promise<object[]> {
    const { flags } = await this.parse(BulkListJobs);
    const conn = flags['target-org'].getConnection();

    this.spinner.start('Fetching jobs');
    const jobs = await listJobs(conn);
    this.spinner.stop(`${jobs.length} jobs`);

    if (!this.jsonEnabled()) {
      this.table({
        data: jobs.map((j) => ({
          id: j.id,
          object: j.object,
          state: j.state,
          failed: String(j.numberRecordsFailed),
          processed: String(j.numberRecordsProcessed),
        })),
        columns: ['id', 'object', 'state', 'failed', 'processed'],
      });
    }

    return jobs;
  }
}
