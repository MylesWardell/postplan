// Seeds one or two benchmark Workers, then CPU-profiles every configured batch.
// Usage: bun profile.ts <tag> [case,case...]
import { mkdir, writeFile } from "node:fs/promises";
import { busyMilliseconds, median } from "./cpu-profile";
import type { CpuProfile } from "./cpu-profile";

// Requests per profiled batch. Larger cases use fewer requests to keep batches short.
export const PLAN = {
  healthz: 400,
  home: 300,
  dashboard: 150,
  list: 300,
  public: 400,
  upload: 150,
  uploadLarge: 20,
} as const;

type Scenario = keyof typeof PLAN;
type Status = Record<string, number>;
type RunResult = { status: Status; bytes: number; sample: string };
type Target = {
  tag: string;
  baseUrl: string;
  inspectorUrl: string;
  revision: string;
  source: string;
  sourceSha256: string;
  dirty?: boolean;
  stateSha256?: string;
  patchSha256?: string;
  wrangler?: string;
};
type InspectorReply = { id?: number; result?: unknown; error?: unknown };
type InspectorTarget = { webSocketDebuggerUrl: string };
type BatchResult = {
  batch: number;
  profile: string;
  busyMsPerRequest: number;
  status: Status;
  bytes: number;
};
type ScenarioSummary = {
  n: number;
  busyMsMedian: number;
  warmStatus: Status;
  batches: BatchResult[];
};

const TAG = /^[a-z0-9][a-z0-9._-]*$/i;
const [tag, only] = process.argv.slice(2);
if (!tag) {
  throw new Error("Usage: bun profile.ts <tag> [case,case...]");
}
const batches = readPositiveInteger("BENCH_BATCHES", 3);
const samplingInterval = readPositiveInteger("BENCH_SAMPLING_INTERVAL", 100);
const targets = readTargets(tag);
const requested = only ? only.split(",") : Object.keys(PLAN);
const unknown = requested.filter((name) => !(name in PLAN));
if (unknown.length > 0) {
  throw new Error(`Unknown benchmark cases: ${unknown.join(", ")}`);
}
const scenarios = requested as Scenario[];
const outputs = new Map<string, URL>();
const summaries = new Map<string, Record<string, ScenarioSummary>>();
for (const target of targets) {
  if (!TAG.test(target.tag)) {
    throw new Error(`Unsafe result tag: ${target.tag}`);
  }
  const output = new URL(`./results/${target.tag}/`, import.meta.url);
  await mkdir(output, { recursive: true });
  outputs.set(target.tag, output);
  summaries.set(target.tag, {});
}

class InspectorClient {
  private sequence = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as InspectorReply;
      if (message.id === undefined) {
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(message.error);
      } else {
        waiter.resolve(message.result);
      }
    };
  }

  static async connect(inspectorUrl: string): Promise<InspectorClient> {
    const response = await fetch(`${inspectorUrl}/json/list`);
    if (!response.ok) {
      throw new Error(`Inspector discovery failed: ${await response.text()}`);
    }
    const discovered = (await response.json()) as InspectorTarget[];
    const target = discovered[0];
    if (!target) {
      throw new Error("Inspector did not expose a target.");
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl, {
      headers: { Origin: inspectorUrl },
    });
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = reject;
    });
    return new InspectorClient(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

const clients = new Map<string, InspectorClient>();
for (const target of targets) {
  const seeded = await fetch(`${target.baseUrl}/seed`);
  if (!seeded.ok) {
    throw new Error(`Seed failed for ${target.tag}: ${await seeded.text()}`);
  }
  const client = await InspectorClient.connect(target.inspectorUrl);
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: samplingInterval });
  clients.set(target.tag, client);
}

