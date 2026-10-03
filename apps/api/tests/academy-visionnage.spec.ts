/**
 * Le verrou du visionnage, éprouvé par ceux qui voudraient le contourner.
 *
 * Chaque cas de triche est joué comme il le serait depuis une console : des
 * passages déclarés trop longs, trop tôt, trop loin, dans plusieurs onglets.
 * La garantie à tenir est une seule phrase — AUCUNE LEÇON NE SE VALIDE PLUS
 * VITE QUE SA DURÉE RÉELLE — et le dernier bloc la mesure directement.
 */
import { describe, expect, it } from 'vitest';
import type { Intervalle } from '@teranga/contracts';
import { SEUIL_VISIONNAGE } from '@teranga/contracts';
import {
  atteintLeSeuil,
  crediter,
  etatsDuParcours,
  fusionner,
  nouveauxMorceaux,
  plusLoin,
  RESERVE_MAX_S,
  remplir,
  totalVu,
  type Reserve,
} from '../src/modules/academy/visionnage';

const T0 = Date.UTC(2026, 8, 25, 9, 0, 0);
const s = (secondes: number) => T0 + secondes * 1000;
const pleine = (): Reserve => ({ jetons: RESERVE_MAX_S, a: T0 });

/** Joue une suite de battements et rend l'état final. */
function jouer(
  battements: Array<{ t: number; de: number; a: number }>,
  duree: number,
  depart: { intervalles?: Intervalle[]; reserve?: Reserve; validee?: boolean } = {},
) {
  let intervalles = depart.intervalles ?? [];
  let reserve = depart.reserve ?? pleine();
  const refus: Array<'saut' | null> = [];
  for (const b of battements) {
    const r = crediter({
      intervalles,
      reserve,
      segment: { de: b.de, a: b.a },
      maintenant: s(b.t),
      duree,
      validee: depart.validee ?? false,
    });
    intervalles = r.intervalles;
    reserve = r.reserve;
    refus.push(r.refus);
  }
  return { intervalles, reserve, refus, vu: totalVu(intervalles) };
}

/** Une lecture honnête : un battement toutes les dix secondes, sans rien sauter. */
function lectureHonnete(jusqua: number) {
  const b: Array<{ t: number; de: number; a: number }> = [];
  for (let x = 0; x < jusqua; x += 10) b.push({ t: x + 10, de: x, a: Math.min(x + 10, jusqua) });
  return b;
}

describe('la lecture honnête', () => {
  it('crédite tout ce qui est regardé, au rythme de la vidéo', () => {
    const r = jouer(lectureHonnete(120), 120);
    expect(r.intervalles).toEqual([[0, 120]]);
    expect(r.refus.every((x) => x === null)).toBe(true);
    expect(atteintLeSeuil(r.intervalles, 120)).toBe(true);
  });

  it('valide à 90 % et pas avant', () => {
    const presque = jouer(lectureHonnete(100), 120);
    expect(presque.vu).toBe(100);
    expect(atteintLeSeuil(presque.intervalles, 120)).toBe(false);
    const juste = jouer(lectureHonnete(108), 120);
    expect(juste.vu).toBeCloseTo(SEUIL_VISIONNAGE * 120);
    expect(atteintLeSeuil(juste.intervalles, 120)).toBe(true);
  });

  it('absorbe un battement arrivé en retard sans rien perdre', () => {
    // Le réseau retient le deuxième battement quatre secondes ; le troisième
    // arrive à l'heure. La réserve couvre l'écart.
    const r = jouer(
      [
        { t: 10, de: 0, a: 10 },
        { t: 24, de: 10, a: 20 },
        { t: 30, de: 20, a: 30 },
      ],
      60,
    );
    expect(r.intervalles).toEqual([[0, 30]]);
  });

  it('ne compte pas deux fois un passage revu, et ne le fait pas payer', () => {
    const vu = jouer(lectureHonnete(50), 120);
    const revu = jouer([{ t: 60, de: 0, a: 10 }], 120, {
      intervalles: vu.intervalles,
      reserve: { jetons: 0, a: s(50) },
    });
    expect(revu.vu).toBe(50);
    // Rien de nouveau n'a été crédité : la réserve s'est remplie au lieu de
    // se vider.
    expect(revu.reserve.jetons).toBe(10);
  });

  it('crédite seulement la part NOUVELLE d’un passage à cheval', () => {
    const r = jouer([{ t: 20, de: 40, a: 60 }], 120, {
      intervalles: [[0, 50]],
      reserve: { jetons: 0, a: T0 },
    });
    expect(r.intervalles).toEqual([[0, 60]]);
  });

  it('s’arrête à la fin de la vidéo, quoi que déclare le lecteur', () => {
    const r = jouer([{ t: 30, de: 110, a: 140 }], 120, { intervalles: [[0, 110]] });
    expect(plusLoin(r.intervalles)).toBe(120);
  });
});

