import { requestBodyFailure } from "@stockflow/primitives";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MongoError } from "mongodb";
import { ProductNotFoundError } from "../application/product-use-cases";
import { CatalogError, InvalidProductError } from "../domain/product";
import { MenuError } from '../domain/menu-item';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    const response = context.getResponse<{
      status: (status: number) => { json: (body: unknown) => void };
      setHeader: (name: string, value: string) => void;
    }>();
    const requestId = request.headers["x-request-id"] || randomUUID();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message = "Unexpected server error.";
    if (error instanceof MenuError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof CatalogError) {
      status = error.code.endsWith('NOT_FOUND') ? 404 : 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof ProductNotFoundError) {
      status = 404;
      code = "PRODUCT_NOT_FOUND";
      message = error.message;
    } else if (error instanceof InvalidProductError) {
      status = 400;
      code = "INVALID_REQUEST";
      message = error.message;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = "INVALID_REQUEST";
      message = error.message;
    } else if (error instanceof MongoError) {
      status = 503;
      code = "SERVICE_UNAVAILABLE";
      message = "Product database unavailable.";
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
