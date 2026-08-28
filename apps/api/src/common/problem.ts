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

/** Statut 4xx d'une erreur du body-parser express, ou null si autre chose. */
function bodyParserStatus(err: unknown): number | null {
  const e = err as { statusCode?: unknown; status?: unknown };
  const status = typeof e?.statusCode === 'number' ? e.statusCode : e?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
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
    } else if (bodyParserStatus(exception) !== null) {
      // Erreurs du body-parser express (corps trop gros, JSON malformé…) :
      // elles portent un statusCode 4xx et ne sont pas des erreurs internes.
      status = bodyParserStatus(exception)!;
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        title = 'Corps de requête trop volumineux';
        code = 'request.payload_too_large';
      } else {
        title = 'Corps de requête illisible';
        code = 'request.malformed_body';
      }
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
