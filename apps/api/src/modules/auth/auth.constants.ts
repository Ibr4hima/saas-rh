import type { CookieOptions } from 'express';
import { loadEnv } from '../../config/env';

/**
 * Le cookie de session. En HTTPS, il porte le préfixe `__Host-` : le
 * navigateur ne l'accepte que Secure, posé par ce seul hôte, pour tout le
 * site. Un sous-domaine compromis ne peut ni le poser ni le remplacer.
 */
export const SESSION_COOKIE = loadEnv().COOKIE_SECURE ? '__Host-tg_session' : 'tg_session';

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
