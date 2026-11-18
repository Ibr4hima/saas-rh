import { z } from 'zod';
import { DOMAINE_COURRIEL_PRO } from './employees';

/* ────────────────────────────────────────────────────────────────
   La connexion par code (ADR-0204), comme celle du vote électronique.

   On donne son nom de famille et son adresse professionnelle ; si elles
   correspondent à un compte, un code de six caractères part à cette
   adresse. Le code saisi ouvre la session : pas de mot de passe à retenir.
   ──────────────────────────────────────────────────────────────── */

/** Les caractères d'un code : la base 32 de Crockford, sans I, L, O ni U, pour ne rien confondre. */
export const ALPHABET_DU_CODE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LONGUEUR_DU_CODE = 6;

/**
 * Ce qui a été tapé, ramené au code tel qu'il est parti : en majuscules,
 * sans espace ni tiret ; O se lit 0, I et L se lisent 1.
 */
export function codeSaisi(saisie: string): string {
  return saisie.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/**
 * L'adresse professionnelle, à partir de ce qui est saisi : la partie avant
 * « @ », le domaine étant imposé. Rien de saisi : '' ; une adresse complète
 * d'un autre domaine : null.
 */
export function adresseProfessionnelle(saisie: string): string | null {
  const texte = saisie.trim().toLowerCase();
  const arobase = texte.indexOf('@');
  if (arobase !== -1 && texte.slice(arobase + 1) !== DOMAINE_COURRIEL_PRO) return null;
  const locale = arobase === -1 ? texte : texte.slice(0, arobase);
  return locale ? `${locale}@${DOMAINE_COURRIEL_PRO}` : '';
}

export const demandeDeCodeSchema = z.object({
  nom: z.string().max(80),
  /** Ce qui précède « @ » (le domaine est imposé), ou l'adresse entière. */
  email: z.string().max(254),
});
export type DemandeDeCode = z.infer<typeof demandeDeCodeSchema>;

export const saisieDuCodeSchema = z.object({ code: z.string().max(40) });
export type SaisieDuCode = z.infer<typeof saisieDuCodeSchema>;

/**
 * Ce que l'écran du code dit en tête : un code est reparti, trop de codes
 * ont été demandés, ou le dernier vient de partir.
 */
export type InfoDuCode = 'renvoye' | 'quota' | 'trop_tot';

/** La connexion en cours : l'adresse à demi cachée, et ce qu'il faut dire en tête. */
export interface AttenteDuCode {
  email: string;
  info?: InfoDuCode;
}

/** L'écran du code, rechargé : la connexion en cours, s'il y en a une. */
export type EtatDeLAttente = { enAttente: true; email: string } | { enAttente: false };
