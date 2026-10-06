import { requestBodyFailure } from "@stockflow/primitives";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MongoError } from "mongodb";
import type { StockErrorCode } from "../domain/stock";
import { StockError } from "../domain/stock";
import { OperationError } from '../domain/operations';

export const STOCK_ERROR_STATUS: Record<StockErrorCode, number> = {
  PRODUCT_NOT_FOUND: 404,
  PRODUCT_ARCHIVED: 409,
  INVENTORY_NOT_FOUND: 404,
  INVALID_QUANTITY: 422,
  INSUFFICIENT_STOCK: 409,
  STOCK_LIMIT_EXCEEDED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  UPSTREAM_UNAVAILABLE: 502,
  INVALID_REQUEST: 400,
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    const response = ctx.getResponse<{
      setHeader: (name: string, value: string) => void;
      status: (status: number) => { json: (body: unknown) => void };
    }>();
    const requestId = request.headers["x-request-id"] || randomUUID();
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "Unexpected server error.";
    if (error instanceof OperationError) {
      code = error.code; message = error.message;
      status = code.endsWith('NOT_FOUND') ? 404 : code === 'INVALID_REQUEST' ? 400 : code === 'INVALID_QUANTITY' ? 422 : code === 'UPSTREAM_UNAVAILABLE' ? 502 : 409;
    } else if (error instanceof StockError) {
      code = error.code;
      message = error.message;
      status = STOCK_ERROR_STATUS[error.code];
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = "INVALID_REQUEST";
      message = error.message;
    } else if (error instanceof MongoError) {
      status = 503;
      code = "SERVICE_UNAVAILABLE";
      message = "Inventory database unavailable.";
    }
    const bodyFailure = requestBodyFailure(error);
    if (bodyFailure) {
      status = bodyFailure.status;
      code = "INVALID_REQUEST";
      message = bodyFailure.message;
    }
    response.setHeader("X-Request-ID", requestId);
    response.status(status).json({ error: { code, message, requestId } });
  }
}
