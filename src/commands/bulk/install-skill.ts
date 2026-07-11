import { SfCommand } from '@salesforce/sf-plugins-core';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DEST = join(homedir(), '.claude', 'skills', 'sf-bulk-analyzer');

export default class BulkInstallSkill extends SfCommand<{ installed: string }> {
  public static readonly deprecationOptions = {
    message:
      'sf bulk install-skill is deprecated. sf-bulk-analyzer now ships as a Claude Code plugin — ' +
      'install it via the Claude Code /plugin command instead of copying the skill into ~/.claude/skills. ' +
      'If you ran this command before, remove ~/.claude/skills/sf-bulk-analyzer to avoid a stale copy ' +
      'shadowing the plugin version.',
  };
  public static readonly description =
    'Copies the bundled SKILL.md to ~/.claude/skills/sf-bulk-analyzer/ so Claude Code can use it as a skill.';
public static readonly examples = ['$ sf bulk install-skill'];
  public static readonly state = 'deprecated';
  public static readonly summary =
    '[DEPRECATED] Install the sf-bulk-analyzer Claude Code skill to ~/.claude/skills/.';

  public async run(): Promise<{ installed: string }> {
    // Resolve the skill source relative to this package's installed location.
    const pkgRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
    const skillSrc = join(pkgRoot, 'skills', 'sf-bulk-analyzer', 'SKILL.md');

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
