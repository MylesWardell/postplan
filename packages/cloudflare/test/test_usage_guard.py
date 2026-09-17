import copy
from datetime import datetime, timezone
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "usage"))
import usage_guard as guard

NOW = datetime(2026, 9, 14, 12, tzinfo=timezone.utc)
POLICY = guard.load_policy()


def sample():
    account = {
        "workers": [{"sum": {"requests": 9, "cpuTimeUs": 148418}}],
        "d1": [{"sum": {"rowsRead": 8, "rowsWritten": 5}}],
        "doRequests": [{"sum": {"requests": 8}}],
        "doUsage": [{"sum": {"duration": 0.017, "rowsRead": 16, "rowsWritten": 10}}],
        "r2": [
            {"dimensions": {"actionType": "PutObject"}, "sum": {"requests": 2}},
            {"dimensions": {"actionType": "GetObject"}, "sum": {"requests": 3}},
            {"dimensions": {"actionType": "DeleteObject"}, "sum": {"requests": 2}},
            {
                "dimensions": {"actionType": "GetBucketSippyConfiguration"},
                "sum": {"requests": 1},
            },
            {
                "dimensions": {"actionType": "GetBucketNotificationConfiguration"},
                "sum": {"requests": 1},
            },
        ],
        "r2Storage": [
            {
                "dimensions": {"bucketName": "one", "storageClass": "Standard"},
                "max": {"payloadSize": 100, "metadataSize": 10},
            },
            {
                "dimensions": {"bucketName": "two", "storageClass": "Standard"},
                "max": {"payloadSize": 200, "metadataSize": 20},
            },
        ],
        "d1Storage": [{"dimensions": {"databaseId": "one"}, "max": {"databaseSizeBytes": 8192}}],
        "doStorage": [],
    }
    return {"data": {"viewer": {"accounts": [account]}}, "errors": None}


class FakeClient:
    account = "a" * 32

    def __init__(self):
        self.data = sample()
        self.calls = []
        self.fail = set()
        self.latch = False
        self.public = True
        self.crons = [{"cron": "*/5 * * * *"}]
        self.worker_domains = [
            {"id": "ours", "service": POLICY["worker"]},
            {"id": "other", "service": "unrelated"},
        ]
        self.r2_public = False
        self.r2_domains = []
        self.routes = [
            {"id": "ours", "script": POLICY["worker"]},
            {"id": "other", "script": "unrelated"},
        ]

    def request(self, path, method="GET", body=None):
        self.calls.append((path, method, body))
        if path in self.fail:
            raise guard.GuardError("Simulated unavailable API")
        if path == "/graphql":
            return self.data
        if "/workers/routes" in path:
            if method == "DELETE":
                self.routes = [
                    route for route in self.routes if not path.endswith("/" + route["id"])
                ]
                return {"result": None}
            return {"result": self.routes}
        raise AssertionError(path)

    def account_request(self, path, method="GET", body=None):
        self.calls.append((path, method, body))
        if path in self.fail:
            raise guard.GuardError("Simulated unavailable API")
        if path.endswith("/subdomain"):
            if method == "POST":
                self.public = body["enabled"] or body["previews_enabled"]
            return {"enabled": self.public, "previews_enabled": self.public}
        if path.endswith("/schedules"):
            if method == "PUT":
                self.crons = body
            return {"schedules": self.crons}
        if path.startswith("/workers/domains/"):
            self.worker_domains = [
                domain for domain in self.worker_domains if not path.endswith("/" + domain["id"])
            ]
            return None
        if path.endswith("/domains/managed"):
            if method == "PUT":
                self.r2_public = body["enabled"]
            return {"enabled": self.r2_public}
        if path.endswith("/domains/custom"):
            return {"domains": self.r2_domains}
        if "/domains/custom/" in path:
            for domain in self.r2_domains:
                if path.endswith("/" + domain["domain"]):
                    domain["enabled"] = body["enabled"]
            return {}
        if path.endswith("/buckets/" + POLICY["bucket"]):
            return {"storage_class": "Standard"}
        if path == "/subscriptions":
            return [{"rate_plan": {"id": "r2_paid"}}]
        raise AssertionError(path)

    def domains(self):
        return copy.deepcopy(self.worker_domains)

    def sql(self, policy, sql):
        self.calls.append(("d1", "POST", sql))
        if "d1" in self.fail:
            raise guard.GuardError("D1 unavailable")
        if sql.startswith("INSERT"):
            self.latch = True
        rows = []
        if sql.startswith("SELECT killed") and self.latch:
            rows = [{"killed": 1}]
        elif sql.startswith("SELECT name") and self.latch:
            rows = [{"name": "usage_guard"}]
        return [{"results": rows, "success": True}]


