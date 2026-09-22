import { config } from "#config";
import { gatewayRequest as normalize } from "@postplan/lambda/gateway";
export const gatewayRequest = (request: Request) => normalize(request, config);
