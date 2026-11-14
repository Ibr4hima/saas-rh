import type { Problem } from '@teranga/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}

/** Client API unique : cookies de session inclus, erreurs RFC 9457 typées. */
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    keepalive?: boolean;
    /**
     * Un relevé automatique (la cloche, les compteurs) : il ne compte pas
     * comme une activité, et ne garde pas la session ouverte.
     */
    arrierePlan?: boolean;
  } = {},
): Promise<T> {
  // Un fichier part TEL QUEL, avec son propre type. L'encoder en base64 dans
  // du JSON ajouterait un tiers de volume à l'aller et autant de travail au
  // retour — sensible dès quelques mégaoctets, inacceptable à quatre-vingts.
  const binaire = options.body instanceof Blob;
  const res = await fetch(`${API_BASE}/v1${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal: options.signal,
    // Une requête qui doit partir même si l'onglet se ferme.
    keepalive: options.keepalive,
    headers: {
      ...(binaire
        ? { 'Content-Type': (options.body as Blob).type || 'application/octet-stream' }
        : options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      ...(options.arrierePlan ? { 'X-Arriere-Plan': '1' } : {}),
    },
    body: binaire
      ? (options.body as Blob)
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  if (!res.ok) throw await erreurDe(res);
  // Un corps VIDE est une réponse valable, et pas seulement en 204 : une route
  // qui ne rend rien — un enregistrement, une suppression — répond 200 sans
  // contenu, et `res.json()` lève alors une erreur de syntaxe que l'appelant
  // prend pour une panne. L'écran affichait « Enregistrement impossible »
  // après un enregistrement réussi.
  const corps = await res.text();
  return (corps ? JSON.parse(corps) : undefined) as T;
}

/** L'erreur d'une réponse refusée, telle que l'API l'a dite ; à défaut, son statut. */
export async function erreurDe(res: Response): Promise<ApiError> {
  try {
    return new ApiError((await res.json()) as Problem);
  } catch {
    return new ApiError({ type: 'about:blank', title: `Erreur ${res.status}`, status: res.status });
  }
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.problem.status === 401;
}

/** URL absolue d'une route API — pour les téléchargements directs (PDF…). */
export function apiUrl(path: string): string {
  return `${API_BASE}/v1${path}`;
}
