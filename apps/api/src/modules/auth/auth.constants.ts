import type { CookieOptions } from 'express';
import { loadEnv } from '../../config/env';

/**
 * Le cookie de session. En HTTPS, il porte le préfixe `__Host-` : le
 * navigateur ne l'accepte que Secure, posé par ce seul hôte, pour tout le
 * site. Un sous-domaine compromis ne peut ni le poser ni le remplacer.
 */
export const SESSION_COOKIE = loadEnv().COOKIE_SECURE ? '__Host-tg_session' : 'tg_session';

/**
 * La connexion par code en cours, le temps de saisir le code (ADR-0204) :
 * mêmes attributs que la session, une heure au plus.
 */
export const ATTENTE_COOKIE = loadEnv().COOKIE_SECURE ? '__Host-tg_attente' : 'tg_attente';

/**
 * Le défi d'une clé d'accès, le temps de répondre à l'appareil (ADR-0247) :
 * mêmes attributs que la session, cinq minutes au plus.
 */
export const DEFI_COOKIE = loadEnv().COOKIE_SECURE ? '__Host-tg_defi' : 'tg_defi';

/** L'en-tête des relevés automatiques de la page : ils ne prolongent pas la session. */
export const EN_ARRIERE_PLAN = 'x-arriere-plan';

/**
 * Comment le cookie se pose, et s'efface (les mêmes attributs, sans quoi le
 * navigateur garde l'ancien). Illisible par le script de la page ; envoyé
 * seulement depuis le site lui-même (SameSite strict) : un autre site ne
 * peut pas faire agir une session à l'insu de son titulaire.
 */
export function optionsDuCookie(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: loadEnv().COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}
