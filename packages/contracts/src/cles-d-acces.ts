import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────
   Les clés d'accès (ADR-0247) : Face ID, Touch ID, l'empreinte ou le code
   de l'appareil ouvrent la session, après un premier code reçu par email.

   Ce qui passe entre la page et l'API, en JSON : les octets en base64url,
   comme la norme WebAuthn les écrit (PublicKeyCredential.toJSON).
   ──────────────────────────────────────────────────────────────── */

/** Des octets en base64url, sans remplissage, d'une longueur raisonnable. */
const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

/** Les algorithmes acceptés, dans l'ordre de préférence : ES256, EdDSA, RS256 (Windows Hello). */
export const ALGORITHMES_DES_CLES = [-7, -8, -257] as const;

/** Les moyens par lesquels un appareil présente sa clé. */
export const TRANSPORTS_DES_CLES = [
  'ble',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
] as const;

/** Le temps laissé à la personne pour répondre à son appareil : deux minutes. */
export const DELAI_DE_LA_CLE_MS = 120_000;

const commun = {
  // Un identifiant de clé fait au plus 1023 octets.
  id: base64url(1400),
  rawId: base64url(1400),
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).nullish(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
};

/** La clé que l'appareil vient de créer. */
export const reponseDeCreationSchema = z.object({
  ...commun,
  response: z.object({
    clientDataJSON: base64url(4096),
    attestationObject: base64url(16384),
    transports: z.array(z.string().max(32)).max(10).optional(),
  }),
});
export type ReponseDeCreation = z.infer<typeof reponseDeCreationSchema>;

/** La clé que l'appareil présente pour ouvrir la session. */
export const reponseDeConnexionSchema = z.object({
  ...commun,
  response: z.object({
    clientDataJSON: base64url(4096),
    authenticatorData: base64url(4096),
    signature: base64url(1024),
    userHandle: base64url(256).nullish(),
  }),
});
export type ReponseDeConnexion = z.infer<typeof reponseDeConnexionSchema>;

/** Ce que l'appareil reçoit pour créer une clé (PublicKeyCredentialCreationOptionsJSON). */
export interface OptionsDeCreation {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: 'none';
  authenticatorSelection: {
    residentKey: 'required';
    requireResidentKey: true;
    userVerification: 'required';
  };
  excludeCredentials: { type: 'public-key'; id: string; transports: string[] }[];
}

/** Ce que l'appareil reçoit pour présenter une clé (PublicKeyCredentialRequestOptionsJSON). */
export interface OptionsDeConnexion {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: 'required';
  allowCredentials: [];
}
