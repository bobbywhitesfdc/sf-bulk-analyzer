import { Args } from '@oclif/core';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { detectApiVersion, fetchFailures, getJobInfo } from '../../lib/bulkApiClient.js';
import { loadClassifiers } from '../../lib/classifierLoader.js';
import { buildClassifier } from '../../lib/errorClassifier.js';
import { shouldSample, sample } from '../../lib/sampler.js';
import { summarize, formatSummary } from '../../lib/summarizer.js';

export default class BulkAnalyze extends SfCommand<object> {
  public static readonly summary = 'Analyze failures for a Bulk API job.';
  public static readonly description =
    'Fetches failed records for a Bulk API v1 or v2 job and summarizes errors by normalized signature.';

  public static readonly examples = [
    '$ sf bulk analyze 750xx0000000001 --target-org myorg',
    '$ sf bulk analyze 750xx0000000001 --target-org myorg --json',
    '$ sf bulk analyze 750xx0000000001 --target-org myorg --classifiers ./my-classifiers.yaml',
  ];

  public static readonly flags = {
    'target-org': Flags.requiredOrg({ summary: 'Org alias or username.', char: 'o' }),
    'output-dir': Flags.directory({
      summary: 'Write analysis files to this directory.',
      default: undefined,
    }),
    'sample-size': Flags.integer({
      summary: 'Max records to include in sample.',
      default: 500,
    }),
    'sample-threshold': Flags.integer({
      summary: 'Failure % of processed records that triggers sampling.',
      default: 80,
    }),
    classifiers: Flags.file({
      summary: 'Path to a custom classifiers YAML file.',
      default: undefined,
    }),
  };

  public static readonly args = {
    jobId: Args.string({ description: 'Bulk API job ID to analyze.', required: true }),
  };

  public async run(): Promise<object> {
    const { args, flags } = await this.parse(BulkAnalyze);
    const jobId = args.jobId;
    const conn = flags['target-org'].getConnection();
    const classifyError = buildClassifier(loadClassifiers(flags.classifiers));

    this.spinner.start(`Detecting API version for job ${jobId}`);
    const apiVersion = await detectApiVersion(conn, jobId);
    const jobInfo = await getJobInfo(conn, jobId, apiVersion);
    this.spinner.stop(`${apiVersion} — ${jobInfo.numberRecordsFailed} failures`);

    this.spinner.start('Fetching failure records');
    let records = await fetchFailures(conn, jobId, apiVersion);
    this.spinner.stop(`${records.length} records fetched`);

    const doSample = shouldSample(
      records.length,
      jobInfo.numberRecordsProcessed,
      flags['sample-threshold'],
    );
    if (doSample) {
      records = sample(records, flags['sample-size']);
      this.warn(`Large failure set — analyzing stratified sample of ${records.length} records.`);
    }

    const summary = summarize(records, doSample, classifyError);

    if (!this.jsonEnabled()) {
      this.log(formatSummary(summary, jobId));
    }

    return { jobId, apiVersion, jobInfo, summary };
  }
}
