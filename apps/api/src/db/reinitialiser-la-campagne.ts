/**
 * Remettre à zéro les fiches de la campagne d'une année, pour recommencer
 * après des essais (ADR-0270) : l'auto-évaluation, l'évaluation du N+1 et
 * la partie réservée, la validation de l'agent, les commentaires du N+2 et
 * la transmission à la DCH.
 *
 *   pnpm campagne:reinitialiser                   essai à blanc : rien ne change
 *   pnpm campagne:reinitialiser --confirmer       remet les fiches à zéro
 *   --agent <adresse>                             la fiche d'un seul agent : son adresse
 *                                                 professionnelle, ou celle de son compte
 *   --annee <AAAA>                                une autre année que celle de la campagne
 *   --organisation <identifiant>                  quand la base en compte plusieurs
 *
 * Gardé : les objectifs de l'année, l'évaluateur choisi par
 * l'administration, les dates de la campagne, les comptes. Le journal
 * d'audit garde la trace de la remise à zéro, avec ce que la fiche
 * contenait.
 *
 * Tout se joue dans UNE transaction : à blanc, elle s'annule à la fin, et le
 * bilan dit exactement ce que la remise à zéro ferait.
 */
import { Client } from 'pg';
import { parse } from 'pg-connection-string';
import { loadEnv } from '../config/env';

/** Ce que la campagne écrit sur une fiche, de l'auto-évaluation à la DCH. */
const COLONNES = [
  'auto',
  'auto_transmise_le',
  'evaluation',
  'reservee',
  'evaluation_par_employee_id',
  'evaluation_transmise_le',
  'validee_le',
  'renvoyee_le',
  'renvoi_mot',
  'commentaires_n2',
  'commentaires_n2_par',
  'commentaires_n2_transmis_le',
  'reprise_n2_le',
  'transmise_dch_le',
  'transmise_dch_par',
] as const;

export interface FicheRemiseAZero {
  matricule: string;
  prenom: string;
  nom: string;
  /** Jusqu'où la fiche était allée. */
  etape: string;
}

export interface BilanDeLaRemiseAZero {
  annee: number;
  /** Les fiches remises à zéro (ou qui le seraient), par ordre alphabétique. */
  fiches: FicheRemiseAZero[];
  applique: boolean;
}

