"""Account usage watchdog; mutations are limited to the checked-in experiment targets."""

import argparse
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
API = "https://api.cloudflare.com/client/v4"
PAGE_SIZE = 1000
CLASS_A = set(
    "ListBuckets PutBucket ListObjects PutObject CopyObject CompleteMultipartUpload CreateMultipartUpload LifecycleStorageTierTransition ListMultipartUploads UploadPart UploadPartCopy ListParts PutBucketEncryption PutBucketCors PutBucketLifecycleConfiguration".split()
)
CLASS_B = set(
    "HeadBucket HeadObject GetObject UsageSummary GetBucketEncryption GetBucketLocation GetBucketCors GetBucketLifecycleConfiguration".split()
)
FREE = {"DeleteObject", "DeleteBucket", "AbortMultipartUpload"}
GUARD_SCHEMA = "CREATE TABLE IF NOT EXISTS usage_guard (id INTEGER PRIMARY KEY CHECK(id=1), killed INTEGER NOT NULL CHECK(killed IN (0,1)))"


class GuardError(Exception):
    pass


def number(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
    ):
        raise GuardError("Missing or invalid numeric metric")
    return value


def load_policy(path=HERE / "usage-policy.json"):
    policy = json.loads(path.read_text())
    for key, pattern in [
        ("worker", r"[a-z0-9-]+"),
        ("bucket", r"[a-z0-9-]+"),
        ("database_id", r"[a-f0-9-]{36}"),
    ]:
        if not re.fullmatch(pattern, policy[key]):
            raise GuardError("Invalid target in usage policy")
    if not isinstance(policy["zone_ids"], list) or any(
        not re.fullmatch(r"[a-f0-9]{32}", zone) for zone in policy["zone_ids"]
    ):
        raise GuardError("Invalid zone allowlist")
    for value in policy["limits"].values():
        if number(value) == 0:
            raise GuardError("Usage limits must be positive")
    return policy


class Client:
    def __init__(self, account, token):
        if not re.fullmatch(r"[a-f0-9]{32}", account or "") or not token:
            raise GuardError("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_USAGE_API_TOKEN")
        self.account = account
        self.token = token

    def request(self, path, method="GET", body=None):
        request = Request(
            API + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=15) as response:
                result = json.load(response)
        except HTTPError as error:
            # Never log response bodies: proxies and APIs can echo credentials.
            raise GuardError(f"Cloudflare HTTP {error.code}") from None
        except (URLError, TimeoutError, ValueError):
            raise GuardError("Cloudflare unavailable or returned invalid JSON") from None
        if (
            not isinstance(result, dict)
            or result.get("errors")
            or (path != "/graphql" and result.get("success") is not True)
        ):
            raise GuardError("Cloudflare rejected request or returned partial data")
        return result

    def account_request(self, path, method="GET", body=None):
        return self.request(f"/accounts/{self.account}{path}", method, body)["result"]

    def domains(self):
        # Read every page before mutating; deleting during pagination skips entries.
        items = []
        for page in range(1, 101):
            response = self.request(
                f"/accounts/{self.account}/workers/domains?"
                + urlencode({"page": page, "per_page": 100})
            )
            rows = response["result"]
            if not isinstance(rows, list):
                raise GuardError("Invalid Worker domain inventory")
            items.extend(rows)
            info = response.get("result_info", {})
            if len(rows) < 100 or len(items) >= info.get("total_count", float("inf")):
                return items
        raise GuardError("Worker domain inventory exceeded bound")

    def sql(self, policy, sql):
        results = self.account_request(
            f"/d1/database/{policy['database_id']}/query", "POST", {"sql": sql}
        )
        if (
            not isinstance(results, list)
            or not results
            or any(row.get("success") is not True for row in results)
        ):
            raise GuardError("D1 rejected kill switch operation")
        return results


def rows(account, key, maximum=PAGE_SIZE):
    value = account.get(key)
    if not isinstance(value, list) or len(value) >= maximum:
        raise GuardError(f"Missing or possibly truncated dataset: {key}")
    return value