class UsageTests(unittest.TestCase):
    def test_empty_infrequent_access_series_is_not_paid_storage(self):
        data = sample()
        groups = data["data"]["viewer"]["accounts"][0]["r2Storage"]
        groups.append(
            {
                "dimensions": {"bucketName": "one", "storageClass": "InfrequentAccess"},
                "max": {"payloadSize": 0, "metadataSize": 0},
            }
        )
        self.assertEqual(guard.metrics_from_response(data)["r2_storage_peak_bytes_31d"], 330)
        groups[-1]["max"]["payloadSize"] = 1
        with self.assertRaises(guard.GuardError):
            guard.metrics_from_response(data)

    def test_units_classes_and_per_resource_peaks(self):
        metrics = guard.metrics_from_response(sample())
        self.assertEqual(metrics["workers_cpu_ms_24h"], 148.418)
        self.assertEqual(metrics["r2_class_a_31d"], 4)
        self.assertEqual(metrics["r2_class_b_31d"], 3)
        self.assertEqual(metrics["r2_storage_peak_bytes_31d"], 330)
        self.assertEqual(guard.breaches(metrics, POLICY), [])

    def test_exact_threshold_trips(self):
        metrics = guard.metrics_from_response(sample())
        for name, limit in POLICY["limits"].items():
            with self.subTest(metric=name):
                changed = {**metrics, name: limit}
                self.assertEqual(guard.breaches(changed, POLICY), [name])

    def test_missing_partial_invalid_and_truncated_data_rejected(self):
        cases = []
        data = sample()
        data["errors"] = [{"message": "denied"}]
        cases.append(data)
        data = sample()
        data["data"]["viewer"]["accounts"] = []
        cases.append(data)
        data = sample()
        del data["data"]["viewer"]["accounts"][0]["r2"]
        cases.append(data)
        for value in [None, "8", True, -1, float("nan"), float("inf")]:
            data = sample()
            data["data"]["viewer"]["accounts"][0]["workers"][0]["sum"]["requests"] = value
            cases.append(data)
        data = sample()
        data["data"]["viewer"]["accounts"][0]["r2"] *= 334
        cases.append(data)
        for data in cases:
            with self.assertRaises(guard.GuardError):
                guard.metrics_from_response(data)

    def test_unknown_r2_operation_and_paid_storage_rejected(self):
        for key in ["r2", "r2Storage"]:
            data = sample()
            dimension = data["data"]["viewer"]["accounts"][0][key][0]["dimensions"]
            dimension["actionType" if key == "r2" else "storageClass"] = "Unknown"
            with self.assertRaises(guard.GuardError):
                guard.metrics_from_response(data)

    def test_duplicate_storage_groups_rejected(self):
        data = sample()
        groups = data["data"]["viewer"]["accounts"][0]["r2Storage"]
        groups.append(groups[0])
        with self.assertRaises(guard.GuardError):
            guard.metrics_from_response(data)

    def test_query_uses_rolling_windows_and_account_scope(self):
        client = FakeClient()
        guard.collect(client, NOW)
        body = client.calls[0][2]
        self.assertEqual(body["variables"]["day"], "2026-09-13T12:00:00Z")
        self.assertEqual(body["variables"]["month"], "2026-08-14T12:00:00Z")
        self.assertNotIn("scriptName:", body["query"])
        self.assertNotIn("bucketName:", body["query"])

    def test_healthy_monitor_does_not_mutate(self):
        client = FakeClient()
        report = guard.execute(client, POLICY, "monitor", NOW)
        self.assertEqual(report["status"], "healthy")
        self.assertTrue(client.public)
        self.assertFalse(client.latch)
        self.assertFalse(any(method in {"PUT", "DELETE"} for _, method, _ in client.calls))

    def test_audit_does_not_kill_on_exceeded_usage(self):
        client = FakeClient()
        client.data["data"]["viewer"]["accounts"][0]["workers"][0]["sum"]["requests"] = 50000
        report = guard.execute(client, POLICY, "audit", NOW)
        self.assertEqual(report["status"], "would_stop")
        self.assertTrue(client.public)
        self.assertFalse(client.latch)

    def test_manual_kill_works_without_analytics_and_preserves_other_workers(self):
        client = FakeClient()
        client.fail.add("/graphql")
        client.r2_public = True
        client.r2_domains = [{"domain": "test.example.com", "enabled": True}]
        policy = {**POLICY, "zone_ids": ["b" * 32]}
        report = guard.execute(client, policy, "kill", NOW)
        self.assertEqual(report["status"], "stopped")
        self.assertFalse(client.public)
        self.assertTrue(client.latch)
        self.assertEqual(client.crons, [])
        self.assertEqual(client.worker_domains, [{"id": "other", "service": "unrelated"}])
        self.assertEqual(client.routes, [{"id": "other", "script": "unrelated"}])
        self.assertFalse(client.r2_public)
        self.assertFalse(client.r2_domains[0]["enabled"])
        self.assertNotIn("/graphql", [path for path, _, _ in client.calls])

    def test_analytics_failure_trips_and_keeps_trying_other_controls(self):
        client = FakeClient()
        client.fail.update({"/graphql", "d1"})
        report = guard.execute(client, POLICY, "monitor", NOW)
        self.assertEqual(report["status"], "stop_incomplete")
        self.assertFalse(client.public)
        self.assertEqual(client.crons, [])
        self.assertTrue(any(not row["ok"] for row in report["controls"]))

    def test_verification_failure_not_reported_as_stopped(self):
        client = FakeClient()
        original = client.account_request

        def sticky(path, method="GET", body=None):
            if path.endswith("/subdomain"):
                return {"enabled": True, "previews_enabled": False}
            return original(path, method, body)

        client.account_request = sticky
        report = guard.execute(client, POLICY, "kill", NOW)
        self.assertEqual(report["status"], "stop_incomplete")

    def test_latch_never_resets_when_usage_drops(self):
        client = FakeClient()
        guard.execute(client, POLICY, "kill", NOW)
        client.public = True  # Simulate a redeploy accidentally exposing the Worker.
        report = guard.execute(client, POLICY, "monitor", NOW)
        self.assertEqual(report["status"], "stopped")
        self.assertTrue(client.latch)
        self.assertFalse(client.public)

    def test_empty_activity_is_valid_but_absent_dataset_is_not(self):
        data = sample()
        account = data["data"]["viewer"]["accounts"][0]
        for key in account:
            account[key] = []
        self.assertTrue(all(value == 0 for value in guard.metrics_from_response(data).values()))
        account["r2"] = None
        with self.assertRaises(guard.GuardError):
            guard.metrics_from_response(data)

    def test_client_rejects_api_failure_without_echoing_response(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"success": False, "errors": [{"message": "secret"}]}
        ).encode()
        with patch.object(guard, "urlopen", return_value=response):
            with self.assertRaises(guard.GuardError) as caught:
                guard.Client("a" * 32, "secret").account_request("/subscriptions")
        self.assertNotIn("secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