export async function reinitialiserLaCampagne(
  client: Client,
  tenantId: string,
  { annee, agent, appliquer }: { annee: number; agent?: string; appliquer: boolean },
): Promise<BilanDeLaRemiseAZero> {
  await client.query('BEGIN');
  try {
    // Pas d'attente silencieuse derrière un verrou : un serveur qui écrit
    // encore sur une fiche le dit tout de suite.
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    // L'agent, par son adresse professionnelle ou celle de son compte : un
    // dossier sans adresse professionnelle se retrouve aussi.
    let employeeIds: string[] | null = null;
    if (agent) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT DISTINCT e.id FROM employees e
           JOIN persons p ON p.id = e.person_id
           LEFT JOIN users u ON u.id = p.user_id
          WHERE e.tenant_id = $1
            AND (lower(e.work_email) = lower($2) OR lower(u.email) = lower($2))`,
        [tenantId, agent],
      );
      if (rows.length === 0) {
        throw new Error(`Aucun agent avec l’adresse « ${agent} » dans cette organisation.`);
      }
      employeeIds = rows.map((r) => r.id);
    }
    // Seules les fiches où la campagne a écrit quelque chose.
    const { rows } = await client.query<FicheRemiseAZero & { id: string }>(
      `SELECT f.id, e.employee_number AS matricule, p.given_name AS prenom, p.family_name AS nom,
              CASE
                WHEN f.transmise_dch_le IS NOT NULL THEN 'transmise à la DCH'
                WHEN f.validee_le IS NOT NULL THEN 'validée par l’agent'
                WHEN f.evaluation_transmise_le IS NOT NULL THEN 'transmise à l’agent'
                WHEN f.evaluation IS NOT NULL OR f.reservee IS NOT NULL THEN 'évaluation du N+1 commencée'
                WHEN f.auto_transmise_le IS NOT NULL THEN 'auto-évaluation transmise'
                ELSE 'auto-évaluation commencée'
              END AS etape
         FROM fiches_entretien f
         JOIN employees e ON e.id = f.employee_id
         JOIN persons p ON p.id = e.person_id
        WHERE f.tenant_id = $1 AND f.annee = $2
          AND ($3::uuid[] IS NULL OR f.employee_id = ANY($3::uuid[]))
          AND (${COLONNES.map((c) => `f.${c} IS NOT NULL`).join(' OR ')})
        ORDER BY p.family_name, p.given_name`,
      [tenantId, annee, employeeIds],
    );
    if (rows.length > 0) {
      await client.query(
        `UPDATE fiches_entretien
            SET ${COLONNES.map((c) => `${c} = NULL`).join(', ')}, updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
    }
    await client.query(appliquer ? 'COMMIT' : 'ROLLBACK');
    return {
      annee,
      fiches: rows.map((r) => ({
        matricule: r.matricule,
        prenom: r.prenom,
        nom: r.nom,
        etape: r.etape,
      })),
      applique: appliquer,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function principal(): Promise<void> {
  const args = process.argv.slice(2);
  // Une option sans sa valeur arrête tout : « --agent » seul ne doit pas
  // remettre à zéro toutes les fiches.
  const valeur = (option: string): string | undefined => {
    const rang = args.indexOf(option);
    if (rang < 0) return undefined;
    const v = args[rang + 1];
    if (!v || v.startsWith('--')) throw new Error(`${option} attend une valeur.`);
    return v;
  };
  const appliquer = args.includes('--confirmer');
  const agent = valeur('--agent');
  const anneeDemandee = valeur('--annee');
  const identifiant = valeur('--organisation');
  if (anneeDemandee !== undefined && !/^20\d\d$/.test(anneeDemandee)) {
    throw new Error('--annee attend une année, comme 2026.');
  }

  const env = loadEnv();
  const annee = anneeDemandee
    ? Number(anneeDemandee)
    : (env.CAMPAGNE_D_EVALUATION ?? new Date().getFullYear());
  const cible = parse(env.DATABASE_URL);
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: organisations } = await client.query<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM tenants ORDER BY created_at`,
    );
    const organisation = identifiant
      ? organisations.find((o) => o.slug === identifiant)
      : organisations.length === 1
        ? organisations[0]
        : undefined;
    if (!organisation) {
      console.error(
        identifiant
          ? `Aucune organisation « ${identifiant} » dans cette base.`
          : 'Cette base compte plusieurs organisations : précisez laquelle avec --organisation.',
      );
      for (const o of organisations) console.error(`  ${o.slug}  (${o.name})`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `Organisation ${organisation.name} (${organisation.slug}), base « ${cible.database} » sur ${cible.host ?? 'socket local'}.`,
    );
    console.log(`Campagne ${annee}, ${agent ? `la fiche de ${agent}` : 'toutes les fiches'}.\n`);
    const bilan = await reinitialiserLaCampagne(client, organisation.id, {
      annee,
      agent,
      appliquer,
    });
    if (bilan.fiches.length === 0) {
      console.log('Rien à remettre à zéro : aucune fiche n’a été commencée.');
      return;
    }
    const largeur = Math.max(...bilan.fiches.map((f) => f.matricule.length));
    console.log(`${appliquer ? 'Remises à zéro' : 'À remettre à zéro'} (${bilan.fiches.length}) :`);
    for (const f of bilan.fiches) {
      console.log(`  ${f.matricule.padEnd(largeur)}  ${f.prenom} ${f.nom}  (${f.etape})`);
    }
    console.log(
      '\nGardés : les objectifs de l’année, l’évaluateur choisi par l’administration, les dates de la campagne, les comptes. Le journal d’audit garde la trace de la remise à zéro.',
    );
    const commande = [
      'pnpm campagne:reinitialiser --confirmer',
      ...(agent ? ['--agent', agent] : []),
      ...(anneeDemandee ? ['--annee', anneeDemandee] : []),
      ...(identifiant ? ['--organisation', identifiant] : []),
    ].join(' ');
    console.log(
      appliquer
        ? '\nC’est fait : ces fiches repartent de l’auto-évaluation.'
        : `\nEssai à blanc : rien n’a changé. Pour remettre à zéro : ${commande}`,
    );
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  principal().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