describe('les triches', () => {
  it('un saut en avant n’est pas crédité, et il est signalé', () => {
    const r = jouer(
      [
        { t: 10, de: 0, a: 10 },
        { t: 20, de: 60, a: 70 },
      ],
      120,
    );
    expect(r.refus).toEqual([null, 'saut']);
    expect(r.intervalles).toEqual([[0, 10]]);
  });

  it('un passage d’une traite plus long que le temps écoulé est rogné', () => {
    // « J'ai regardé 0 → 700 » déclaré cinq secondes après l'ouverture. La
    // réserve était pleine et le reste : vingt secondes, pas une de plus.
    const r = jouer([{ t: 5, de: 0, a: 700 }], 720);
    expect(r.vu).toBe(RESERVE_MAX_S);
  });

  it('des battements fabriqués en rafale ne vont pas plus vite que l’horloge', () => {
    // Cent battements en dix secondes, chacun déclarant dix secondes de vidéo.
    const rafale = Array.from({ length: 100 }, (_, k) => ({
      t: (k + 1) * 0.1,
      de: k * 10,
      a: (k + 1) * 10,
    }));
    const r = jouer(rafale, 720);
    expect(r.vu).toBeLessThanOrEqual(RESERVE_MAX_S + 10 + 1e-9);
  });

  it('deux leçons en parallèle puisent dans la MÊME réserve', () => {
    // Deux onglets, deux leçons, des battements alternés : la réserve est
    // celle de l'agent, pas de la leçon.
    let reserve = pleine();
    let l1: Intervalle[] = [];
    let l2: Intervalle[] = [];
    for (let k = 0; k < 30; k += 1) {
      const t = s((k + 1) * 10);
      const a = crediter({
        intervalles: l1,
        reserve,
        segment: { de: k * 10, a: (k + 1) * 10 },
        maintenant: t,
        duree: 720,
        validee: false,
      });
      l1 = a.intervalles;
      reserve = a.reserve;
      const b = crediter({
        intervalles: l2,
        reserve,
        segment: { de: k * 10, a: (k + 1) * 10 },
        maintenant: t,
        duree: 720,
        validee: false,
      });
      l2 = b.intervalles;
      reserve = b.reserve;
    }
    // Trois cents secondes d'horloge : pas davantage de vidéo créditée, à la
    // réserve près — sur les deux leçons ENSEMBLE.
    expect(totalVu(l1) + totalVu(l2)).toBeLessThanOrEqual(300 + RESERVE_MAX_S + 1e-9);
  });

  it('une longue pause ne se thésaurise pas au-delà de la réserve', () => {
    // Onglet ouvert, rien ne joue pendant une heure, puis un passage énorme.
    const r = jouer([{ t: 3600, de: 0, a: 700 }], 720);
    expect(r.vu).toBe(RESERVE_MAX_S);
  });

  it('une horloge qui recule ne vide pas la réserve', () => {
    expect(remplir({ jetons: 12, a: s(100) }, s(90))).toBe(12);
  });
});

describe('la leçon déjà validée', () => {
  it('se revoit librement : sauter n’y est plus un refus', () => {
    const r = jouer([{ t: 10, de: 300, a: 310 }], 720, {
      intervalles: [[0, 700]],
      validee: true,
    });
    expect(r.refus).toEqual([null]);
  });
});

describe('la garantie', () => {
  it('aucune leçon ne se valide plus vite que sa durée réelle', () => {
    // Le tricheur optimal : un battement par seconde, chacun déclarant le
    // plus long passage autorisé depuis ce qui a été vu. On mesure l'instant
    // où la leçon de douze minutes passe le seuil.
    const duree = 720;
    let intervalles: Intervalle[] = [];
    let reserve = pleine();
    let t = 0;
    while (!atteintLeSeuil(intervalles, duree) && t < 10_000) {
      t += 1;
      const depuis = plusLoin(intervalles);
      const r = crediter({
        intervalles,
        reserve,
        segment: { de: depuis, a: duree },
        maintenant: s(t),
        duree,
        validee: false,
      });
      intervalles = r.intervalles;
      reserve = r.reserve;
    }
    // 90 % de douze minutes, c'est 648 secondes ; la réserve en avance vingt.
    expect(t).toBeGreaterThanOrEqual(SEUIL_VISIONNAGE * duree - RESERVE_MAX_S);
  });
});

describe('les passages', () => {
  it('se recollent quand ils se touchent', () => {
    expect(
      fusionner([
        [20, 30],
        [0, 10],
        [10.1, 15],
      ]),
    ).toEqual([
      [0, 15],
      [20, 30],
    ]);
  });

  it('ce qui reste à créditer dans un passage', () => {
    expect(
      nouveauxMorceaux(0, 100, [
        [10, 20],
        [50, 60],
      ]),
    ).toEqual([
      [0, 10],
      [20, 50],
      [60, 100],
    ]);
    expect(nouveauxMorceaux(12, 18, [[10, 20]])).toEqual([]);
  });
});

describe('l’ordre du parcours', () => {
  const l = (validee: boolean, commencee = false) => ({ validee, commencee });

  it('la première leçon non validée est la courante, les suivantes attendent', () => {
    expect(etatsDuParcours([l(true), l(false, true), l(false), l(false)])).toEqual([
      'validee',
      'en_cours',
      'verrouillee',
      'verrouillee',
    ]);
  });

  it('une leçon validée le reste, même si une leçon a été insérée devant', () => {
    expect(etatsDuParcours([l(true), l(false), l(true)])).toEqual([
      'validee',
      'a_suivre',
      'validee',
    ]);
  });

  it('une formation neuve ouvre sa première leçon, et elle seule', () => {
    expect(etatsDuParcours([l(false), l(false)])).toEqual(['a_suivre', 'verrouillee']);
  });
});
