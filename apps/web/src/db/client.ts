import { config } from "#config";
import { createRuntimeStore as createStore } from "@postplan/lambda/store";
export const createRuntimeStore = () => createStore(config);
