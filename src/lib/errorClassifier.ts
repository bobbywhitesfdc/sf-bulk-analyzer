import { ClassifierEntry } from './classifierLoader.js';

export function buildClassifier(entries: ClassifierEntry[]): (rawError: string) => string {
  const compiled = entries.map((entry) => ({
    code: entry.code,
    patterns: entry.patterns.map((p) => ({
      regex: p.match ? new RegExp(p.match) : null,
      signature: p.signature,
    })),
  }));

  return (rawError: string): string => {
    if (!rawError) return 'UNKNOWN';

    for (const entry of compiled) {
      if (entry.code === 'UNKNOWN' || rawError.includes(entry.code)) {
        for (const { regex, signature } of entry.patterns) {
          if (!regex) return signature;
          const m = regex.exec(rawError);
          if (m) {
            return signature.replace(/\{(\d+)\}/g, (_, i) => m[Number(i)] ?? '');
          }
        }
      }
    }

    return 'UNKNOWN';
  };
}
