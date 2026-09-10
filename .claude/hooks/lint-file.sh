#!/usr/bin/env bash
# PostToolUse (Write|Edit): run ESLint --fix on just the edited file.
# exit 0 = clean / not lintable ; exit 2 = lint errors the agent must fix.
source "$(dirname "$0")/_shared.sh"

[ -n "$FILE" ] || exit 0

case "$REL" in
  *.ts | *.tsx | *.astro | *.js | *.jsx | *.mjs | *.cjs) ;;
  *) exit 0 ;;
esac
[ -f "$REL" ] || exit 0

# --fix silently repairs what it can; anything left is a real error (--quiet
# drops warnings so they never block). Send output to stderr so it reaches the
# agent on a blocking (exit 2) result.
if ! npx eslint --fix "$REL" --quiet 1>&2; then
  echo "" >&2
  echo "ESLint found unfixable errors in $REL — fix them before continuing." >&2
  exit 2
fi
