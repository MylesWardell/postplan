#!/bin/bash
# Judge one seed in small slices with a hard timeout, so a single pathological
# document cannot stall the whole seed. Slices that time out are reported.
# bash review/p1/run-slices.sh <seed> <from> <to> <chunk> [timeout=180]
set -u
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
seed=$1; start=$2; end=$3; chunk=$4; limit=${5:-180}
cd "$(dirname "$0")/../.."
for (( from=start; from<end; from+=chunk )); do
  to=$(( from + chunk > end ? end : from + chunk ))
  profile=$(mktemp -d /tmp/p1-holdout-XXXX)
  timeout "$limit" "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$(cygpath -w "$profile")" --virtual-time-budget=100000000 --dump-dom \
    "http://127.0.0.1:5287/?nobase=1&seeds=$seed&count=200000&from=$from&to=$to" > /dev/null 2>&1
  status=$?
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*$(basename "$profile")*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
  rm -rf "$profile"
  part="review/p1/oracle-chrome-fuzz-$seed-p$from.json"
  if [ -f "$part" ]; then echo "ok   [$from,$to)"; else echo "STALL [$from,$to) status=$status"; fi
done
echo SLICES DONE
