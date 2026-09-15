// Seeds the benchmark Worker, then CPU-profiles each case through the inspector.
// Usage: node profile.mjs <tag> [case,case...]
import { mkdir, writeFile } from "node:fs/promises";

// Requests per profiled batch. Larger cases use fewer requests to keep batches short.
export const PLAN = {
  healthz: 400,
  home: 300,
  dashboard: 150,
  list: 300,
  public: 400,
  upload: 150,
  uploadLarge: 20,
};

const [tag, only] = process.argv.slice(2);
if (!tag) {
  throw new Error("Usage: node profile.mjs <tag> [case,case...]");
}
const port = process.env.BENCH_PORT || "5199";
const inspector = process.env.BENCH_INSPECTOR_PORT || "9239";
const base = `http://127.0.0.1:${port}`;
const output = new URL(`./results/${tag}/`, import.meta.url);
await mkdir(output, { recursive: true });

const seeded = await fetch(`${base}/seed`);
if (!seeded.ok) {
  throw new Error(`Seed failed: ${await seeded.text()}`);
}

const targets = await (await fetch(`http://127.0.0.1:${inspector}/json/list`)).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl, {
  headers: { Origin: `http://127.0.0.1:${inspector}` },
});
let sequence = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    message.error ? waiter.reject(message.error) : waiter.resolve(message.result);
  }
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 });

const summary = {};
for (const [name, n] of Object.entries(PLAN)) {
  if (only && !only.split(",").includes(name)) {
    continue;
  }
  const warm = await (await fetch(`${base}/run?case=${name}&n=${Math.ceil(n / 3)}`)).json();
  const batches = [];
  for (let batch = 0; batch < 3; batch++) {
    await send("Profiler.start");
    const result = await (await fetch(`${base}/run?case=${name}&n=${n}`)).json();
    const { profile } = await send("Profiler.stop");
    if (Object.keys(result.status).some((status) => Number(status) >= 300)) {
      console.log(name, "unexpected status", JSON.stringify(result));
    }
    if (batch === 0) {
      await writeFile(new URL(`./${name}.cpuprofile`, output), JSON.stringify(profile));
    }
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    let busy = 0;
    profile.samples.forEach((id, index) => {
      const fn = nodes.get(id).callFrame.functionName;
      if (fn !== "(idle)" && fn !== "(program)") {
        busy += profile.timeDeltas[index];
      }
    });
    batches.push(busy / 1000 / n);
  }
  batches.sort((a, b) => a - b);
  summary[name] = { n, busyMsMedian: batches[1], batches, status: warm.status };
  console.log(
    name.padEnd(12),
    "busy ms/req",
    batches.map((value) => value.toFixed(2)).join(" "),
    "status",
    JSON.stringify(warm.status),
  );
}
await writeFile(new URL("./summary.json", output), JSON.stringify(summary, null, 2) + "\n");
// The inspector socket keeps Node alive.
process.exit(0);
