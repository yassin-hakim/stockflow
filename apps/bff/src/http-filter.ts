import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { UpstreamError } from './upstream';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ headers: Record<string, string | undefined> }>();
    const response = ctx.getResponse<{ setHeader: (name: string, value: string) => void; status: (status: number) => { json: (body: unknown) => void } }>();
    const requestId = request.headers['x-request-id'] ?? crypto.randomUUID();
    const status = error instanceof UpstreamError ? error.status : error instanceof HttpException ? 400 : 500;
    const code = error instanceof UpstreamError ? error.code : error instanceof HttpException ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
    const message = error instanceof UpstreamError || error instanceof HttpException ? error.message : 'Unexpected server error.';
    response.setHeader('X-Request-ID', requestId);
    response.status(status).json({ error: { code, message, requestId } });
  }
}
