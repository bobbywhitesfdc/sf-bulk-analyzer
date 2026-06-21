import { load as loadYaml } from 'js-yaml';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ClassifierPattern {
  match?: string;
  signature: string;
}

export interface ClassifierEntry {
  code: string;
  patterns: ClassifierPattern[];
}

interface ClassifiersFile {
  classifiers: ClassifierEntry[];
}

const USER_FILE = join(homedir(), '.sf-bulk-analyzer', 'classifiers.yaml');

function loadFile(path: string): ClassifierEntry[] {
  const raw = loadYaml(readFileSync(path, 'utf8')) as ClassifiersFile;
  return raw?.classifiers ?? [];
}

function bundledPath(): string {
  const pkgRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
  return join(pkgRoot, 'classifiers.yaml');
}

export function loadClassifiers(explicitPath?: string): ClassifierEntry[] {
  const defaults = loadFile(bundledPath());

  const userPath = explicitPath ?? (existsSync(USER_FILE) ? USER_FILE : undefined);
  if (!userPath) return defaults;

  const userEntries = loadFile(userPath);
  return merge(defaults, userEntries);
}

function merge(defaults: ClassifierEntry[], overrides: ClassifierEntry[]): ClassifierEntry[] {
  const byCode = new Map(defaults.map((e) => [e.code, e]));

  for (const entry of overrides) {
    byCode.set(entry.code, entry);
  }

  // Ensure UNKNOWN is always last.
  const unknown = byCode.get('UNKNOWN');
  byCode.delete('UNKNOWN');
  const result = [...byCode.values()];
  if (unknown) result.push(unknown);
  return result;
}
