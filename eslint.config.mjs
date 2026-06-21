import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath),
  ...oclif,
  prettier,
  // --- Project-specific rule overrides (convention-conflicting / runtime-required) ---
  {
    rules: {
      // These loops are deliberately sequential: ordered file reads, NDJSON stream
      // paging, locator-based Bulk v2 paging, and a worker draining a shared queue.
      // Parallelizing would change behavior, so the sequential await is intentional.
      'no-await-in-loop': 'off',
      // Source files use an established camelCase naming convention (bulkApiClient.ts,
      // schemaResolver.ts, uploadFields.ts, ...). Renaming to kebab-case would ripple
      // through every import and risk oclif command resolution.
      'unicorn/filename-case': 'off',
    },
  },
  {
    // bulkApiClient.ts relies on fetch / TextDecoder / ReadableStream globals that the
    // plugin already ships against at runtime; engines must not be bumped to satisfy this.
    files: ['src/lib/bulkApiClient.ts'],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
  {
    // Test fixtures use real Salesforce field API names (MM_Member_Id__c, etc.) which
    // must stay verbatim, and multiple describe() blocks per file is conventional here.
    files: ['test/**'],
    rules: {
      camelcase: 'off',
      'mocha/max-top-level-suites': 'off',
    },
  },
]
