#!/bin/bash
# Local mirror of the reference stage, plus the rows that say whether the block
# can be lied to. It runs the task's own tests/test.sh inside an image built
# the way the platform builds the verifier, so anything only test.sh does is
# exercised rather than assumed.
#
#   ./verify_task.sh              every row once
#   ROWS="oracle base" ./verify_task.sh   just those rows
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../repo" && pwd)"
BUNDLE="$HERE/bundle"
ENV_IMAGE="${ENV_IMAGE:-skald-b67a-env:v1}"
IMAGE="${IMAGE:-skald-b67a-verify:local}"
WORK="${WORK:-$(mktemp -d)}"
LANES_PLANNED="${LANES:-2}"
BASE_SHA="8bed17cc554e77399347f7b0486dd1b7ecb717f0"

PROBLEMS=0
fail() { echo "FAIL: $*"; PROBLEMS=$((PROBLEMS + 1)); }

# ------------------------------------------------------------- frame check
python3 - "$HERE" <<'PY' || exit 1
import pathlib, sys
here = pathlib.Path(sys.argv[1])
A = "# >>> RUN TESTS (task-specific) <<<"
B = "# >>> END RUN TESTS <<<"
frame = (here / "frame.sh").read_text()
out = (here / "bundle" / "tests" / "test.sh").read_text()
fh, fr = frame.split(A, 1); _, ft = fr.split(B, 1)
oh, orr = out.split(A, 1); _, ot = orr.split(B, 1)
assert oh == fh, "bytes above the marker moved"
assert ot == ft, "bytes below the marker moved"
assert out.startswith(fh + A), "test.sh does not begin with the canonical frame"
print("frame: unchanged outside the markers")
PY

# ------------------------------------------------- instruction preflight
python3 - "$HERE" <<'PY' || exit 1
import pathlib, sys
here = pathlib.Path(sys.argv[1])
text = (here / "bundle" / "instruction.md").read_text()
T = "IMPORTANT: Please work on this in a new branch from main and commit everything when you are done."
assert text.rstrip().endswith(T), "instruction.md must end with the exact IMPORTANT line"
n = len(text.split())
assert 100 <= n <= 300, "instruction is %d words" % n
for ch in "—–":
    assert ch not in text, "instruction carries a dash tell"
for name in ("instruction.md", "task.toml", "tests/config.json", "tests/test.sh"):
    body = (here / "bundle" / name).read_text()
    assert "EDIT-ME" not in body, "%s still carries a placeholder" % name
print("instruction: %d words, trailer exact, no tells, no placeholders" % n)
PY

# -------------------------------------------------------- verifier image
mkdir -p "$WORK"
sed "s|^FROM .*|FROM $ENV_IMAGE|" "$BUNDLE/tests/Dockerfile" > "$WORK/tests.Dockerfile"
docker build -q -t "$IMAGE" -f "$WORK/tests.Dockerfile" "$BUNDLE/tests" >/dev/null \
  || { echo "FAIL: verifier image would not build"; exit 1; }

# --------------------------------------------------------------- one row
# $1 row name, $2 patch file or "" for none, $3 expected f2p, $4 expected p2p.
# An expectation of "<N" means "fewer than N", which is what a mutation row has
# to reach: a break that costs no graded case means that case asserts nothing.
prepare_row() {
  local name="$1" patch="$2"
  local root="$WORK/$name"
  rm -rf "$root"; mkdir -p "$root/logs/artifacts" "$root/logs/verifier"
  cp -a "$REPO" "$root/app"
  ( cd "$root/app" && git init -q -b main \
      && git -c user.name=b -c user.email=b@l add -A \
      && git -c user.name=b -c user.email=b@l commit -q -m base ) || return 1
  [ -n "$patch" ] && cp "$patch" "$root/logs/artifacts/model.patch"
  # Each row gets its own container and its own build. Rows that share a cargo
  # target directory reuse each other's binaries, and a row whose verdict
  # changes when it runs alone measured nothing.
  docker run --rm --network none \
    -v "$root/app:/app" -v "$root/logs:/logs" \
    "$IMAGE" bash /tests/test.sh > "$root/stdout.txt" 2>&1
}

