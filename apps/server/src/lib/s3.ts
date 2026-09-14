import { s3Storage } from "@postplan/lambda/storage";
import { config } from "#config";
export const { assertStorageConfigured, putHtmlObject, getHtmlObject } = s3Storage(config.s3);
