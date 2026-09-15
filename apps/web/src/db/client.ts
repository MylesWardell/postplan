import { createRuntimeStore as createStore } from "@postplan/lambda/store";
import { config } from "#config";
export const createRuntimeStore = () => createStore(config);
