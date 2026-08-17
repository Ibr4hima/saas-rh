/**
 * Erreurs RFC 9457 (`application/problem+json`) — ADR-0006.
 * Chaque erreur porte un `code` stable, documenté, jamais renommé.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

export class ProblemException extends HttpException {
  constructor(
    readonly problem: {
      status: number;
      title: string;
      code: string;
      detail?: string;
    },
  ) {
    super(problem.title, problem.status);
  }
}

export function problem(status: number, code: string, title: string, detail?: string): never {
  throw new ProblemException({ status, code, title, detail });
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Erreur interne';
    let code = 'internal_error';
    let detail: string | undefined;

    if (exception instanceof ProblemException) {
      status = exception.problem.status;
      title = exception.problem.title;
      code = exception.problem.code;
      detail = exception.problem.detail;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      title = exception.message;
      code = `http_${status}`;
    } else if (process.env.NODE_ENV !== 'production') {
      detail = exception instanceof Error ? exception.message : String(exception);
    }

    if (status >= 500) {
      // Les erreurs serveur sont loggées, jamais détaillées au client en prod.
      console.error(exception);
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title, status, code, ...(detail ? { detail } : {}) });
  }
}