def metrics_from_response(response):
    if response.get("errors"):
        raise GuardError("Partial GraphQL data")
    try:
        accounts = response["data"]["viewer"]["accounts"]
        if not isinstance(accounts, list) or len(accounts) != 1:
            raise GuardError("Account analytics unavailable")
        account = accounts[0]
        metrics = {}
        for dataset, fields in {
            "workers": {"requests": "workers_requests_24h", "cpuTimeUs": "workers_cpu_ms_24h"},
            "d1": {"rowsRead": "d1_rows_read_24h", "rowsWritten": "d1_rows_written_24h"},
            "doRequests": {"requests": "do_requests_24h"},
            "doUsage": {
                "duration": "do_duration_gb_seconds_24h",
                "rowsRead": "do_rows_read_24h",
                "rowsWritten": "do_rows_written_24h",
            },
        }.items():
            groups = rows(account, dataset)
            if len(groups) > 1:
                raise GuardError("Unexpected aggregate grouping")
            for field, name in fields.items():
                metrics[name] = sum(number(group["sum"][field]) for group in groups)
        metrics["workers_cpu_ms_24h"] /= 1000
        metrics.update(r2_class_a_31d=0, r2_class_b_31d=0)
        for group in rows(account, "r2"):
            action = group["dimensions"]["actionType"]
            count = number(group["sum"]["requests"])
            if action in CLASS_A:
                metrics["r2_class_a_31d"] += count
            elif action in CLASS_B:
                metrics["r2_class_b_31d"] += count
            elif action not in FREE:
                raise GuardError("Unclassified R2 operation; review pricing before continuing")
        # Sum per-resource maxima, never sum repeated time-series gauges.
        for dataset, name, fields, dimension in [
            (
                "r2Storage",
                "r2_storage_peak_bytes_31d",
                ["payloadSize", "metadataSize"],
                "bucketName",
            ),
            ("d1Storage", "d1_storage_bytes", ["databaseSizeBytes"], "databaseId"),
            ("doStorage", "do_storage_bytes", ["storedBytes"], "namespaceId"),
        ]:
            seen = set()
            metrics[name] = 0
            for group in rows(account, dataset):
                identity = group["dimensions"][dimension]
                if not isinstance(identity, str) or not identity:
                    raise GuardError("Duplicate or invalid storage grouping")
                size = sum(number(group["max"][field]) for field in fields)
                if dataset == "r2Storage":
                    storage_class = group["dimensions"]["storageClass"]
                    if storage_class not in {"Standard", "STANDARD"}:
                        # Analytics emits an empty InfrequentAccess series even
                        # for Standard-only buckets. Nonzero usage still stops.
                        if storage_class == "InfrequentAccess" and size == 0:
                            continue
                        raise GuardError("R2 free allowance does not cover this storage class")
                if identity in seen:
                    raise GuardError("Duplicate or invalid storage grouping")
                seen.add(identity)
                metrics[name] += size
        return metrics
    except (KeyError, TypeError, AttributeError):
        raise GuardError("Malformed analytics response") from None


def collect(client, now):
    iso = lambda date: date.strftime("%Y-%m-%dT%H:%M:%SZ")
    variables = {
        "a": client.account,
        "day": iso(now - timedelta(days=1)),
        "month": iso(now - timedelta(days=31)),
        "end": iso(now),
    }
    return metrics_from_response(
        client.request(
            "/graphql",
            "POST",
            {"query": (HERE / "usage.graphql").read_text(), "variables": variables},
        )
    )


def breaches(metrics, policy):
    if metrics.keys() != policy["limits"].keys():
        raise GuardError("Policy and collected metric names differ")
    return [
        name for name, value in metrics.items() if number(value) >= number(policy["limits"][name])
    ]


def kill(client, policy):
    """Best effort across independent controls; verify each and retain failures."""
    results = []
    worker_path = f"/workers/scripts/{policy['worker']}"

    def attempt(name, action):
        try:
            action()
            results.append({"control": name, "ok": True})
        except Exception as error:
            results.append(
                {
                    "control": name,
                    "ok": False,
                    "error": (
                        str(error)
                        if isinstance(error, GuardError)
                        else "Unexpected control response"
                    ),
                }
            )

    def latch():
        client.sql(policy, GUARD_SCHEMA)
        client.sql(
            policy, "INSERT INTO usage_guard VALUES (1,1) ON CONFLICT(id) DO UPDATE SET killed=1"
        )
        if client.sql(policy, "SELECT killed FROM usage_guard WHERE id=1")[0]["results"] != [
            {"killed": 1}
        ]:
            raise GuardError("Kill latch verification failed")

    def subdomain():
        client.account_request(
            worker_path + "/subdomain", "POST", {"enabled": False, "previews_enabled": False}
        )
        state = client.account_request(worker_path + "/subdomain")
        if state.get("enabled") is not False or state.get("previews_enabled") is not False:
            raise GuardError("Worker remains public")

    def schedules():
        client.account_request(worker_path + "/schedules", "PUT", [])
        if client.account_request(worker_path + "/schedules")["schedules"]:
            raise GuardError("Cron triggers remain")

    def domains():
        targets = [
            domain for domain in client.domains() if domain.get("service") == policy["worker"]
        ]
        for domain in targets:
            client.account_request("/workers/domains/" + domain["id"], "DELETE")
        if any(domain.get("service") == policy["worker"] for domain in client.domains()):
            raise GuardError("Worker custom domains remain")

    def zone_routes(zone):
        path = f"/zones/{zone}/workers/routes"
        routes = client.request(path)["result"]
        if not isinstance(routes, list):
            raise GuardError("Invalid zone routes")
        for route in routes:
            if route.get("script") == policy["worker"]:
                client.request(path + "/" + route["id"], "DELETE")
        if any(route.get("script") == policy["worker"] for route in client.request(path)["result"]):
            raise GuardError("Worker zone routes remain")

    bucket_path = "/r2/buckets/" + policy["bucket"]

    def r2_managed():
        client.account_request(bucket_path + "/domains/managed", "PUT", {"enabled": False})
        if client.account_request(bucket_path + "/domains/managed").get("enabled") is not False:
            raise GuardError("R2 managed domain remains public")

    def r2_custom():
        targets = client.account_request(bucket_path + "/domains/custom")["domains"]
        for domain in targets:
            client.account_request(
                bucket_path + "/domains/custom/" + quote(domain["domain"], safe=""),
                "PUT",
                {"enabled": False},
            )
        if any(
            domain.get("enabled") is not False
            for domain in client.account_request(bucket_path + "/domains/custom")["domains"]
        ):
            raise GuardError("R2 custom domain remains public")

    attempt("persistent D1 stop", latch)
    attempt("workers.dev and previews", subdomain)
    attempt("Worker Cron triggers", schedules)
    attempt("Worker custom domains", domains)
    attempt("R2 managed domain", r2_managed)
    attempt("R2 custom domains", r2_custom)
    for zone in policy["zone_ids"]:
        attempt("allowlisted zone " + zone, lambda zone=zone: zone_routes(zone))
    return results


