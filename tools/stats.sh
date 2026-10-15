#!/bin/bash
# Daily GitHub stats snapshot for the repo (read-only `gh api` calls; needs an authenticated gh CLI).
# Prints one CSV line: date,apk_downloads_total,clones_14d,clones_unique_14d,views_14d,views_unique_14d,stars,forks
# With --append DIR it also appends that line to DIR/stats.csv (header written once, same-day re-run replaces it) and merges GitHub's per-day
# clones/views (only the last 14 days are kept by GitHub) into DIR/traffic-daily.csv, one row per date; a date seen
# again is replaced by the newer numbers. Repo defaults to omarqaterge/hermes-mobile-app, override with HM_REPO.
# Usage: tools/stats.sh [--append DIR]
set -euo pipefail
REPO="${HM_REPO:-omarqaterge/hermes-mobile-app}"
DIR=""
case "${1:-}" in
  --append) DIR="${2:?usage: tools/stats.sh [--append DIR]}" ;;
  "") ;;
  *) echo "usage: tools/stats.sh [--append DIR]" >&2; exit 2 ;;
esac

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
downloads=$(gh api --paginate "repos/$REPO/releases" --jq '.[].assets[].download_count' | awk '{s+=$1} END {print s+0}')
repo=$(gh api "repos/$REPO" --jq '"\(.stargazers_count),\(.forks_count)"')
clones=$(gh api "repos/$REPO/traffic/clones" --jq '"\(.count),\(.uniques)"')
views=$(gh api "repos/$REPO/traffic/views" --jq '"\(.count),\(.uniques)"')
today=$(date +%Y-%m-%d)
line="$today,$downloads,$clones,$views,$repo"
echo "$line"

[ -n "$DIR" ] || exit 0
mkdir -p "$DIR"
STATS="$DIR/stats.csv"
[ -s "$STATS" ] || echo "date,apk_downloads_total,clones_14d,clones_unique_14d,views_14d,views_unique_14d,stars,forks" > "$STATS"
grep -v "^$today," "$STATS" > "$TMP/stats" || true   # a second run on the same day replaces its line
{ cat "$TMP/stats"; echo "$line"; } > "$STATS.tmp" && mv "$STATS.tmp" "$STATS"

# Per-day traffic: "C date count uniques" / "V date count uniques", merged with the existing file by date.
DAILY="$DIR/traffic-daily.csv"
gh api "repos/$REPO/traffic/clones" --jq '.clones[] | "C \(.timestamp[0:10]) \(.count) \(.uniques)"' > "$TMP/new"
gh api "repos/$REPO/traffic/views" --jq '.views[] | "V \(.timestamp[0:10]) \(.count) \(.uniques)"' >> "$TMP/new"
touch "$DAILY"
awk -F, -v OFS=, -v old="$DAILY" '
  FILENAME == old { if ($1 != "date") { c[$1]=$2; cu[$1]=$3; v[$1]=$4; vu[$1]=$5; d[$1]=1 } next }
  { split($0, f, " ") }
  f[1] == "C" { c[f[2]]=f[3]; cu[f[2]]=f[4]; d[f[2]]=1 }
  f[1] == "V" { v[f[2]]=f[3]; vu[f[2]]=f[4]; d[f[2]]=1 }
  END { for (k in d) print k, c[k]+0, cu[k]+0, v[k]+0, vu[k]+0 }
' "$DAILY" "$TMP/new" | sort > "$TMP/merged"
{ echo "date,clones,clones_unique,views,views_unique"; cat "$TMP/merged"; } > "$DAILY.tmp"
mv "$DAILY.tmp" "$DAILY"
