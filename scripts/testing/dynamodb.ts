import { dynamoFixture } from "@postplan/store-dynamodb/testing";
import { registerTestStore } from "@postplan/store/testing";
registerTestStore(async () => {
  const { store, close } = await dynamoFixture();
  return { store, close };
});
