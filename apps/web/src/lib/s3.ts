import { config } from "#config";
import { s3Storage } from "@postplan/lambda/storage";

export const { assertStorageConfigured, putHtmlObject, getHtmlObject } = s3Storage(config.s3);
