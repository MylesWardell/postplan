import { toORPCError, COMMON_ERROR_STATUS_MAP } from "@orpc/server";
import { getIssueMessage } from "@orpc/openapi/helpers";
import { messageResponse } from "../frontend/response.server.js";

export async function webAction(action: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Response) return error;
    const failure = toORPCError(error);
    const status =
      COMMON_ERROR_STATUS_MAP[failure.code as keyof typeof COMMON_ERROR_STATUS_MAP] ?? 500;
    if (status >= 500) console.error(error);
    return messageResponse(
      "Request could not be completed",
      status >= 500
        ? "Please try again in a moment."
        : (getIssueMessage(failure, "title") ??
            getIssueMessage(failure, "description") ??
            getIssueMessage(failure, "name") ??
            failure.message),
      status,
    );
  }
}
