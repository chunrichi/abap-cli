#!/usr/bin/env bash
# Refresh vendored AFF schemas in src/abap_cli/schema/ from the SAP
# upstream repo. Only copies schemas consumed by the abap-cli codebase
# (derived from src/abap_cli/aff/router.ts), keeping the vendor minimal.
#
# Usage:
#   bash scripts/sync-aff-schema.sh                 # pull latest main
#   bash scripts/sync-aff-schema.sh <sha>           # pin to a commit
#
# After running, review the diff and commit — every SAP schema bump
# becomes an explicit, reviewable PR.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${UPSTREAM:-https://github.com/SAP/abap-file-formats.git}"
WORK="$(mktemp -d)"
trap "rm -rf $WORK" EXIT

REF="${1:-main}"

echo ">> Cloning $UPSTREAM into $WORK"
git clone --quiet "$UPSTREAM" "$WORK/upstream" \
  || { echo "Clone failed; check network."; exit 1; }

# REF is either a branch name (fetch shallow) or a 40-char SHA (deepen + checkout).
if [[ "$REF" =~ ^[0-9a-f]{40}$ ]]; then
  echo ">> Fetching SHA $REF"
  git -C "$WORK/upstream" fetch --quiet --depth 1 origin "$REF" \
    || { echo "Fetch SHA failed."; exit 1; }
  git -C "$WORK/upstream" checkout --quiet FETCH_HEAD
else
  git -C "$WORK/upstream" checkout --quiet "$REF"
fi

SHA="$(git -C "$WORK/upstream" rev-parse HEAD)"
echo ">> Upstream HEAD: $SHA"

VENDOR="$ROOT/src/abap_cli/schema"

# Files to copy: one per router.ts type, plus the TABL settings schema.
# Keep this list in sync with SUFFIX_RULES in src/abap_cli/aff/router.ts.
FILES=(
  "clas/clas-v1.json"
  "intf/intf-v1.json"
  "prog/prog-v1.json"
  "fugr/fugr-v1.json"
  "tabl/tabl-v1.json"
  "tabl/tabt-v1.json"
  "doma/doma-v1.json"
  "dtel/dtel-v1.json"
  "http/http-v1.json"
  "tran/tran-v1.json"
)

echo ">> Copying ${#FILES[@]} schema files"
for rel in "${FILES[@]}"; do
  src="$WORK/upstream/file-formats/$rel"
  dst="$VENDOR/$(basename "$rel")"
  if [[ ! -f "$src" ]]; then
    echo "   MISSING in upstream: $rel"
    exit 1
  fi
  cp "$src" "$dst"
done

# Refresh upstream LICENSE (MIT, must be retained per its terms).
cp "$WORK/upstream/LICENSE" "$VENDOR/LICENSE"

# Rewrite the commit reference in README.md.
python3 - "$VENDOR/README.md" "$SHA" <<'PY'
import sys, pathlib
path, sha = sys.argv[1], sys.argv[2]
text = pathlib.Path(path).read_text()
import re
new = re.sub(r"commit `[0-9a-f]{40}`", f"commit `{sha}`", text, count=1)
pathlib.Path(path).write_text(new)
PY

echo ">> Done. Vendor updated to upstream @$SHA."
echo "   Review changes and commit."
