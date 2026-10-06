import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MongoError } from "mongodb";
import { requestBodyFailure } from "@stockflow/primitives";
import { SalesError } from "../domain/sale";
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    const response = context.getResponse<{
      setHeader: (name: string, value: string) => void;
      status: (status: number) => { json: (body: unknown) => void };
    }>();
    const requestId = request.headers["x-request-id"] || randomUUID();
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "Unexpected Sales error.";
    if (error instanceof SalesError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof MongoError) {
      status = 503;
      code = "SERVICE_UNAVAILABLE";
      message = "Sales database unavailable.";
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = "INVALID_REQUEST";
      message = error.message;
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
