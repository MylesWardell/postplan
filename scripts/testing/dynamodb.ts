import { registerTestStore } from "@postplan/store/testing";
import { dynamoFixture } from "@postplan/store-dynamodb/testing";
registerTestStore(async () => {
  const { store, close } = await dynamoFixture();
  return { store, close };
});
