/**
 * La politique de mot de passe — une seule liste, deux lecteurs.
 *
 * L'écran coche ces règles en direct, l'API les revalide. Si les deux
 * divergeaient, la coche verte promettrait ce que l'API refuse (ou l'inverse,
 * plus grave). Ces tests tiennent la liste ET les deux endroits où elle
 * s'applique DIFFÉREMMENT, ce qui est le vrai piège de ce module.
 */
import { describe, expect, it } from 'vitest';
import {
  acceptInvitationSchema,
  passwordDiffersFromEmail,
  passwordRulesFor,
  passwordShortfall,
  registerInputSchema,
  PASSWORD_RULES,
} from '@teranga/contracts';

const BON = 'Teranga2026!';

describe('ce qui manque au mot de passe', () => {
  it('ne dit rien quand tout est là', () => {
    expect(passwordShortfall(BON)).toBeNull();
  });

  it('nomme chaque manque, dans l’ordre de la liste affichée', () => {
    expect(passwordShortfall('motdepasselong')).toBe(
      'Le mot de passe doit comporter : une majuscule, un chiffre, un caractère spécial.',
    );
  });

  it('compte les caractères, pas les octets — un « é » vaut un caractère', () => {
    // 11 caractères : il en manque un, quoi qu'en dise la longueur en octets.
    expect(passwordShortfall('Éléphant1!x')).toContain('12 caractères minimum');
  });

  it('accepte l’espace comme caractère spécial', () => {
    expect(passwordShortfall('Mot De Passe 9')).toBeNull();
  });
});

describe('le mot de passe ne reprend pas l’identifiant', () => {
  it('repère une partie de l’adresse, pas seulement l’adresse entière', () => {
    expect(passwordDiffersFromEmail('kfaye2026!X', 'k.faye@apix.sn')).toBe(false);
    expect(passwordDiffersFromEmail('AwaDiop2026!', 'a.diop@apix.sn')).toBe(false);
  });

  it('ignore la casse', () => {
    expect(passwordDiffersFromEmail('XXDIOPxx99!', 'a.diop@apix.sn')).toBe(false);
  });

  it('laisse passer ce qui ne reprend rien', () => {
    expect(passwordDiffersFromEmail('Teranga2026!', 'k.faye@apix.sn')).toBe(true);
  });

  it('ne s’applique pas à une partie locale trop courte', () => {
    // « ab » se retrouverait dans trop de mots pour que la règle veuille dire
    // quelque chose : à deux caractères, elle ne s'applique pas.
    expect(passwordDiffersFromEmail('Fabuleux2026!', 'ab@apix.sn')).toBe(true);
    // À trois, elle exige seulement que le tout n'y figure pas.
    expect(passwordDiffersFromEmail('Xabcx2026!!', 'abc@apix.sn')).toBe(false);
    expect(passwordDiffersFromEmail('Teranga2026!', 'abc@apix.sn')).toBe(true);
  });

  it('figure dans la liste affichée, après les cinq autres', () => {
    const regles = passwordRulesFor('k.faye@apix.sn');
    expect(regles).toHaveLength(PASSWORD_RULES.length + 1);
    expect(regles.at(-1)?.libelle).toBe('Différent de votre email');
    expect(regles.at(-1)?.ok('kfaye2026!X')).toBe(false);
  });
});

describe('inscription', () => {
  const base = {
    organizationName: 'APIX',
    givenName: 'Ousmane',
    familyName: 'Ba',
    email: 'o.ba@apix.sn',
  };

  it('accepte un mot de passe conforme', () => {
    expect(registerInputSchema.safeParse({ ...base, password: BON }).success).toBe(true);
  });

  it('refuse un mot de passe faible', () => {
    expect(registerInputSchema.safeParse({ ...base, password: 'motdepasselong' }).success).toBe(
      false,
    );
  });

  it('refuse un mot de passe qui reprend l’adresse, et le dit SUR le champ', () => {
    const r = registerInputSchema.safeParse({
      ...base,
      email: 'k.faye@apix.sn',
      password: 'Kfaye2026!!x',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'password')).toBe(true);
    }
  });
});

describe('acceptation d’invitation', () => {
  /**
   * Asymétrie VOULUE, et c'est pour cela qu'elle est testée : ce champ porte
   * soit le mot de passe qu'on se choisit, soit celui d'un compte qui existe
   * déjà, saisi pour le relier au dossier. Durcir ce schéma interdirait de
   * relier un compte dont le mot de passe est antérieur à la politique. La
   * politique s'applique côté serveur, sur la seule branche qui POSE un mot de
   * passe.
   */
  it('laisse passer un mot de passe ancien, que la politique refuserait', () => {
    expect(acceptInvitationSchema.safeParse({ password: 'ancien' }).success).toBe(true);
  });

  it('refuse tout de même le vide', () => {
    expect(acceptInvitationSchema.safeParse({ password: '' }).success).toBe(false);
  });
});