report_row() {
  local name="$1" want_f2p="$2" want_p2p="$3"
  local root="$WORK/$name"
  local line got_f2p got_p2p reward verdict
  line="$(grep -E '^P2P [0-9]+/' "$root/stdout.txt" | tail -1)"
  got_p2p="$(sed -n 's|^P2P \([0-9]*\)/.*|\1|p' <<<"$line")"
  got_f2p="$(sed -n 's|.*F2P \([0-9]*\)/.*|\1|p' <<<"$line")"
  reward="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["reward"])' \
             "$root/logs/verifier/reward.json" 2>/dev/null || echo "?")"
  verdict=ok
  case "$want_f2p" in
    "<"*) [ "${got_f2p:-99}" -lt "${want_f2p#<}" ] || verdict=bad ;;
    *)    [ "${got_f2p:-x}" = "$want_f2p" ] || verdict=bad ;;
  esac
  [ "${got_p2p:-x}" = "$want_p2p" ] || verdict=bad
  printf '  %-36s f2p %-4s p2p %-4s reward %-3s' "$name" "${got_f2p:-?}" "${got_p2p:-?}" "$reward"
  if [ "$verdict" = ok ]; then
    echo "  ok"
  else
    echo "  EXPECTED f2p $want_f2p p2p $want_p2p"
    fail "$name"
  fi
  # A row can be right for the wrong reason. Naming the check that fired is the
  # only way to tell prevention from an accident.
  grep -E '^\[verifier\] (INTEGRITY|DISBELIEVED)' "$root/stdout.txt" | sed 's|^|      |'
}

# Rows and what each must reach. Baselines are computed from the shipped
# config so they cannot drift; everything else comes from rows.tsv, which
# mutants.py writes beside the patches it generates.
declare -a NAMES=() PATCHES=() WANT_F=() WANT_P=()
add_row() { NAMES+=("$1"); PATCHES+=("$2"); WANT_F+=("$3"); WANT_P+=("$4"); }

F2P_N="$(python3 -c 'import json;print(len(json.load(open("bundle/tests/config.json"))["f2p_node_ids"]))')"
P2P_N="$(python3 -c 'import json;print(len(json.load(open("bundle/tests/config.json"))["p2p_node_ids"]))')"

: > "$WORK/empty.patch"
for row in ${ROWS:-oracle base empty generated}; do
  case "$row" in
    oracle)  add_row oracle "$BUNDLE/solution/solution.patch" "$F2P_N" "$P2P_N" ;;
    base)    add_row base "" 0 "$P2P_N" ;;
    empty)   add_row empty "$WORK/empty.patch" 0 "$P2P_N" ;;
    generated)
      while IFS="$(printf '\t')" read -r n wf wp; do
        [ -n "$n" ] || continue
        add_row "$n" "$HERE/rows/$n.patch" "$wf" "$wp"
      done < "$HERE/rows.tsv" ;;
    *)
      wf="$(awk -F"\t" -v n="$row" '$1==n{print $2}' "$HERE/rows.tsv")"
      wp="$(awk -F"\t" -v n="$row" '$1==n{print $3}' "$HERE/rows.tsv")"
      if [ -n "$wf" ]; then add_row "$row" "$HERE/rows/$row.patch" "$wf" "$wp"; else fail "unknown row $row"; fi ;;
  esac
done

# A row that cannot write /tmp fails exactly the cases that touch the
# filesystem and reads identically to a broken task. It cost a full round once,
# on a box at 100%, so a run that starts short of room refuses instead.
# Each row builds the crate from scratch in its own container and leaves a work
# tree behind, so the space a battery needs is per ROW, not per lane. A run that
# starts with room and fills the disk halfway through looks exactly like a task
# whose verifier is broken: every remaining row reports every id as failed, with
# an empty run log and no reason anywhere.
FREE_MB="$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}')"
NEED_MB=$(( 700 * ${#NAMES[@]} + 3000 * LANES_PLANNED ))
if [ -n "$FREE_MB" ] && [ "$FREE_MB" -lt "$NEED_MB" ]; then
  echo "REFUSING: ${FREE_MB} MB free, ${NEED_MB} MB needed for ${LANES_PLANNED} lanes."
  echo "Free space first (docker builder prune -af, rm -rf the old $WORK trees),"
  echo "or run fewer rows with ROWS=..."
  exit 1
fi

echo "== rows =="
LANES="$LANES_PLANNED"
i=0
while [ "$i" -lt "${#NAMES[@]}" ]; do
  pids=()
  for _ in $(seq 1 "$LANES"); do
    [ "$i" -lt "${#NAMES[@]}" ] || break
    prepare_row "${NAMES[$i]}" "${PATCHES[$i]}" &
    pids+=($!)
    i=$((i + 1))
  done
  for pid in "${pids[@]}"; do wait "$pid"; done
done
for j in "${!NAMES[@]}"; do
  report_row "${NAMES[$j]}" "${WANT_F[$j]}" "${WANT_P[$j]}"
done

echo
if [ "$PROBLEMS" -eq 0 ]; then
  echo "all rows behaved as declared"
else
  echo "$PROBLEMS row(s) did not"
fi
echo "work tree: $WORK"
exit "$PROBLEMS"
