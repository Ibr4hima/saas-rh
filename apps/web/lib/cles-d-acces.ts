import type {
  OptionsDeConnexion,
  OptionsDeCreation,
  ReponseDeConnexion,
  ReponseDeCreation,
} from '@teranga/contracts';

/* ────────────────────────────────────────────────────────────────
   Les clés d'accès dans le navigateur (ADR-0247) : Face ID, Touch ID,
   l'empreinte ou le code de l'appareil. Le navigateur et le système
   gardent la clé ; la page ne fait que passer le défi du serveur à
   l'appareil, et sa réponse au serveur.
   ──────────────────────────────────────────────────────────────── */

/** Le navigateur sait créer et présenter des clés d'accès (et la page est servie en HTTPS, ou en local). */
export function clesPossibles(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function'
  );
}

const versOctets = (b64: string): ArrayBuffer => {
  const brut = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i);
  return octets.buffer;
};

const versTexte = (tampon: ArrayBuffer): string => {
  let brut = '';
  for (const o of new Uint8Array(tampon)) brut += String.fromCharCode(o);
  return btoa(brut).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Crée une clé sur cet appareil : le système demande Face ID, l'empreinte ou le code. */
export async function creerUneCle(o: OptionsDeCreation): Promise<ReponseDeCreation> {
  const cle = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: versOctets(o.challenge),
      user: { ...o.user, id: versOctets(o.user.id) },
      pubKeyCredParams: o.pubKeyCredParams,
      excludeCredentials: o.excludeCredentials.map((c) => ({
        type: c.type,
        id: versOctets(c.id),
        transports: c.transports as AuthenticatorTransport[],
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cle) throw new DOMException('Aucune clé créée', 'NotAllowedError');
  const r = cle.response as AuthenticatorAttestationResponse;
  return {
    id: cle.id,
    rawId: versTexte(cle.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: versTexte(r.clientDataJSON),
      attestationObject: versTexte(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
    authenticatorAttachment:
      (cle.authenticatorAttachment as 'platform' | 'cross-platform' | null) ?? null,
  };
}

/** Présente une clé de cet appareil, ou d'un téléphone à côté : le système demande laquelle. */
export async function presenterUneCle(o: OptionsDeConnexion): Promise<ReponseDeConnexion> {
  const cle = (await navigator.credentials.get({
    publicKey: {
      challenge: versOctets(o.challenge),
      rpId: o.rpId,
      timeout: o.timeout,
      userVerification: o.userVerification,
      allowCredentials: [],
    },
  })) as PublicKeyCredential | null;
  if (!cle) throw new DOMException('Aucune clé présentée', 'NotAllowedError');
  const r = cle.response as AuthenticatorAssertionResponse;
  return {
    id: cle.id,
    rawId: versTexte(cle.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: versTexte(r.clientDataJSON),
      authenticatorData: versTexte(r.authenticatorData),
      signature: versTexte(r.signature),
      userHandle: r.userHandle ? versTexte(r.userHandle) : null,
    },
    authenticatorAttachment:
      (cle.authenticatorAttachment as 'platform' | 'cross-platform' | null) ?? null,
  };
}

/** La personne a fermé la fenêtre du système, ou n'a pas répondu à temps. */
export const gesteAnnule = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** L'appareil garde déjà une clé de ce compte. */
export const cleDejaSurLAppareil = (e: unknown): boolean =>
  e instanceof DOMException && e.name === 'InvalidStateError';

/**
 * Ce navigateur s'est déjà connecté avec une clé, ou en a créé une : la
 * connexion la propose d'abord. Une commodité de l'appareil seulement ;
 * rien de secret n'y est écrit.
 */
const SOUVENIR = 'teranga-cle-d-acces';

export function appareilAvecCle(): boolean {
  try {
    return window.localStorage.getItem(SOUVENIR) === '1';
  } catch {
    return false;
  }
}

export function retenirLAppareil(avecCle: boolean): void {
  try {
    if (avecCle) window.localStorage.setItem(SOUVENIR, '1');
    else window.localStorage.removeItem(SOUVENIR);
  } catch {
    // Stockage refusé (navigation privée) : la connexion propose le code d'abord.
  }
}