def check_exposure(client, policy):
    bucket_path = "/r2/buckets/" + policy["bucket"]
    if client.account_request(bucket_path + "/domains/managed").get("enabled") is not False:
        raise GuardError("R2 bucket has a public r2.dev endpoint")
    if any(
        domain.get("enabled") is not False
        for domain in client.account_request(bucket_path + "/domains/custom")["domains"]
    ):
        raise GuardError("R2 bucket has an enabled custom domain")
    bucket = client.account_request(bucket_path)
    if bucket.get("storage_class") != "Standard":
        raise GuardError("Experiment bucket is not Standard storage")
    subscriptions = client.account_request("/subscriptions")
    if not isinstance(subscriptions, list):
        raise GuardError("Unable to check Workers subscription")
    if any("workers" in subscription["rate_plan"]["id"].lower() for subscription in subscriptions):
        raise GuardError("Workers subscription changed; review free-tier policy")


def execute(client, policy, mode, now):
    report = {
        "checked_at": now.isoformat(),
        "worker": policy["worker"],
        "mode": mode,
        "limits": policy["limits"],
        "metrics": {},
        "reasons": [],
        "controls": [],
    }
    if mode == "kill":
        report["reasons"] = ["Manual kill requested"]
    else:
        try:
            report["metrics"] = collect(client, now)
            report["reasons"] = breaches(report["metrics"], policy)
            check_exposure(client, policy)
            tables = client.sql(
                policy, "SELECT name FROM sqlite_master WHERE type='table' AND name='usage_guard'"
            )[0]["results"]
            if tables and client.sql(policy, "SELECT killed FROM usage_guard WHERE id=1")[0][
                "results"
            ] == [{"killed": 1}]:
                report["reasons"].append("Persistent stop is latched; manual recovery required")
        except Exception as error:
            # Only our sanitized errors are suitable for logs.
            report["reasons"].append(
                str(error) if isinstance(error, GuardError) else "Usage check failed"
            )
    if report["reasons"] and mode != "audit":
        report["controls"] = kill(client, policy)
    report["status"] = (
        "healthy" if not report["reasons"] else ("would_stop" if mode == "audit" else "stopped")
    )
    if any(not control["ok"] for control in report["controls"]):
        report["status"] = "stop_incomplete"
    # No code path enables ingress or resets the persistent latch.
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["monitor", "audit", "kill"], default="monitor")
    args = parser.parse_args()
    try:
        policy = load_policy()
        client = Client(os.getenv("CLOUDFLARE_ACCOUNT_ID"), os.getenv("CLOUDFLARE_USAGE_API_TOKEN"))
        report = execute(client, policy, args.mode, datetime.now(timezone.utc))
    except Exception as error:
        report = {
            "status": "unavailable",
            "reasons": [
                str(error) if isinstance(error, GuardError) else "Invalid guard configuration"
            ],
            "controls": [],
        }
    output = json.dumps(report, indent=2)
    print(output)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write("## Cloudflare usage guard\n\n```json\n" + output + "\n```\n")
    return (
        0
        if report["status"] == "healthy" or (args.mode == "kill" and report["status"] == "stopped")
        else 1
    )


if __name__ == "__main__":
    sys.exit(main())
