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

const TITRES_HTTP: Record<number, string> = {
  400: 'Informations invalides',
  401: 'Authentification requise',
  403: 'Vous n’avez pas les droits nécessaires pour cette action',
  404: 'Adresse introuvable',
  405: 'Méthode non permise',
  409: 'Cette action n’est plus possible : rechargez la page',
  413: 'Envoi trop volumineux',
  415: 'Format de requête non pris en charge',
  429: 'Trop de requêtes, réessayez dans un instant',
};

/** Statut 4xx d'une erreur du body-parser express, ou null si autre chose. */
function bodyParserStatus(err: unknown): number | null {
  const e = err as { statusCode?: unknown; status?: unknown };
  const status = typeof e?.statusCode === 'number' ? e.statusCode : e?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

/**
 * La base est momentanément indisponible ou saturée (ADR-0067) : requête
 * arrêtée par son délai, verrou attendu trop longtemps, base qui redémarre,
 * connexion perdue, aucune connexion libre dans le pool. Ce n'est pas une
 * faute du code : on répond 503, réessayable, plutôt que 500.
 */
const CODES_PASSAGERS = new Set([
  '57014', // requête annulée (délai dépassé)
  '55P03', // verrou non obtenu à temps
  '57P01', // base arrêtée par l'administrateur
  '57P02', // base en arrêt d'urgence
  '57P03', // base pas encore prête
  '53300', // trop de connexions
  '08000', // connexion
  '08003', // connexion inexistante
  '08006', // connexion perdue
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

export function indisponibilitePassagere(exception: unknown): boolean {
  const e = exception as { code?: unknown; message?: unknown; cause?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (typeof e.code === 'string' && CODES_PASSAGERS.has(e.code)) return true;
  if (
    typeof e.message === 'string' &&
    /timeout exceeded when trying to connect|Connection terminated/.test(e.message)
  ) {
    return true;
  }
  // Drizzle enveloppe l'erreur du pilote : la cause dit ce qui s'est passé.
  return e.cause !== undefined && e.cause !== exception && indisponibilitePassagere(e.cause);
}

/**
 * Une erreur de base de données porte la requête ET ses valeurs : Drizzle
 * les écrit dans son message (« params: … »), soit, sur un dépôt de
 * candidature, le nom, l'adresse et le CV entier. Le journal n'en garde que
 * la requête et la cause ; les valeurs, jamais.
 */
export function pourLeJournal(exception: unknown): unknown {
  const e = exception as {
    name?: string;
    query?: unknown;
    params?: unknown;
    message?: unknown;
    cause?: { code?: string; constraint?: string; table?: string; message?: string };
  } | null;
  const avecValeurs =
    e !== null &&
    typeof e === 'object' &&
    ('params' in e || (typeof e.message === 'string' && e.message.includes('\nparams:')));
  if (!avecValeurs) return exception;
  return {
    name: e.name,
    query: typeof e.query === 'string' ? e.query : undefined,
    code: e.cause?.code,
    constraint: e.cause?.constraint,
    table: e.cause?.table,
    cause: e.cause?.message,
  };
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    // La réponse est déjà partie : un corps coupé après son 408 (cf.
    // `bornerLeCorps`), dont la lecture échoue ensuite. Rien à y ajouter.
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Une erreur est survenue, réessayez dans un instant';
    let code = 'internal_error';
    let detail: string | undefined;

    if (exception instanceof ProblemException) {
      status = exception.problem.status;
      title = exception.problem.title;
      code = exception.problem.code;
      detail = exception.problem.detail;
    } else if (exception instanceof HttpException) {
      // Les erreurs que Nest lève de lui-même parlent anglais (« Cannot GET »,
      // « Validation failed (uuid is expected) ») : l'utilisateur lit le
      // titre français de leur statut.
      status = exception.getStatus();
      title = TITRES_HTTP[status] ?? 'Requête impossible';
      code = `http_${status}`;
    } else if (indisponibilitePassagere(exception)) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      title = 'Service momentanément indisponible';
      code = 'service.indisponible';
      detail = 'Réessayez dans un instant.';
      res.setHeader('Retry-After', '5');
    } else if (bodyParserStatus(exception) !== null) {
      // Erreurs du body-parser express (corps trop gros, JSON malformé…) :
      // elles portent un statusCode 4xx et ne sont pas des erreurs internes.
      status = bodyParserStatus(exception)!;
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        title = 'Envoi trop volumineux';
        code = 'request.payload_too_large';
      } else {
        title = 'Envoi illisible, réessayez';
        code = 'request.malformed_body';
      }
    } else if (process.env.NODE_ENV !== 'production' && pourLeJournal(exception) === exception) {
      detail = exception instanceof Error ? exception.message : String(exception);
    }

    if (status >= 500) {
      // Les erreurs serveur sont loggées, jamais détaillées au client en prod.
      console.error(pourLeJournal(exception));
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title, status, code, ...(detail ? { detail } : {}) });
  }
}
