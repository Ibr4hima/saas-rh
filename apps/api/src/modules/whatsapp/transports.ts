import type { Env } from '../../config/env';
import { TransportSmtp, type Transport } from '../courriels/transports';

/* Comment un message WhatsApp quitte la plateforme.

   Meta : l'API WhatsApp Cloud. Une organisation n'écrit pas la première à
   quelqu'un sur WhatsApp avec un texte libre : elle envoie un MODÈLE que Meta
   a approuvé, dont elle remplit les blancs. Deux modèles suffisent :
   « notification_rh » (Bonjour {{1}}, {{2}}, et un bouton vers la page) et
   « code_verification » (le code qui prouve que le numéro est bien le sien).

   Boîte : en développement, chaque message arrive dans Mailpit comme un
   courriel adressé au numéro. Rien ne part, et l'on peut lire le code. */

export type MessageWhatsApp =
  | {
      modele: 'notification';
      /** Le numéro, au format international (+221771234567). */
      to: string;
      prenom: string;
      texte: string;
      /** Le chemin de la page, sans le domaine (« moi/conges »). */
      chemin: string;
    }
  | { modele: 'code'; to: string; code: string };

export interface TransportWhatsApp {
  readonly nom: string;
  envoyer(m: MessageWhatsApp): Promise<void>;
}

/** Un refus que réessayer ne changera pas : le numéro n'a pas WhatsApp, le modèle manque. */
export class RefusDefinitif extends Error {}

export class TransportMeta implements TransportWhatsApp {
  readonly nom = 'meta';

  constructor(
    private readonly o: {
      token: string;
      phoneNumberId: string;
      version: string;
      langue: string;
      modeleNotification: string;
      modeleCode: string;
    },
    private readonly appeler: typeof fetch = fetch,
  ) {}

  async envoyer(m: MessageWhatsApp): Promise<void> {
    const texte = (t: string) => ({ type: 'text', text: t });
    const template =
      m.modele === 'notification'
        ? {
            name: this.o.modeleNotification,
            language: { code: this.o.langue },
            components: [
              { type: 'body', parameters: [texte(m.prenom), texte(m.texte)] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [texte(m.chemin)] },
            ],
          }
        : {
            // Modèle d'authentification : le code dans le corps et dans le
            // bouton « Copier le code ».
            name: this.o.modeleCode,
            language: { code: this.o.langue },
            components: [
              { type: 'body', parameters: [texte(m.code)] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [texte(m.code)] },
            ],
          };
    const r = await this.appeler(
      `https://graph.facebook.com/${this.o.version}/${encodeURIComponent(this.o.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.o.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: m.to.replace(/^\+/, ''),
          type: 'template',
          template,
        }),
      },
    );
    if (r.ok) return;
    const detail = await r.text().catch(() => '');
    const message = `WhatsApp : envoi refusé (${r.status}) ${detail.slice(0, 200)}`.trim();
    // 400 : la requête elle-même (numéro sans WhatsApp, modèle absent) ;
    // 401, 429, 5xx : le jeton, le débit ou Meta, qu'un essai suivant peut passer.
    if (r.status === 400 || r.status === 404) throw new RefusDefinitif(message);
    throw new Error(message);
  }
}

/** En développement : le message arrive dans Mailpit, adressé au numéro. */
export class TransportBoite implements TransportWhatsApp {
  readonly nom = 'boite';

  constructor(
    private readonly courriel: Transport,
    private readonly portail: string,
  ) {}

  async envoyer(m: MessageWhatsApp): Promise<void> {
    const corps =
      m.modele === 'notification'
        ? `Bonjour ${m.prenom}, ${m.texte}\n\n${this.portail}/${m.chemin}`
        : `${m.code} est votre code de vérification.`;
    await this.courriel.envoyer({
      from: 'WhatsApp <whatsapp@boite.local>',
      to: `${m.to.replace(/^\+/, '')}@whatsapp.local`,
      subject: `WhatsApp ${m.to} : ${m.modele === 'notification' ? m.texte : 'code de vérification'}`,
      text: corps,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${corps
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</pre>`,
    });
  }
}

/**
 * Le transport que la configuration demande ; `null` : WhatsApp ne s'offre
 * pas. Les tests n'envoient jamais rien, quel que soit le `.env`.
 */
export function transportWhatsAppDepuisEnv(env: Env): TransportWhatsApp | null {
  if (env.NODE_ENV === 'test') return null;
  const choix = env.WHATSAPP_TRANSPORT ?? (env.NODE_ENV === 'development' ? 'boite' : 'aucun');
  if (choix === 'meta') {
    return new TransportMeta({
      token: env.WHATSAPP_TOKEN!,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
      version: env.WHATSAPP_API_VERSION,
      langue: env.WHATSAPP_LANGUE,
      modeleNotification: env.WHATSAPP_MODELE_NOTIFICATION,
      modeleCode: env.WHATSAPP_MODELE_CODE,
    });
  }
  if (choix === 'boite') {
    return new TransportBoite(
      new TransportSmtp({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      }),
      env.PUBLIC_WEB_URL.replace(/\/$/, ''),
    );
  }
  return null;
}
