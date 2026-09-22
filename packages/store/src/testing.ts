import type { Store } from "./index";
export interface TestStore {
  store: Store;
  close: () => void | Promise<void>;
}
export type TestStoreFactory = () => Promise<TestStore>;
let factory: TestStoreFactory | undefined;
// Test harnesses inject their provider before loading the shared application suite.
export function registerTestStore(create: TestStoreFactory) {
  factory = create;
}
export function createTestStore(): Promise<TestStore> {
  if (!factory) {
    throw new Error("No test store registered. Run the suite with a store preload.");
  }
  return factory();
}
