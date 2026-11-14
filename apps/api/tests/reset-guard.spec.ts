/**
 * Garde-fou du script destructeur `pnpm db:reset`.
 *
 * Ces tests existent à cause d'un contournement RÉEL : le garde décidait sur
 * `new URL(url).hostname` alors que `pg` se connecte via `pg-connection-string`,
 * qui honore le paramètre `?host=`. La chaîne
 * `postgresql:///teranga?host=prod.example.com` était donc vue « locale » par le
 * garde et « production » par le client — laissez-passer inconditionnel, base
 * détruite. Un garde qui n'analyse pas la chaîne comme le fait le client ne
 * garde rien.
 */
import { describe, expect, it } from 'vitest';
import { assertDisposable } from '../src/db/reset';

const DEV = 'development';

/** true si le garde laisse passer, false s'il refuse. */
function autorise(url: string, nodeEnv = DEV): boolean {
  try {
    assertDisposable(url, nodeEnv);
    return true;
  } catch {
    return false;
  }
}

describe('assertDisposable — bases jetables', () => {
  it('laisse passer une base locale ordinaire', () => {
    expect(autorise('postgres://postgres:postgres@localhost:5432/teranga')).toBe(true);
    expect(autorise('postgres://u:p@127.0.0.1/teranga')).toBe(true);
  });

  it("laisse passer les noms d'hôte des stacks de développement", () => {
    expect(autorise('postgres://u:p@db:5432/teranga')).toBe(true);
    expect(autorise('postgres://u:p@postgres:5432/teranga')).toBe(true);
  });

  it("normalise la casse et les crochets IPv6 — l'écriture de l'URL ne doit pas décider", () => {
    expect(autorise('postgres://u:p@LOCALHOST/teranga')).toBe(true);
    expect(autorise('postgres://u:p@[::1]:5432/teranga')).toBe(true);
  });

  it('laisse passer une socket unix', () => {
    expect(autorise('postgres:///teranga?host=/var/run/postgresql')).toBe(true);
  });
});

describe('assertDisposable — refus', () => {
  it('refuse toujours en production, même sur un hôte local', () => {
    expect(autorise('postgres://u:p@localhost/teranga', 'production')).toBe(false);
  });

  it('exige la confirmation du nom de base sur un hôte distant', () => {
    expect(autorise('postgres://u:p@prod.rds.amazonaws.com/teranga')).toBe(false);
  });

  it("ferme le contournement par le paramètre ?host= — c'est le défaut d'origine", () => {
    // Le garde voyait un hôte vide (« local ») ; pg se connectait à la prod.
    expect(autorise('postgresql:///teranga?host=prod-db.apix.sn&port=5432')).toBe(false);
    // Autorité locale mais paramètre distant : pg suit le paramètre.
    expect(autorise('postgres://u:p@localhost/teranga?host=prod.rds.amazonaws.com')).toBe(false);
  });

  it('échoue fermé quand il ne peut pas déterminer l’hôte', () => {
    expect(autorise('postgres:///teranga')).toBe(false);
  });

  it('refuse quand il ne sait pas quelle base serait détruite', () => {
    expect(autorise('postgres://u:p@localhost:5432/')).toBe(false);
  });

  it('compare le VRAI nom de base, décodé comme le fera pg', () => {
    // Sans décodage, le garde réclamait « my%20db » pour une base « my db ».
    process.env.DB_RESET_CONFIRM = 'my db';
    expect(autorise('postgres://u:p@prod.example.com/my%20db')).toBe(true);
    process.env.DB_RESET_CONFIRM = 'my%20db';
    expect(autorise('postgres://u:p@prod.example.com/my%20db')).toBe(false);
    delete process.env.DB_RESET_CONFIRM;
  });

  it('accepte un hôte distant si la confirmation correspond exactement', () => {
    process.env.DB_RESET_CONFIRM = 'teranga';
    expect(autorise('postgres://u:p@prod.rds.amazonaws.com/teranga')).toBe(true);
    expect(autorise('postgres://u:p@prod.rds.amazonaws.com/autre_base')).toBe(false);
    delete process.env.DB_RESET_CONFIRM;
  });
});
