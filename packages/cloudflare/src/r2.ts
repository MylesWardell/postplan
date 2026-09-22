export function r2Storage(bucket: R2Bucket) {
  return {
    async putHtml(key: string, html: string) {
      await bucket.put(key, html, {
        httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "no-store" },
      });
    },
    async getHtml(key: string) {
      const object = await bucket.get(key);
      if (!object) {
        throw new Error("HTML object not found.");
      }
      if (object.size > 512 * 1024) {
        throw new Error("HTML object exceeds storage limit.");
      }
      return object.body;
    },
  };
}
