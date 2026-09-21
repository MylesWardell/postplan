"""Join private request records and dashboard exports; emit only allowlisted metrics.
Usage: python benchmark/analyze.py ignored-evidence-directory public-results.json
The directory must contain requests-{1,2}.json and {bare,hono,orpc}-logs.json.
"""
import json
import statistics
import sys
from pathlib import Path

root, target = map(Path, sys.argv[1:])
samples = []
versions = {}
for arm in ("bare", "hono", "orpc"):
    logs = json.loads((root / f"{arm}-logs.json").read_text())
    indexed = {}
    for item in logs:
        worker = item.get("$workers", {})
        if worker.get("eventType") != "fetch":
            continue
        ray = worker["event"]["request"]["headers"].get("cf-ray", "").split("-")[0]
        if ray:
            assert ray not in indexed, "Duplicate invocation"
            indexed[ray] = worker
    for batch in (1, 2):
        for req in json.loads((root / f"requests-{batch}.json").read_text()):
            if req["arm"] != arm:
                continue
            worker = indexed[req["ray"].split("-")[0]]
            assert req["status"] == 201 and worker["outcome"] == "ok"
            version = worker["scriptVersion"]["id"]
            assert versions.setdefault(arm, version) == version
            samples.append({"arm": arm, "batch": batch, "round": req["round"],
                            "case": req["case"], "bytes": req["bytes"],
                            "status": req["status"], "cpuMs": worker["cpuTimeMs"],
                            "wallMs": worker["wallTimeMs"], "clientMs": req["end"]-req["start"]})
assert len(samples) == 108, "Incomplete matching; never treat missing CPU as zero"

def stats(values):
    return {"n": len(values), "median": statistics.median(values),
            "mean": round(statistics.mean(values), 3), "min": min(values), "max": max(values)}

summary = []
for case in ("5356", "32768", "dense32768"):
    for arm in ("bare", "hono", "orpc"):
        group = [s for s in samples if s["arm"] == arm and s["case"] == case]
        assert len(group) == 12
        values = [s["cpuMs"] for s in group]
        summary.append({"arm": arm, "case": case, "cpuMs": stats(values),
                        "strictlyUnder10Ms": sum(v < 10 for v in values),
                        "wallMs": stats([s["wallMs"] for s in group])})
deltas = []
for left, right in (("hono", "bare"), ("orpc", "hono")):
    for case in ("5356", "32768", "dense32768"):
        def group(arm):
            return {(s["batch"], s["round"]): s["cpuMs"] for s in samples
                    if s["arm"] == arm and s["case"] == case}
        a, b = group(left), group(right)
        values = [a[k]-b[k] for k in sorted(a)]
        deltas.append({"comparison": left+"-"+right, "case": case,
                       "cpuMs": stats(values), "samplesMs": values})
result = {"date": "2026-09-21", "region": "SYD", "versions": versions,
          "measurement": "Cloudflare fetch CPU; integer milliseconds; no samples discarded",
          "summary": summary, "pairedDeltas": deltas, "samples": samples}
target.write_text(json.dumps(result, indent=2)+"\n")
print(json.dumps({"summary": summary, "pairedDeltas": deltas}, indent=2))
