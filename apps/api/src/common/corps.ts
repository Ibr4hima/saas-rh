import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { json, raw } from 'express';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_APPLICATION,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
  MAX_FICHIER_REMIS_BYTES,
  MAX_JUSTIFICATIF_BYTES,
  MAX_REFERENCE_PDF_BYTES,
  MAX_SUPPORT_BYTES,
  MAX_VIDEO_LOCALE_BYTES,
  peut,
  type Capacite,
  type SessionUser,
} from '@teranga/contracts';
import { ProblemException } from './problem';
import { CANDIDATURES, adresseDuClient, type Limiteur } from './limiteur';

/* ────────────────────────────────────────────────────────────────
   Les corps de requête : qui peut envoyer quoi, avant d'en lire un octet.

   Un fichier ne se lit que sur la route qui l'attend, à la taille qu'elle
   attend, et seulement une fois l'envoyeur reconnu : une session ouverte
   (et l'habilitation de la route, pour les gros envois), ou, pour la
   candidature publique, une adresse sous sa limite et une place libre.
   Ailleurs, un corps JSON d'un mégaoctet au plus. Les corps compressés ne
   se décompressent pas : la limite porte sur ce qui arrive.
   ──────────────────────────────────────────────────────────────── */

const UUID = '[0-9a-fA-F-]{36}';
const KO = 1024;
const MO = 1024 * KO;

/** Un fichier en base64 dans du JSON : un tiers de plus, et de quoi porter le reste. */
const enBase64 = (octets: number) => Math.ceil((octets * 4) / 3) + 4;
const MARGE_JSON = 64 * KO;

/** Les candidatures publiques traitées en même temps, par instance. */
const CANDIDATURES_SIMULTANEES = 3;

/** 'flux' : la route lit elle-même son corps, après les gardes (la vidéo d'une leçon). */
type Analyseur = 'json' | 'pdf' | 'binaire' | 'flux';

/** Ailleurs : un JSON d'un mégaoctet au plus. */
const LIMITE_AILLEURS = MO;

interface Route {
  methode: 'POST' | 'PUT';
  chemin: RegExp;
  analyseur: Analyseur;
  limite: number;
  /** Qui l'emprunte : un compte (avec l'habilitation dite), ou le public. */
  acces: { session: true; capacite?: Capacite } | { candidature: true };
}

export const ROUTES_A_FICHIER: Route[] = [
  {
    methode: 'POST',
    chemin: /^\/v1\/public\/jobs\/[A-Za-z0-9_-]{10,64}\/apply$/,
    analyseur: 'json',
    limite: MAX_DOCUMENTS_PER_APPLICATION * enBase64(MAX_DOCUMENT_BYTES) + MARGE_JSON,
    acces: { candidature: true },
  },
  {
    methode: 'POST',
    chemin: /^\/v1\/absence-requests$/,
    analyseur: 'json',
    limite: enBase64(MAX_JUSTIFICATIF_BYTES) + MARGE_JSON,
    acces: { session: true },
  },
  {
    methode: 'POST',
    chemin: new RegExp(`^/v1/absence-requests/${UUID}/document$`),
    analyseur: 'json',
    limite: enBase64(MAX_JUSTIFICATIF_BYTES) + MARGE_JSON,
    acces: { session: true },
  },
  {
    methode: 'POST',
    chemin: new RegExp(`^/v1/employees/${UUID}/documents$`),
    analyseur: 'json',
    limite: enBase64(MAX_EMPLOYEE_DOCUMENT_BYTES) + MARGE_JSON,
    acces: { session: true },
  },
  {
    methode: 'PUT',
    chemin: new RegExp(`^/v1/employee-documents/${UUID}$`),
    analyseur: 'json',
    limite: enBase64(MAX_EMPLOYEE_DOCUMENT_BYTES) + MARGE_JSON,
    acces: { session: true },
  },
  {
    methode: 'POST',
    chemin: new RegExp(`^/v1/document-requests/${UUID}/fichiers$`),
    analyseur: 'json',
    limite: enBase64(MAX_FICHIER_REMIS_BYTES) + MARGE_JSON,
    acces: { session: true },
  },
  {
    methode: 'POST',
    chemin: /^\/v1\/employees\/import$/,
    analyseur: 'binaire',
    limite: 12 * MO,
    acces: { session: true, capacite: 'personnel.gerer' },
  },
  {
    methode: 'PUT',
    chemin: /^\/v1\/reference-texts\/[^/]+$/,
    analyseur: 'json',
    limite: 8 * MO,
    acces: { session: true, capacite: 'textes' },
  },
  {
    methode: 'POST',
    chemin: /^\/v1\/reference-texts\/[^/]+\/pdf$/,
    analyseur: 'pdf',
    limite: MAX_REFERENCE_PDF_BYTES,
    acces: { session: true, capacite: 'textes' },
  },
  {
    methode: 'POST',
    chemin: new RegExp(`^/v1/academy/lessons/${UUID}/support$`),
    analyseur: 'pdf',
    limite: MAX_SUPPORT_BYTES,
    acces: { session: true, capacite: 'academy' },
  },
  {
    methode: 'PUT',
    chemin: new RegExp(`^/v1/academy/lessons/${UUID}/video/fichier$`),
    analyseur: 'flux',
    limite: MAX_VIDEO_LOCALE_BYTES,
    acces: { session: true, capacite: 'academy' },
  },
];

