#!/usr/bin/env bash
# skein brief <TASK> [--check | --new]
#   --check  validate the brief against its task in the plan (default)
#   --new    scaffold docs/plan/briefs/<TASK>.md from the template for the coordinator to fill
# The /skein-brief skill is what writes a brief; this command only validates or scaffolds.
. "$SKEIN_HOME/lib/common.sh"
require_config
TASK="${1:-}"; MODE="${2:---check}"
[ -n "$TASK" ] || die "usage: skein brief <TASK> [--check|--new]"
t="$(task_json "$TASK")"; ID="$(jq -r .id <<<"$t")"
case "$MODE" in
  --check) exec node "$SKEIN_HOME/lib/plan.mjs" --check "$ID" ;;
  --new)
    out="$BRIEFS/$ID.md"; mkdir -p "$BRIEFS"
    [ -e "$out" ] && die "$out already exists"
    node "$SKEIN_HOME/lib/render.mjs" "$SKEIN_HOME/templates/brief.md.tmpl" "$out" \
      ID="$ID" TITLE="$(task_field "$t" title)" OWNED="$(jq -r '.owned[] | "- `\(.)`"' <<<"$t")" \
      ACCEPT="$(jq -r '.accept[] | "- `\(.)`"' <<<"$t")" GATE="$(cfg .gate 'scripts/skein/skein gate')" NAME="$(cfg .name)"
    log "scaffolded $out; fill Objective, Read first, Hard rules and Work, then: skein brief $ID --check" ;;
  *) die "unknown mode $MODE" ;;
esac
