import { loadRuntimeSecrets } from "../lib/secrets";

if (import.meta.main) {
  await loadRuntimeSecrets();
  const { createRuntimeStore } = await import("./client");
  const { seedAccounts } = await import("../routers/account-store");
  const database = createRuntimeStore();
  try {
    await seedAccounts(database.store, process.env.POSTPLAN_BOOTSTRAP_API_KEY);
    console.log("Bootstrap accounts initialized.");
  } finally {
    database.close();
  }
}
