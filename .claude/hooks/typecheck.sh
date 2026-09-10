#!/usr/bin/env bash
# PostToolUse (Write|Edit): project-wide `tsc --noEmit` after a TS/Astro edit.
# exit 0 = types OK / not a TS file ; exit 2 = type errors the agent must fix.
#
# tsc has no reliable single-file mode (it would ignore tsconfig), so this
# checks the whole project. It adds a few seconds per edit. If that gets too
# slow, delete this hook's block from .claude/settings.json and rely on the
# pre-commit + CI typecheck instead (see .husky/pre-commit).
source "$(dirname "$0")/_shared.sh"

case "$REL" in
  *.ts | *.tsx | *.astro) ;;
  *) exit 0 ;;
esac

if OUT="$(npx tsc --noEmit 2>&1)"; then
  exit 0
fi

printf '%s\n' "$OUT" | grep -E 'error TS' >&2 || printf '%s\n' "$OUT" >&2
echo "" >&2
echo "\`tsc --noEmit\` failed after editing $REL — fix the type errors above." >&2
exit 2
