sf-bulk-analyzer
=================

Analyze Bulk API V2 and V1 jobs for errors


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/sf-bulk-analyzer.svg)](https://npmjs.org/package/sf-bulk-analyzer)
[![Downloads/week](https://img.shields.io/npm/dw/sf-bulk-analyzer.svg)](https://npmjs.org/package/sf-bulk-analyzer)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g sf-bulk-analyzer
$ sf-bulk-analyzer COMMAND
running command...
$ sf-bulk-analyzer (--version)
sf-bulk-analyzer/0.1.0 darwin-arm64 node-v25.8.1
$ sf-bulk-analyzer --help [COMMAND]
USAGE
  $ sf-bulk-analyzer COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`sf-bulk-analyzer bulk analyze JOBID`](#sf-bulk-analyzer-bulk-analyze-jobid)
* [`sf-bulk-analyzer bulk analyze-files DIR`](#sf-bulk-analyzer-bulk-analyze-files-dir)
* [`sf-bulk-analyzer bulk install-skill`](#sf-bulk-analyzer-bulk-install-skill)
* [`sf-bulk-analyzer bulk list-jobs`](#sf-bulk-analyzer-bulk-list-jobs)
* [`sf-bulk-analyzer help [COMMAND]`](#sf-bulk-analyzer-help-command)
* [`sf-bulk-analyzer plugins`](#sf-bulk-analyzer-plugins)
* [`sf-bulk-analyzer plugins add PLUGIN`](#sf-bulk-analyzer-plugins-add-plugin)
* [`sf-bulk-analyzer plugins:inspect PLUGIN...`](#sf-bulk-analyzer-pluginsinspect-plugin)
* [`sf-bulk-analyzer plugins install PLUGIN`](#sf-bulk-analyzer-plugins-install-plugin)
* [`sf-bulk-analyzer plugins link PATH`](#sf-bulk-analyzer-plugins-link-path)
* [`sf-bulk-analyzer plugins remove [PLUGIN]`](#sf-bulk-analyzer-plugins-remove-plugin)
* [`sf-bulk-analyzer plugins reset`](#sf-bulk-analyzer-plugins-reset)
* [`sf-bulk-analyzer plugins uninstall [PLUGIN]`](#sf-bulk-analyzer-plugins-uninstall-plugin)
* [`sf-bulk-analyzer plugins unlink [PLUGIN]`](#sf-bulk-analyzer-plugins-unlink-plugin)
* [`sf-bulk-analyzer plugins update`](#sf-bulk-analyzer-plugins-update)

## `sf-bulk-analyzer bulk analyze JOBID`

Analyze failures for a Bulk API job.

```
USAGE
  $ sf-bulk-analyzer bulk analyze JOBID -o <value> [--json] [--flags-dir <value>] [--output-dir <value>]
    [--sample-size <value>] [--sample-threshold <value>] [--classifiers <value>]

ARGUMENTS
  JOBID  Bulk API job ID to analyze.

FLAGS
  -o, --target-org=<value>        (required) Org alias or username.
      --classifiers=<value>       Path to a custom classifiers YAML file.
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

  $ sf bulk analyze 750xx0000000001 --target-org myorg --json

  $ sf bulk analyze 750xx0000000001 --target-org myorg --classifiers ./my-classifiers.yaml
```

_See code: [src/commands/bulk/analyze.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.0/src/commands/bulk/analyze.ts)_

## `sf-bulk-analyzer bulk analyze-files DIR`

Analyze locally downloaded Bulk API failure CSVs without an org connection.

```
USAGE
  $ sf-bulk-analyzer bulk analyze-files DIR [--json] [--flags-dir <value>] [--sample-size <value>] [--sample-threshold
    <value>] [--classifiers <value>]

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

_See code: [src/commands/bulk/analyze-files.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.0/src/commands/bulk/analyze-files.ts)_

## `sf-bulk-analyzer bulk install-skill`

Install the sf-bulk-analyzer Claude Code skill to ~/.claude/skills/.

```
USAGE
  $ sf-bulk-analyzer bulk install-skill [--json] [--flags-dir <value>]

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Install the sf-bulk-analyzer Claude Code skill to ~/.claude/skills/.

  Copies the bundled SKILL.md to ~/.claude/skills/sf-bulk-analyzer/ so Claude Code can use it as a skill.

EXAMPLES
  $ sf bulk install-skill
```

_See code: [src/commands/bulk/install-skill.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.0/src/commands/bulk/install-skill.ts)_

## `sf-bulk-analyzer bulk list-jobs`

List Bulk API jobs for an org.

```
USAGE
  $ sf-bulk-analyzer bulk list-jobs -o <value> [--json] [--flags-dir <value>] [-b <value>] [--job-type v1|v2] [-s
    <value>] [--all-operations] [--with-metrics]

FLAGS
  -b, --object=<value>      Filter by Salesforce object name (case-insensitive).
  -o, --target-org=<value>  (required) Org alias or username.
  -s, --state=<value>       Filter by job state (e.g. JobComplete, Failed, Closed).
      --all-operations      Include query and queryAll jobs (excluded by default).
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

  $ sf bulk list-jobs --target-org myorg --json
```

_See code: [src/commands/bulk/list-jobs.ts](https://github.com/bobbywhitesfdc/sf-bulk-analyzer/blob/v0.1.0/src/commands/bulk/list-jobs.ts)_

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

## `sf-bulk-analyzer plugins`

List installed plugins.

```
USAGE
  $ sf-bulk-analyzer plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ sf-bulk-analyzer plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.72/src/commands/plugins/index.ts)_

## `sf-bulk-analyzer plugins add PLUGIN`

Installs a plugin into sf-bulk-analyzer.

```
USAGE
  $ sf-bulk-analyzer plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into sf-bulk-analyzer.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SF_BULK_ANALYZER_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SF_BULK_ANALYZER_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ sf-bulk-analyzer plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ sf-bulk-analyzer plugins add myplugin

  Install a plugin from a github url.

    $ sf-bulk-analyzer plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ sf-bulk-analyzer plugins add someuser/someplugin
```

## `sf-bulk-analyzer plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ sf-bulk-analyzer plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ sf-bulk-analyzer plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.72/src/commands/plugins/inspect.ts)_

## `sf-bulk-analyzer plugins install PLUGIN`

Installs a plugin into sf-bulk-analyzer.

```
USAGE
  $ sf-bulk-analyzer plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into sf-bulk-analyzer.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SF_BULK_ANALYZER_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SF_BULK_ANALYZER_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ sf-bulk-analyzer plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ sf-bulk-analyzer plugins install myplugin

  Install a plugin from a github url.

    $ sf-bulk-analyzer plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ sf-bulk-analyzer plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.72/src/commands/plugins/install.ts)_

## `sf-bulk-analyzer plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ sf-bulk-analyzer plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ sf-bulk-analyzer plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.72/src/commands/plugins/link.ts)_

## `sf-bulk-analyzer plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sf-bulk-analyzer plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sf-bulk-analyzer plugins unlink
  $ sf-bulk-analyzer plugins remove

EXAMPLES
  $ sf-bulk-analyzer plugins remove myplugin
```

## `sf-bulk-analyzer plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ sf-bulk-analyzer plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.72/src/commands/plugins/reset.ts)_

## `sf-bulk-analyzer plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sf-bulk-analyzer plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sf-bulk-analyzer plugins unlink
  $ sf-bulk-analyzer plugins remove

EXAMPLES
  $ sf-bulk-analyzer plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.72/src/commands/plugins/uninstall.ts)_

## `sf-bulk-analyzer plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sf-bulk-analyzer plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sf-bulk-analyzer plugins unlink
  $ sf-bulk-analyzer plugins remove

EXAMPLES
  $ sf-bulk-analyzer plugins unlink myplugin
```

## `sf-bulk-analyzer plugins update`

Update installed plugins.

```
USAGE
  $ sf-bulk-analyzer plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.72/src/commands/plugins/update.ts)_
<!-- commandsstop -->
