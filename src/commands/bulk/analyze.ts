import { Args } from '@oclif/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { detectApiVersion, fetchFailures, fetchUploadFields, getJobInfo } from '../../lib/bulkApiClient.js';
import { loadClassifiers } from '../../lib/classifierLoader.js';
import { buildClassifier } from '../../lib/errorClassifier.js';
import { sample, shouldSample } from '../../lib/sampler.js';
import { resolveLookupTargets } from '../../lib/schemaResolver.js';
import { formatSummary, summarize } from '../../lib/summarizer.js';
import { classifyUploadFields, formatUploadFields } from '../../lib/uploadFields.js';

export default class BulkAnalyze extends SfCommand<object> {
  public static readonly args = {
    jobId: Args.string({ description: 'Bulk API job ID to analyze.', required: true }),
  };
  public static readonly description =
    'Fetches failed records for a Bulk API v1 or v2 job and summarizes errors by normalized signature.';
public static readonly examples = [
    '$ sf bulk analyze 750xx0000000001 --target-org myorg',
    '$ sf bulk analyze 750xx0000000001 --target-org myorg --fields',
    '$ sf bulk analyze 750xx0000000001 --target-org myorg --json',
    '$ sf bulk analyze 750xx0000000001 --target-org myorg --classifiers ./my-classifiers.yaml',
  ];
public static readonly flags = {
    classifiers: Flags.file({
      default: undefined,
      summary: 'Path to a custom classifiers YAML file.',
    }),
    concurrency: Flags.integer({
      default: 15,
      summary: 'Number of parallel batch workers for large jobs.',
    }),
    fields: Flags.boolean({
      default: false,
      summary: 'Inspect and show the upload field list for the job (Bulk v1 and v2).',
    }),
    'output-dir': Flags.directory({
      default: undefined,
      summary: 'Write analysis files to this directory.',
    }),
    'sample-size': Flags.integer({
      default: 500,
      summary: 'Max records to include in sample.',
    }),
    'sample-threshold': Flags.integer({
      default: 80,
      summary: 'Failure % of processed records that triggers sampling.',
    }),
    'target-org': Flags.requiredOrg({ char: 'o', summary: 'Org alias or username.' }),
  };
public static readonly summary = 'Analyze failures for a Bulk API job.';

  public async run(): Promise<object> {
    const { args, flags } = await this.parse(BulkAnalyze);
    const {jobId} = args;
    const conn = flags['target-org'].getConnection();
    const classifyError = buildClassifier(loadClassifiers(flags.classifiers));

    this.spinner.start(`Detecting API version for job ${jobId}`);
    const apiVersion = await detectApiVersion(conn, jobId);
    const jobInfo = await getJobInfo(conn, jobId, apiVersion);
    this.spinner.stop(`${apiVersion} — ${jobInfo.numberRecordsFailed} failures`);

    this.spinner.start('Fetching failure records');
    let records = await fetchFailures(conn, jobId, apiVersion, {
      concurrency: flags.concurrency,
      onProgress: (fetched) => {
        this.spinner.status = `${fetched} records fetched`;
      },
    });
    this.spinner.stop(`${records.length} records fetched`);

    const doSample = shouldSample(
      records.length,
      jobInfo.numberRecordsProcessed,
      flags['sample-threshold'],
      flags['sample-size'],
    );
    if (doSample) {
      records = sample(records, flags['sample-size']);
      this.warn(`Large failure set — analyzing stratified sample of ${records.length} records.`);
    }

    const summary = summarize(records, doSample, classifyError);

    let uploadFields: string[] | undefined;
    if (flags.fields) {
      try {
        this.spinner.start('Reverse engineering upload fields');
        uploadFields = await fetchUploadFields(conn, jobId, apiVersion);
        this.spinner.stop(`${uploadFields.length} field(s)`);
      } catch (error) {
        this.spinner.stop('failed');
        this.warn(`Could not reverse engineer upload fields: ${(error as Error).message}`);
      }
    }

    let uploadFieldsClassified = uploadFields ? classifyUploadFields(uploadFields) : undefined;
    // Resolve lookup targets only when the result is consumed as JSON (human output is bare).
    if (uploadFieldsClassified && this.jsonEnabled()) {
      uploadFieldsClassified = await resolveLookupTargets(conn, jobInfo.object, uploadFieldsClassified);
    }

    if (!this.jsonEnabled()) {
      this.log(formatSummary(summary, jobId, jobInfo));
      if (uploadFieldsClassified) {
        this.log('\n--- Upload Fields ---');
        for (const line of formatUploadFields(uploadFieldsClassified)) this.log(line);
      }
    }

    // eslint-disable-next-line perfectionist/sort-objects -- intentional output key order (job id first)
    return { jobId, apiVersion, jobInfo, summary, uploadFields, uploadFieldsClassified };
  }
}
