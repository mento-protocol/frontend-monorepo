#!/usr/bin/env bash
# skein watch <TASK> [ws] [term] [max-hours] [poll-seconds] [marker] [--resume]
# Poll one worker until it emits a completion envelope naming this task, vanishes, or
# times out. With --resume, envelopes already on screen when the watch starts are ignored
# (a resumed session still shows its last round's envelope): start it BEFORE sending the
# follow-up prompt. Prints SKEIN_WATCH task=<id> outcome=DONE|BLOCKED|…
. "$SKEIN_HOME/lib/common.sh"; require_config; load_driver
need jq node
RESUME=""; args=(); for a in "$@"; do [ "$a" = "--resume" ] && RESUME=1 || args+=("$a"); done; set -- "${args[@]}"
TASK="${1:-}"; [ -n "$TASK" ] || die "usage: skein watch <TASK> [ws] [term] [max-hours] [poll-s] [marker] [--resume]"
ID="$(task_id_norm "$TASK")"
WS="${2:-}"; { [ -z "$WS" ] || [ "$WS" = "-" ]; } && WS="$(driver_find "$ID")"; [ -n "$WS" ] || die "no workspace found for $ID"
TERM_ID="${3:-}"; { [ -z "$TERM_ID" ] || [ "$TERM_ID" = "-" ]; } && TERM_ID="$(driver_agent_terminal "$WS")"; [ -n "$TERM_ID" ] || die "no agent terminal in workspace $WS"
MAX_H="${4:-8}"; EVERY="${5:-120}"; MARKER="${6:-}"
DIR="${SKEIN_STATE_DIR:-${TMPDIR:-/tmp}/skein-$(basename "$ROOT")}"; mkdir -p "$DIR"
LOG="$DIR/watch-$ID.log"; SNAP="$DIR/watch-$ID.last.txt"; BASE="$DIR/watch-$ID.baseline.json"; rm -f "$BASE"
deadline=$(( $(date +%s) + MAX_H * 3600 )); misses=0
echo "$(date -Is) watching $ID ws=$WS term=$TERM_ID every ${EVERY}s for up to ${MAX_H}h" >> "$LOG"

while [ "$(date +%s)" -lt "$deadline" ]; do
  text="$(driver_read "$WS" "$TERM_ID" 240)"
  if [ -z "$text" ]; then
    misses=$((misses+1)); echo "$(date -Is) empty read ($misses)" >> "$LOG"
    [ "$misses" -ge 5 ] && { echo "SKEIN_WATCH task=$ID outcome=TERMINAL_UNREADABLE"; exit 2; }
  else
    misses=0; printf '%s\n' "$text" > "$SNAP"
    if [ -n "$MARKER" ]; then text="$(MARKER="$MARKER" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=s.lastIndexOf(process.env.MARKER);process.stdout.write(i<0?s:s.slice(i))})' <<<"$text")"; fi
    mode=check; if [ ! -f "$BASE" ]; then if [ -n "$RESUME" ]; then mode=init; else echo "[]" > "$BASE"; fi; fi
    verdict="$(printf '%s' "$text" | ENVELOPE="$ENVELOPE" node -e '
      const fs=require("fs");const [task,base,mode]=process.argv.slice(1);let s="";
      process.stdin.on("data",d=>s+=d).on("end",()=>{
        const re=new RegExp(process.env.ENVELOPE+"_(DONE|BLOCKED)[^\\n]*\\n(?:[^\\n]*\\n){0,2}?[^\\n]*task:\\s*"+task.replace(/[-.]/g,"\\$&")+"\\b[^\\n]*\\n[^\\n]*(?:summary|reason):[ \\t]*([^\\n]*)","gi");
        const found=[...s.matchAll(re)].filter(x=>!/[<>]/.test(x[2])&&x[2].trim().length>0).map(x=>({verdict:x[1].toUpperCase(),key:x[0].replace(/\s+/g," ").trim()}));
        if(mode==="init"){fs.writeFileSync(base,JSON.stringify(found.map(f=>f.key)));return}
        const old=new Set(JSON.parse(fs.readFileSync(base,"utf8")));const fresh=found.filter(f=>!old.has(f.key));
        if(fresh.length)process.stdout.write(fresh[fresh.length-1].verdict)})' "$ID" "$BASE" "$mode")"
    [ "$mode" = init ] && echo "$(date -Is) baseline: $(jq length "$BASE") envelope(s) already on screen, ignored" >> "$LOG"
    if [ -n "$verdict" ]; then
      echo "$(date -Is) envelope: $verdict" >> "$LOG"
      echo "SKEIN_WATCH task=$ID outcome=$verdict"
      echo "----- last screen -----"; printf '%s\n' "$text" | grep -v '^\s*$' | tail -45
      exit 0
    fi
  fi
  sleep "$EVERY"
done
echo "SKEIN_WATCH task=$ID outcome=TIMEOUT after ${MAX_H}h"; echo "----- last screen -----"; tail -40 "$SNAP" 2>/dev/null
exit 1
