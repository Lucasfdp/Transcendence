#!/bin/sh
# check-tournament-contracts.sh — structural drift check between the backend
# Tournament contracts file and its conscious frontend mirror (SPEC-037).
#
# Compares, between the two files:
#   1. Exported declaration names (const / type / interface / enum),
#      including `export type { ... }` re-exports.
#   2. WS wire event literals ("tournament:...").
#   3. Canonical PascalCase string literals (SPEC-004 lobby event names and
#      SPEC-022 intent names inside the string-literal unions).
#
# Usage:
#   scripts/check-tournament-contracts.sh
#
# Exits 0 when the contract surfaces match; exits 1 and prints the drift
# otherwise. Dependency-free: POSIX sh + grep/sed/sort/diff only.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACK="$ROOT/backend/src/modules/tournaments/tournaments.contracts.ts"
FRONT="$ROOT/frontend/src/features/tournaments/contracts.ts"

for f in "$BACK" "$FRONT"; do
	if [ ! -f "$f" ]; then
		echo "ERROR: contract file not found: $f" >&2
		exit 1
	fi
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Lines of actual code: drop comment lines and import/re-export sources so
# header prose and module paths never count as contract surface.
code_lines() {
	grep -vE '^[[:space:]]*(\*|//|/\*)' "$1" | grep -v 'from "'
}

# 1. Exported declaration names, one "<kind> <Name>" per line.
extract_exports() {
	# Re-export form: `export type { A, B };` → "type A", "type B".
	sed -n 's/^export type {\([^}]*\)}.*/\1/p' "$1" \
		| tr ',' '\n' | sed 's/[[:space:]]//g; /^$/d; s/^/type /'
	# Direct declarations: `export <kind> <Name> ...`.
	grep -E '^export (const|type|interface|enum) [A-Za-z0-9_]+' "$1" \
		| sed -E 's/^export (const|type|interface|enum) ([A-Za-z0-9_]+).*/\1 \2/'
}

# 2. WS wire event names.
extract_ws_events() {
	code_lines "$1" | grep -oE '"tournament:[a-z0-9-]+"'
}

# 3. Canonical PascalCase literals (lobby event names, intent names).
extract_canonical_names() {
	code_lines "$1" | grep -oE '"[A-Z][A-Za-z]+"'
}

fail=0

check() {
	label="$1"
	extractor="$2"
	"$extractor" "$BACK" | sort -u >"$WORK/back"
	"$extractor" "$FRONT" | sort -u >"$WORK/front"
	if ! diff -u "$WORK/back" "$WORK/front" >"$WORK/diff" 2>&1; then
		echo "DRIFT in $label (-backend / +frontend):"
		grep -E '^[+-][^+-]' "$WORK/diff" | sed 's/^/  /'
		fail=1
	fi
}

check "exported declarations" extract_exports
check "WS event names" extract_ws_events
check "canonical event/intent names" extract_canonical_names

if [ "$fail" -ne 0 ]; then
	echo "FAIL: tournament contracts drifted — update both files in the same task:"
	echo "  $BACK"
	echo "  $FRONT"
	exit 1
fi

echo "OK: tournament contracts in sync (exports, WS events, canonical names)."
