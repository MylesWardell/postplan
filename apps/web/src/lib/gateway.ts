import { gatewayRequest as normalize } from "@postplan/lambda/gateway";
import { config } from "#config";
export const gatewayRequest = (request: Request) => normalize(request, config);
