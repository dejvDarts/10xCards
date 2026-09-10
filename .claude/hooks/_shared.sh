#!/usr/bin/env bash
# Shared helpers for Claude Code PostToolUse hooks.
#
# NOTE: `jq` is not available in this project's shell (Git Bash on Windows), so
# the hook stdin JSON is parsed with `node` instead of `jq -r .tool_input.file_path`.
set -uo pipefail

# Move to the repo root; Claude Code exports CLAUDE_PROJECT_DIR for hooks.
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# Read the whole hook payload from stdin once.
PAYLOAD="$(cat)"

# Edited file path, normalised to a repo-relative POSIX path (e.g. src/foo.ts).
# node's path.relative handles Windows drive-letter case and mixed separators
# that a plain shell prefix-strip gets wrong.
# tool_input.file_path is the Claude Code field; tool_input.filePath is the
# VS Code Copilot spelling, kept as a fallback.
REL="$(
  printf '%s' "$PAYLOAD" | node -e "
    const path = require('path');
    let s = '';
    try { s = require('fs').readFileSync(0, 'utf8'); } catch (e) {}
    let o = {};
    try { o = JSON.parse(s); } catch (e) {}
    const ti = o.tool_input || {};
    const abs = ti.file_path || ti.filePath || '';
    if (!abs) { process.exit(0); }
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    process.stdout.write(path.relative(root, abs).split(path.sep).join('/'));
  "
)"

# FILE kept as an alias for readability in the hook scripts.
FILE="$REL"
