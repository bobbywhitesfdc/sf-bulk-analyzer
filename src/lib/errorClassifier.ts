// Ports the awk error-signature processors from analyze_bulk_job.sh.
// Philosophy: strip noise (IDs, emails, data values); keep error code + field + entity.

export function classifyError(rawError: string): string {
  if (!rawError) return 'UNKNOWN';

  if (rawError.includes('INVALID_EMAIL_ADDRESS')) return classifyInvalidEmail();
  if (rawError.includes('REQUIRED_FIELD_MISSING')) return classifyRequiredFieldMissing(rawError);
  if (rawError.includes('INVALID_FIELD')) return classifyInvalidField(rawError);
  if (rawError.includes('DUPLICATE_VALUE')) return classifyDuplicateValue(rawError);
  if (rawError.includes('INVALID_VALUE')) return classifyInvalidValue(rawError);
  if (rawError.includes('INVALID_REFERENCE')) return classifyInvalidReference(rawError);
  if (rawError.includes('FIELD_INTEGRITY_EXCEPTION')) return classifyFieldIntegrityException(rawError);

  return classifyUnknown(rawError);
}

function classifyInvalidEmail(): string {
  return 'INVALID_EMAIL_ADDRESS';
}

function classifyRequiredFieldMissing(msg: string): string {
  const match = /\[([^\]]+)\]/.exec(msg);
  const field = match ? match[1] : '?';
  return `REQUIRED_FIELD_MISSING [${field}]`;
}

function classifyInvalidField(msg: string): string {
  // Two branches: foreign key reference vs. invalid field name
  const fkMatch = /No such column '([^']+)' on sobject of type (\S+)/.exec(msg);
  if (fkMatch) return `INVALID_FIELD: no column '${fkMatch[1]}' on ${fkMatch[2]}`;

  const fieldMatch = /\[([^\]]+)\]/.exec(msg);
  const field = fieldMatch ? fieldMatch[1] : '?';
  return `INVALID_FIELD [${field}]`;
}

function classifyDuplicateValue(msg: string): string {
  const match = /\[([^\]]+)\]/.exec(msg);
  const field = match ? match[1] : '?';
  return `DUPLICATE_VALUE [${field}]`;
}

function classifyInvalidValue(msg: string): string {
  // Extract last colon-delimited segment before ` --`
  const beforeDash = msg.split(' --')[0];
  const segments = beforeDash.split(':');
  const segment = segments[segments.length - 1].trim();
  return `INVALID_VALUE: ${segment}`;
}

function classifyInvalidReference(msg: string): string {
  const match = /is invalid: (\S+)/.exec(msg);
  const field = match ? match[1] : '?';
  return `INVALID_REFERENCE: ${field}`;
}

function classifyFieldIntegrityException(msg: string): string {
  // Field name appears after the closing paren
  const match = /\)\s*(.+)$/.exec(msg);
  const field = match ? match[1].trim() : '?';
  return `FIELD_INTEGRITY_EXCEPTION: ${field}`;
}

function classifyUnknown(msg: string): string {
  // Scan for custom field/relationship tokens and "in entity" references
  const tokens: string[] = [];
  const customFieldMatches = msg.matchAll(/\b(\w+__(?:c|r))\b/g);
  for (const m of customFieldMatches) tokens.push(m[1]);

  const entityMatch = /in entity (\S+)/.exec(msg);
  if (entityMatch) tokens.push(`entity:${entityMatch[1]}`);

  return tokens.length > 0 ? `UNKNOWN: ${tokens.join(', ')}` : 'UNKNOWN';
}
