import { getIssueMessage } from "@orpc/openapi/helpers";
import { toHttpError } from "#lib/respond";
import { messageResponse } from "./response.server.js";

// Page and form handlers render failures as HTML; thrown Responses pass through.
export async function webAction(action: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Response) return error;
    const { failure, status } = toHttpError(error);
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