const analyseur = (a: Analyseur, limite: number): RequestHandler =>
  a === 'flux'
    ? (_req, _res, next) => next()
    : a === 'json'
      ? json({ limit: limite, inflate: false })
      : a === 'pdf'
        ? raw({ type: 'application/pdf', limit: limite, inflate: false })
        : // Le classeur : c'est son contenu qui tranche, pas le type annoncé
          // (cf. le lecteur, qui reconnaît une archive en deux octets).
          raw({ type: () => true, limit: limite, inflate: false });

export interface Portier {
  limiteur: Limiteur;
  /** La session d'un cookie, ou null (cf. `AuthService.resolveSession`). */
  session: (jeton: string) => Promise<SessionUser | null>;
  cookie: string;
}

const refus = (status: number, code: string, title: string, detail?: string) =>
  new ProblemException({ status, code, title, detail });

/**
 * La porte des corps. Refusé avant la lecture, le client reçoit sa réponse
 * et la connexion se ferme : ce qu'il voulait envoyer n'est pas attendu.
 */
export function porteDesCorps(portier: Portier): RequestHandler {
  const routes = ROUTES_A_FICHIER.map((r) => ({ ...r, lire: analyseur(r.analyseur, r.limite) }));
  const ailleurs = json({ limit: LIMITE_AILLEURS });
  let candidaturesEnCours = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const refuser = (e: ProblemException) => {
      res.setHeader('Connection', 'close');
      next(e);
    };
    // Express route sans tenir compte de la casse ni d'une barre finale :
    // la porte lit le chemin de la même façon, sans quoi « …/Apply/ »
    // passerait à côté de ses limites et atteindrait la même route.
    const chemin = req.path.toLowerCase().replace(/\/+$/, '');
    const route = routes.find((r) => r.methode === req.method && r.chemin.test(chemin));
    if (!route) {
      // Annoncé trop gros, il ne se vide même pas : la réponse part tout de suite.
      if (Number(req.headers['content-length'] ?? 0) > LIMITE_AILLEURS) {
        refuser(refus(413, 'request.payload_too_large', 'Corps de requête trop volumineux'));
        return;
      }
      ailleurs(req, res, next);
      return;
    }
    void (async () => {
      // La taille annoncée, d'abord : rien à demander à la base pour ça.
      const longueur = Number(req.headers['content-length']);
      if (!req.headers['content-length'] || !Number.isFinite(longueur)) {
        return refuser(refus(411, 'request.length_required', 'Taille du fichier non annoncée'));
      }
      if (longueur > route.limite) {
        return refuser(refus(413, 'request.payload_too_large', 'Corps de requête trop volumineux'));
      }

      if ('session' in route.acces) {
        const jeton = (req.cookies as Record<string, string> | undefined)?.[portier.cookie];
        const user = jeton ? await portier.session(jeton) : null;
        if (!user) {
          return refuser(refus(401, 'auth.session_required', 'Authentification requise'));
        }
        if (route.acces.capacite && !peut(user, route.acces.capacite)) {
          return refuser(refus(403, 'auth.forbidden', 'Droits insuffisants pour cette action'));
        }
        route.lire(req, res, next);
        return;
      }

      // La candidature publique : une adresse sous sa limite, sur cette offre.
      const offre = req.path.split('/')[4]!;
      const verdict = await portier.limiteur.compter(
        CANDIDATURES,
        `${adresseDuClient(req)}|${offre}`,
      );
      if (verdict.bloque) {
        res.setHeader('Retry-After', String(verdict.reessayerDans));
        return refuser(
          refus(429, 'recruitment.too_many_requests', 'Trop de tentatives, réessayez plus tard'),
        );
      }
      // Et une place : une candidature pèse jusqu'à 35 Mo une fois lue.
      if (candidaturesEnCours >= CANDIDATURES_SIMULTANEES) {
        res.setHeader('Retry-After', '10');
        return refuser(
          refus(
            503,
            'recruitment.occupe',
            'Trop de candidatures en cours, réessayez dans un instant',
          ),
        );
      }
      candidaturesEnCours += 1;
      let libre = false;
      const liberer = () => {
        if (libre) return;
        libre = true;
        candidaturesEnCours -= 1;
      };
      res.once('finish', liberer);
      res.once('close', liberer);
      route.lire(req, res, next);
    })().catch(next);
  };
}
