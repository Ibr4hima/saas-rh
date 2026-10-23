import { createTransport } from 'nodemailer';
import type { Env } from '../../config/env';

/* ────────────────────────────────────────────────────────────────
   Comment un courriel quitte la plateforme.

   SMTP : en développement, Mailpit (localhost:1025) les garde tous dans une
   boîte de test, rien ne sort ; ailleurs, tout serveur SMTP.

   Microsoft Graph : Microsoft 365. L'APIX envoie depuis une de ses boîtes
   (rh@apix.sn), au nom d'une application enregistrée dans Entra ID qui n'a
   que le droit d'envoyer, et seulement depuis cette boîte. Pas de mot de
   passe de boîte dans la plateforme : un secret d'application, révocable.
   ──────────────────────────────────────────────────────────────── */

export interface Courriel {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Aucune réponse automatique à un courriel de la plateforme : ni absence du
 * bureau, ni accusé de lecture (RFC 3834, et Exchange). Une réponse écrite à
 * la main, aucun en-tête ne l'empêche : c'est la boîte d'envoi qui la refuse
 * (ADR-0031).
 */
export const SANS_REPONSE_AUTOMATIQUE = {
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'All',
} as const;

export interface Transport {
  readonly nom: string;
  envoyer(c: Courriel): Promise<void>;
}

export class TransportSmtp implements Transport {
  readonly nom = 'smtp';
  private readonly smtp: ReturnType<typeof createTransport>;

  constructor(o: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  }) {
    this.smtp = createTransport({
      host: o.host,
      port: o.port,
      secure: o.secure,
      auth: o.user ? { user: o.user, pass: o.password ?? '' } : undefined,
      // Un serveur qui ne répond pas ne retient pas l'expéditeur : le
      // courriel réessaiera plus tard.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async envoyer(c: Courriel): Promise<void> {
    await this.smtp.sendMail({
      from: c.from,
      to: c.to,
      subject: c.subject,
      text: c.text,
      html: c.html,
      headers: SANS_REPONSE_AUTOMATIQUE,
    });
  }
}

export class TransportGraph implements Transport {
  readonly nom = 'graph';
  private jeton: { valeur: string; expire: number } | null = null;

  constructor(
    private readonly o: {
      tenantId: string;
      clientId: string;
      clientSecret: string;
      sender: string;
    },
    private readonly appeler: typeof fetch = fetch,
  ) {}

  /** Un jeton d'application, gardé jusqu'à une minute de son expiration. */
  private async jetonValide(): Promise<string> {
    if (this.jeton && this.jeton.expire > Date.now() + 60_000) return this.jeton.valeur;
    const r = await this.appeler(
      `https://login.microsoftonline.com/${encodeURIComponent(this.o.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.o.clientId,
          client_secret: this.o.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      },
    );
    if (!r.ok) throw new Error(`Microsoft Entra : jeton refusé (${r.status})`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.jeton = { valeur: j.access_token, expire: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async envoyer(c: Courriel): Promise<void> {
    const r = await this.appeler(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.o.sender)}/sendMail`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.jetonValide()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: c.subject,
            body: { contentType: 'HTML', content: c.html },
            toRecipients: [{ emailAddress: { address: c.to } }],
            // Graph n'accepte que les en-têtes « X- ».
            internetMessageHeaders: [
              {
                name: 'X-Auto-Response-Suppress',
                value: SANS_REPONSE_AUTOMATIQUE['X-Auto-Response-Suppress'],
              },
            ],
          },
          saveToSentItems: false,
        }),
      },
    );
    if (r.status === 401) this.jeton = null;
    if (r.status !== 202) {
      const detail = await r.text().catch(() => '');
      throw new Error(
        `Microsoft Graph : envoi refusé (${r.status}) ${detail.slice(0, 200)}`.trim(),
      );
    }
  }
}

/** L'adresse d'un expéditeur écrit « Nom <adresse> », ou l'adresse seule. */
export function adresseDe(expediteur: string): string {
  return /<([^>]+)>/.exec(expediteur)?.[1]?.trim() ?? expediteur.trim();
}

/**
 * Le transport que la configuration demande ; `null` : rien ne part. Par
 * défaut, Mailpit en développement, rien ailleurs. Les tests n'envoient
 * jamais rien, quel que soit le `.env` : ils passent leur propre transport.
 */
export function transportDepuisEnv(env: Env): Transport | null {
  if (env.NODE_ENV === 'test') return null;
  const choix = env.MAIL_TRANSPORT ?? (env.NODE_ENV === 'development' ? 'smtp' : 'aucun');
  if (choix === 'smtp') {
    return new TransportSmtp({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    });
  }
  if (choix === 'graph') {
    return new TransportGraph({
      tenantId: env.GRAPH_TENANT_ID!,
      clientId: env.GRAPH_CLIENT_ID!,
      clientSecret: env.GRAPH_CLIENT_SECRET!,
      sender: env.GRAPH_SENDER ?? adresseDe(env.MAIL_FROM),
    });
  }
  return null;
}
