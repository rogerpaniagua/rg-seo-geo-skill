#!/bin/bash
# Shallow-clones the projects listed in test/source-corpus.txt into a folder (default: ./source-corpus) so that
#   node scripts/source-corpus.mjs ./source-corpus <name>=<subfolder> ...
# can review them. Cloning does not execute anything from the repositories, and the review only reads files.
set -u
DEST="${1:-./source-corpus}"
mkdir -p "$DEST" && cd "$DEST" || exit 1
export GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1
LIST="$(cd - >/dev/null && pwd)/test/source-corpus.txt"
grep -v '^#' "$LIST" | while IFS='|' read -r name repo sparse sub; do
  [ -z "$name" ] && continue
  [ -d "$name" ] && { echo "skip $name (exists)"; continue; }
  if [ -n "$sparse" ]; then
    git clone -q --depth 1 --filter=blob:none --sparse "https://github.com/$repo.git" "$name" && (cd "$name" && git sparse-checkout set $sparse) && echo "ok   $name" || echo "FAIL $name"
  else
    git clone -q --depth 1 "https://github.com/$repo.git" "$name" && echo "ok   $name" || echo "FAIL $name"
  fi
done
