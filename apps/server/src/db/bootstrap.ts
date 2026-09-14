import { loadRuntimeSecrets } from "../lib/secrets";

if (import.meta.main) {
  await loadRuntimeSecrets();
  const { createRuntimeStore } = await import("./client");
  const database = createRuntimeStore();
  try {
    await database.store.accounts.seed({ bootstrapKey: process.env.POSTPLAN_BOOTSTRAP_API_KEY });
    console.log("Bootstrap accounts initialized.");
  } finally {
    database.close();
  }
}
