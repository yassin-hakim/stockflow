import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MongoError } from 'mongodb';
import { StockError } from '../domain/stock';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ headers: Record<string, string | undefined> }>();
    const response = ctx.getResponse<{ setHeader: (name: string, value: string) => void; status: (status: number) => { json: (body: unknown) => void } }>();
    const requestId = request.headers['x-request-id'] || randomUUID();
    let status = 500, code = 'INTERNAL_ERROR', message = 'Unexpected server error.';
    if (error instanceof StockError) {
      code = error.code; message = error.message;
      status = ['PRODUCT_NOT_FOUND', 'INVENTORY_NOT_FOUND'].includes(code) ? 404 : code === 'INVALID_QUANTITY' ? 422 : ['INSUFFICIENT_STOCK', 'STOCK_LIMIT_EXCEEDED', 'IDEMPOTENCY_CONFLICT'].includes(code) ? 409 : code === 'UPSTREAM_UNAVAILABLE' ? 502 : 400;
    } else if (error instanceof HttpException) { status = 400; code = 'INVALID_REQUEST'; message = error.message; }
    else if (error instanceof MongoError) { status = 503; code = 'SERVICE_UNAVAILABLE'; message = 'Inventory database unavailable.'; }
    response.setHeader('X-Request-ID', requestId);
    response.status(status).json({ error: { code, message, requestId } });
  }
}
