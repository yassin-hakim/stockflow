import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { OperationError } from "../domain/operations";
@Injectable()
export class InventoryQueryValidation implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context
      .switchToHttp()
      .getRequest<{
        method: string;
        path: string;
        query: Record<string, unknown>;
      }>();
    let allowed: string[] = [];
    if (request.method === "GET") {
      if (
        request.path === "/stock" ||
        request.path === "/replenishment" ||
        request.path === "/replenishment-rules"
      )
        allowed = ["locationId"];
      if (/^\/stock\/[^/]+\/movements$/.test(request.path))
        allowed = ["locationId", "cause", "from", "to", "cursor", "limit"];
      if (
        ["/receipts", "/transfers", "/waste", "/counts"].includes(request.path)
      )
        allowed = ["locationId", "from", "to", "cursor", "limit"];
      if (request.path === "/operations")
        allowed = ["kind", "locationId", "from", "to", "cursor", "limit"];
      if (request.path === "/reports/inventory")
        allowed = [
          "locationId",
          "productId",
          "cause",
          "from",
          "to",
          "cursor",
          "limit",
        ];
    }
    if (
      Object.entries(request.query).some(
        ([key, value]) => !allowed.includes(key) || typeof value !== "string",
      )
    )
      throw new OperationError(
        "INVALID_REQUEST",
        "Unknown or repeated query parameter.",
      );
    return next.handle();
  }
}