const executionOrder: Array<{ scenario: Scenario; batch: number; tags: string[] }> = [];
for (const [scenarioIndex, name] of scenarios.entries()) {
  const n = PLAN[name];
  const warmStatuses = new Map<string, Status>();
  const results = new Map<string, BatchResult[]>();
  for (const target of targets) {
    const warm = await fetchRun(target, name, Math.ceil(n / 3));
    warmStatuses.set(target.tag, warm.status);
    results.set(target.tag, []);
  }
  for (let batch = 0; batch < batches; batch++) {
    const forward = (scenarioIndex * batches + batch) % 2 === 0;
    const orderedTargets = forward ? targets : targets.toReversed();
    executionOrder.push({ scenario: name, batch, tags: orderedTargets.map(({ tag }) => tag) });
    for (const target of orderedTargets) {
      const client = clients.get(target.tag)!;
      await client.send("Profiler.start");
      const result = await fetchRun(target, name, n);
      const { profile } = await client.send<{ profile: CpuProfile }>("Profiler.stop");
      const filename = `${name}.batch-${batch + 1}.cpuprofile`;
      await writeFile(new URL(filename, outputs.get(target.tag)!), JSON.stringify(profile));
      const batchResult = {
        batch,
        profile: filename,
        busyMsPerRequest: busyMilliseconds(profile) / n,
        status: result.status,
        bytes: result.bytes,
      };
      results.get(target.tag)!.push(batchResult);
      if (hasUnexpectedStatus(result.status)) {
        console.warn(target.tag, name, "unexpected status", JSON.stringify(result));
      }
    }
  }
  for (const target of targets) {
    const targetBatches = results.get(target.tag)!;
    const summary = summaries.get(target.tag)!;
    summary[name] = {
      n,
      busyMsMedian: median(targetBatches.map(({ busyMsPerRequest }) => busyMsPerRequest)),
      warmStatus: warmStatuses.get(target.tag)!,
      batches: targetBatches,
    };
    console.log(
      target.tag.padEnd(16),
      name.padEnd(12),
      "busy ms/req",
      targetBatches.map(({ busyMsPerRequest }) => busyMsPerRequest.toFixed(2)).join(" "),
      "status",
      JSON.stringify(warmStatuses.get(target.tag)),
    );
  }
}

for (const target of targets) {
  const output = outputs.get(target.tag)!;
  await writeFile(
    new URL("summary.json", output),
    JSON.stringify(summaries.get(target.tag), null, 2) + "\n",
  );
  await writeFile(
    new URL("metadata.json", output),
    JSON.stringify(
      {
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        tag: target.tag,
        revision: target.revision,
        source: target.source,
        sourceSha256: target.sourceSha256,
        dirty: target.dirty ?? false,
        stateSha256: target.stateSha256 || null,
        patchSha256: target.patchSha256 || null,
        runtime: {
          bun: Bun.version,
          node: process.env.BENCH_NODE_VERSION ?? "unknown",
          wrangler: target.wrangler ?? process.env.BENCH_WRANGLER_VERSION ?? "unknown",
          platform: process.platform,
          architecture: process.arch,
        },
        configuration: { batches, samplingInterval, plan: PLAN },
        scenarioOrder: scenarios,
        executionOrder,
        comparedTags: targets.map(({ tag }) => tag),
      },
      null,
      2,
    ) + "\n",
  );
}
for (const client of clients.values()) {
  client.close();
}

function readTargets(defaultTag: string): Target[] {
  const encoded = process.env.BENCH_TARGETS;
  const values = encoded
    ? (JSON.parse(encoded) as Target[])
    : [
        {
          tag: defaultTag,
          baseUrl: `http://127.0.0.1:${process.env.BENCH_PORT ?? "5199"}`,
          inspectorUrl: `http://127.0.0.1:${process.env.BENCH_INSPECTOR_PORT ?? "9239"}`,
          revision: process.env.BENCH_REVISION ?? "unknown",
          source: process.env.BENCH_SOURCE ?? "working tree",
          sourceSha256: process.env.BENCH_SOURCE_SHA256 ?? "unknown",
          dirty: process.env.BENCH_DIRTY === "true",
          stateSha256: process.env.BENCH_STATE_SHA256,
          patchSha256: process.env.BENCH_PATCH_SHA256,
        },
      ];
  if (values.length === 0 || values.length > 2) {
    throw new Error("BENCH_TARGETS must contain one or two targets.");
  }
  if (new Set(values.map(({ tag }) => tag)).size !== values.length) {
    throw new Error("Benchmark target tags must be unique.");
  }
  for (const target of values) {
    validateLocalUrl(target.baseUrl, "benchmark");
    validateLocalUrl(target.inspectorUrl, "inspector");
    if (!target.revision) {
      throw new Error(`Missing revision for ${target.tag}.`);
    }
    if (!target.sourceSha256) {
      throw new Error(`Missing source hash for ${target.tag}.`);
    }
  }
  return values;
}

function validateLocalUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`The ${label} URL must use local HTTP.`);
  }
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

async function fetchRun(target: Target, scenario: Scenario, n: number): Promise<RunResult> {
  const response = await fetch(`${target.baseUrl}/run?case=${scenario}&n=${n}`);
  if (!response.ok) {
    throw new Error(`${target.tag}/${scenario} failed: ${await response.text()}`);
  }
  return response.json() as Promise<RunResult>;
}

function hasUnexpectedStatus(status: Status): boolean {
  return Object.keys(status).some((code) => Number(code) >= 300);
}
