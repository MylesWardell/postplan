const { timingSafeEqual } = require("node:crypto");
exports.handler = async (event) => {
  const expected = Buffer.from(process.env.ORIGIN_SECRET || "");
  const received = Buffer.from(event.headers?.["x-postplan-origin"] || "");
  return {
    isAuthorized:
      expected.length > 0 &&
      expected.length === received.length &&
      timingSafeEqual(expected, received),
  };
};
