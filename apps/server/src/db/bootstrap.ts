import { loadRuntimeSecrets } from "../lib/secrets";

if (import.meta.main) {
  await loadRuntimeSecrets();
  const { createRuntimeDatabase } = await import("./client");
  const { seedAccounts } = await import("../routers/account-store");
  const database = createRuntimeDatabase();
  try {
    await seedAccounts(database.db, process.env.POSTPLAN_BOOTSTRAP_API_KEY);
    console.log("Bootstrap accounts initialized.");
  } finally {
    database.close();
  }
}
