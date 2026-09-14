// Links .claude/skills at the tracked skill sources in .agents/skills, and keeps
// AGENTS.md as the single agent instructions file.
//
// The link itself is untracked: git on Windows defaults to core.symlinks=false, so
// a tracked symlink gets checked out as a plain text file holding the target path,
// which clobbers the link in every clone and worktree. Recreating it on
// postinstall keeps one copy of the skills in git and a working link everywhere.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..");
const agentsSkills = join(repoRoot, ".agents", "skills");
const claudeDir = join(repoRoot, ".claude");
const link = join(claudeDir, "skills");
const target = join("..", ".agents", "skills");

// Claude Code reads CLAUDE.md, other agents read AGENTS.md. The stub imports the
// shared file so both stay in sync without a file symlink.
const claudeStub = "@AGENTS.md\n";

try {
  mkdirSync(agentsSkills, { recursive: true });
  // .claude holds no tracked files, so a fresh checkout does not create it.
  mkdirSync(claudeDir, { recursive: true });

  // lstat rather than existsSync so a dangling link is caught too.
  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing?.isDirectory() && !existing.isSymbolicLink()) {
    // A real directory is an older checkout or a tool that wrote skills in place.
    // Move anything not already in .agents/skills before replacing it, so no
    // local skill is lost.
    for (const name of readdirSync(link)) {
      const destination = join(agentsSkills, name);
      if (!existsSync(destination)) {
        cpSync(join(link, name), destination, { recursive: true });
      }
    }
  }
  // Clears a stale link, an older clone's checked-out text file, or the migrated
  // directory.
  if (existing) {
    rmSync(link, { force: true, recursive: true });
  }

  // 'junction' applies on Windows only, where it avoids the admin rights a real
  // symlink needs. Elsewhere it is ignored and this is a relative symlink.
  symlinkSync(target, link, "junction");
} catch (error) {
  // Never fail an install over a developer convenience. Some filesystems refuse
  // links outright; the repo still works, the project skills just will not load.
  console.warn(
    `Could not link .claude/skills, run \`bun run link-skills\` to retry: ${error.message}`,
  );
}

try {
  const claudeMd = join(repoRoot, "CLAUDE.md");
  const agentsMd = join(repoRoot, "AGENTS.md");
  const claudeContent = existsSync(claudeMd) ? readFileSync(claudeMd, "utf8") : undefined;
  if (claudeContent !== undefined && claudeContent.trim() !== claudeStub.trim()) {
    if (existsSync(agentsMd)) {
      console.warn(
        "CLAUDE.md and AGENTS.md both have content, merge CLAUDE.md into AGENTS.md by hand.",
      );
    } else {
      renameSync(claudeMd, agentsMd);
      writeFileSync(claudeMd, claudeStub);
    }
  }
} catch (error) {
  console.warn(`Could not move CLAUDE.md to AGENTS.md: ${error.message}`);
}
