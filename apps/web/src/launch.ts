import { loadRuntimeSecrets } from "./lib/secrets";

if (import.meta.main) {
  try {
    await loadRuntimeSecrets();
    const { main } = await import("./index");
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
