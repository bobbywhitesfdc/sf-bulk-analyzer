import { SfCommand } from '@salesforce/sf-plugins-core';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SKILL_DEST = join(homedir(), '.claude', 'skills', 'sf-bulk-analyzer');

export default class BulkInstallSkill extends SfCommand<{ installed: string }> {
  public static readonly summary = 'Install the sf-bulk-analyzer Claude Code skill to ~/.claude/skills/.';
  public static readonly description =
    'Copies the bundled SKILL.md to ~/.claude/skills/sf-bulk-analyzer/ so Claude Code can use it as a skill.';

  public static readonly examples = ['$ sf bulk install-skill'];

  public async run(): Promise<{ installed: string }> {
    // Resolve the skill source relative to this package's installed location.
    const pkgRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
    const skillSrc = join(pkgRoot, 'skill', 'SKILL.md');

    if (!existsSync(skillSrc)) {
      this.error(`Skill source not found at ${skillSrc} — is the package installed correctly?`);
    }

    await mkdir(SKILL_DEST, { recursive: true });
    const dest = join(SKILL_DEST, 'SKILL.md');
    await copyFile(skillSrc, dest);

    this.log(`Skill installed to ${dest}`);
    this.log('Restart Claude Code (or reload skills) to activate.');

    return { installed: dest };
  }
}
