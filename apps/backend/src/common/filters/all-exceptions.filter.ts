/**
 * AllExceptionsFilter — the app-wide catch-all registered in main.ts
 * (`app.useGlobalFilters(new AllExceptionsFilter())`). Every response the
 * API ever sends for a thrown error goes through here, so its job is
 * narrow but important: always return the same JSON shape, and never leak
 * internals.
 *
 * TWO DIFFERENT KINDS OF "ERROR", HANDLED DIFFERENTLY:
 * - HttpException (BadRequestException, ForbiddenException, NotFoundException,
 *   etc. — everything every module in this codebase throws deliberately)
 *   is an INTENDED, safe-to-show response. Its own status and message are
 *   exactly what the throwing code meant the client to see, so they're
 *   used as-is, in every environment.
 * - Anything else (a genuinely unexpected bug — a null dereference, a
 *   thrown plain Error, a Postgres client throwing something Supabase
 *   itself didn't wrap) is NEVER safe to show verbatim: it could contain
 *   table names, query fragments, file paths, or other internals. This
 *   always becomes a 500, the full stack is always logged server-side via
 *   Nest's own Logger, and the client only gets the stack/raw message
 *   when NODE_ENV !== 'production' — in production it gets a fixed,
 *   generic message no matter what actually broke.
 */

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  /**
   * A packages/types ErrorCode value when the throwing code provided one
   * (`throw new SomeException({ message, error: ErrorCode.X })`), otherwise
   * falls back to the exception's class name (e.g. "NotFoundException").
   * Kept as `string`, not `ErrorCode`, because that fallback is a real,
   * valid value here too — only some throw sites have a structured code.
   */
  error: string;
  message: string | string[];
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = exception instanceof HttpException
      ? this.buildHttpExceptionBody(exception)
      : this.buildUnknownExceptionBody(exception, request);

    response.status(body.statusCode).json(body);
  }

  /** HttpException — status and message are exactly what the throwing code intended the client to see; used as-is regardless of environment. */
  private buildHttpExceptionBody(exception: HttpException): ErrorResponseBody {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    // Nest's built-in exceptions (and every custom one in this codebase)
    // already respond with `{ statusCode, message, error }` — reuse those
    // fields when present (this is also what preserves class-validator's
    // array-of-strings `message` on a 400 from the global ValidationPipe)
    // rather than re-deriving them.
    let message: string | string[] = exception.message;
    let error: string = exception.name;

    if (payload && typeof payload === 'object') {
      const payloadObject = payload as Record<string, unknown>;
      if (typeof payloadObject.message === 'string' || Array.isArray(payloadObject.message)) {
        message = payloadObject.message as string | string[];
      }
      if (typeof payloadObject.error === 'string') {
        error = payloadObject.error;
      }
    } else if (typeof payload === 'string') {
      message = payload;
    }

    return { statusCode, message, error, timestamp: new Date().toISOString() };
  }

  /** Anything that isn't an HttpException — an unexpected bug, always a 500, never shown verbatim to the client. */
  private buildUnknownExceptionBody(exception: unknown, request: Request): ErrorResponseBody {
    const stack = exception instanceof Error ? exception.stack : undefined;
    const rawMessage = exception instanceof Error ? exception.message : String(exception);

    // Always logged server-side, full detail, regardless of environment —
    // "never expose to client" is about the RESPONSE body, not the logs.
    this.logger.error(`Unhandled exception on ${request.method} ${request.url}: ${rawMessage}`, stack);

    const isProduction = process.env.NODE_ENV === 'production';

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProduction ? 'Internal server error' : rawMessage,
      error: 'Internal Server Error',
      timestamp: new Date().toISOString(),
    };
  }
}
