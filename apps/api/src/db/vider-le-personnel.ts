/**
 * Vider le personnel d'une organisation : les agents actifs et inactifs, et
 * tout ce qui leur est rattaché. Sert une fois, avant l'import du vrai
 * fichier de la DCH (ADR-0159), pour effacer les données de démonstration.
 *
 *   pnpm personnel:vider                    essai à blanc : rien n'est effacé
 *   pnpm personnel:vider --confirmer        efface
 *   --organisation <identifiant>            quand la base en compte plusieurs
 *   --avec-recrutement                      efface aussi offres et candidatures
 *
 * Effacé : les dossiers et les personnes, leurs affectations, contrats,
 * rémunérations, absences, documents, demandes, évaluations, habilitations,
 * invitations, le suivi de l'Academy, les notifications et les courriels de
 * l'organisation, et les comptes des agents (l'administration garde les
 * siens). Gardé : l'organisation, l'organigramme (ses unités, sans
 * responsables), les types d'absence, les jours fériés, les textes de
 * référence, le contenu de l'Academy, le journal d'audit.
 *
 * Tout se joue dans UNE transaction : à blanc, elle s'annule à la fin, et le
 * bilan dit exactement ce que l'effacement ferait.
 */
import { Client } from 'pg';
import { parse } from 'pg-connection-string';
import { loadEnv } from '../config/env';

export interface BilanDuVidage {
  /** Ce qui s'efface (ou s'effacerait), table par table, dans l'ordre. */
  effaces: { libelle: string; nombre: number }[];
  comptesSupprimes: string[];
  comptesGardes: string[];
  unitesGardees: number;
  applique: boolean;
}

/** Les tables du personnel, dans l'ordre que les clés étrangères imposent. */
const ETAPES: { libelle: string; tables: string[]; ou?: string }[] = [
  { libelle: 'validations de demandes d’absence', tables: ['absence_approvals'] },
  { libelle: 'justificatifs d’absence', tables: ['absence_documents'] },
  { libelle: 'demandes d’absence', tables: ['absence_requests'] },
  { libelle: 'soldes d’absence', tables: ['absence_balances'] },
  { libelle: 'demandes de documents', tables: ['document_requests'] },
  { libelle: 'pièces des dossiers', tables: ['employee_documents'] },
  { libelle: 'demandes de modification de fiche', tables: ['profile_change_requests'] },
  { libelle: 'grilles d’évaluation', tables: ['evaluation_grilles'] },
  { libelle: 'fiches d’objectifs', tables: ['objectifs_fiches'] },
  { libelle: 'objectifs individuels', tables: ['objectifs'], ou: 'employee_id IS NOT NULL' },
  { libelle: 'habilitations et délégations', tables: ['habilitations'] },
  { libelle: 'périodes d’inactivité', tables: ['periodes_inactivite'] },
  { libelle: 'rémunérations', tables: ['remunerations'] },
  {
    libelle: 'suivi de l’Academy',
    tables: [
      'academy_certificates',
      'academy_lesson_progress',
      'academy_quiz_attempts',
      'academy_reponses_vues',
      'academy_viewers',
    ],
  },
  { libelle: 'invitations au portail', tables: ['invitations'] },
  { libelle: 'notifications', tables: ['notifications'] },
  { libelle: 'courriels', tables: ['outbound_emails'] },
  { libelle: 'affectations', tables: ['assignments'] },
  { libelle: 'contrats', tables: ['contracts'] },
  { libelle: 'dossiers du personnel', tables: ['employees'] },
  { libelle: 'personnes', tables: ['persons'] },
];

/** Le recrutement, quand on le vide aussi : ses offres, ses candidatures. */
const RECRUTEMENT: { libelle: string; tables: string[] }[] = [
  {
    libelle: 'candidatures et leurs pièces',
    tables: ['application_access_log', 'application_documents', 'applications'],
  },
  { libelle: 'offres d’emploi', tables: ['job_postings', 'job_posting_counters'] },
];

export async function viderLePersonnel(
  client: Client,
  tenantId: string,
  { appliquer, recrutement = false }: { appliquer: boolean; recrutement?: boolean },
): Promise<BilanDuVidage> {
  const effaces: BilanDuVidage['effaces'] = [];
  await client.query('BEGIN');
  try {
    // Pas d'attente silencieuse derrière un verrou : un serveur qui tourne
    // encore le dit tout de suite.
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    const { rows: tables } = await client.query<{ nom: string }>(
      `SELECT tablename AS nom FROM pg_tables WHERE schemaname = 'public'`,
    );
    const existe = new Set(tables.map((t) => t.nom));

    // Les comptes des agents, lus AVANT d'effacer les personnes qui les
    // relient à l'organisation : tout compte non administrateur de
    // l'organisation, et tout compte relié à l'une de ses personnes.
    const { rows: agents } = await client.query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM users u
        WHERE EXISTS (SELECT 1 FROM user_tenant_memberships m
                       WHERE m.user_id = u.id AND m.tenant_id = $1 AND m.role <> 'admin')
           OR (EXISTS (SELECT 1 FROM persons p WHERE p.user_id = u.id AND p.tenant_id = $1)
               AND NOT EXISTS (SELECT 1 FROM user_tenant_memberships m
                                WHERE m.user_id = u.id AND m.tenant_id = $1 AND m.role = 'admin'))
        ORDER BY u.email`,
      [tenantId],
    );
    const { rows: admins } = await client.query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM user_tenant_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 AND m.role = 'admin' ORDER BY m.created_at, u.email`,
      [tenantId],
    );

    const { rowCount: tetes } = await client.query(
      `UPDATE org_units SET manager_employee_id = NULL, adjoint_employee_id = NULL, updated_at = now()
        WHERE tenant_id = $1 AND (manager_employee_id IS NOT NULL OR adjoint_employee_id IS NOT NULL)`,
      [tenantId],
    );
    effaces.push({ libelle: 'responsables retirés des unités', nombre: tetes ?? 0 });

    const vider = async (etapes: { libelle: string; tables: string[]; ou?: string }[]) => {
      for (const etape of etapes) {
        let nombre = 0;
        for (const table of etape.tables) {
          if (!existe.has(table)) continue;
          const { rowCount } = await client.query(
            `DELETE FROM ${table} WHERE tenant_id = $1${etape.ou ? ` AND ${etape.ou}` : ''}`,
            [tenantId],
          );
          nombre += rowCount ?? 0;
        }
        effaces.push({ libelle: etape.libelle, nombre });
      }
    };
    if (recrutement) await vider(RECRUTEMENT);
    await vider(ETAPES);

    // Les comptes des agents. Ce que ces comptes avaient créé et qui reste
    // (une offre, une formation) passe au premier compte de l'administration.
    const ids = agents.map((a) => a.id);
    if (ids.length > 0) {
      const repreneur = admins[0]?.id;
      for (const table of ['job_postings', 'academy_courses']) {
        if (!existe.has(table)) continue;
        const { rows } = await client.query(
          `SELECT 1 FROM ${table} WHERE tenant_id = $1 AND created_by_user_id = ANY($2::uuid[]) LIMIT 1`,
          [tenantId, ids],
        );
        if (rows.length === 0) continue;
        if (!repreneur) {
          throw new Error(
            'Aucun compte d’administration pour reprendre ce que les agents ont créé : vidage arrêté.',
          );
        }
        await client.query(
          `UPDATE ${table} SET created_by_user_id = $3
            WHERE tenant_id = $1 AND created_by_user_id = ANY($2::uuid[])`,
          [tenantId, ids, repreneur],
        );
      }
      await client.query(
        `UPDATE user_tenant_memberships SET acces_coupe_par_user_id = NULL
          WHERE acces_coupe_par_user_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        `DELETE FROM user_tenant_memberships WHERE tenant_id = $1 AND user_id = ANY($2::uuid[])`,
        [tenantId, ids],
      );
      // Un compte qui sert une autre organisation reste : seul son accès à
      // celle-ci s'en va.
      await client.query(
        `DELETE FROM users u WHERE u.id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM user_tenant_memberships m WHERE m.user_id = u.id)`,
        [ids],
      );
    }

    const { rows: unites } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM org_units WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    await client.query(appliquer ? 'COMMIT' : 'ROLLBACK');
    return {
      effaces,
      comptesSupprimes: agents.map((a) => a.email),
      comptesGardes: admins.map((a) => a.email),
      unitesGardees: unites[0]?.n ?? 0,
      applique: appliquer,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function principal(): Promise<void> {
  const args = process.argv.slice(2);
  const appliquer = args.includes('--confirmer');
  const recrutement = args.includes('--avec-recrutement');
  const rang = args.indexOf('--organisation');
  const identifiant = rang >= 0 ? args[rang + 1] : undefined;

  const env = loadEnv();
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
      `Organisation ${organisation.name} (${organisation.slug}), base « ${cible.database} » sur ${cible.host ?? 'socket local'}.\n`,
    );
    const bilan = await viderLePersonnel(client, organisation.id, { appliquer, recrutement });
    const largeur = Math.max(...bilan.effaces.map((e) => String(e.nombre).length));
    console.log(appliquer ? 'Effacé :' : 'À effacer :');
    for (const e of bilan.effaces) {
      if (e.nombre > 0) console.log(`  ${String(e.nombre).padStart(largeur)}  ${e.libelle}`);
    }
    console.log(
      `\nComptes des agents ${appliquer ? 'supprimés' : 'à supprimer'} (${bilan.comptesSupprimes.length}) : ${bilan.comptesSupprimes.join(', ') || 'aucun'}`,
    );
    console.log(`Comptes gardés (administration) : ${bilan.comptesGardes.join(', ') || 'aucun'}`);
    console.log(
      `Gardés : l’organisation, l’organigramme (${bilan.unitesGardees} unités, sans responsables), les types d’absence, les jours fériés, les textes de référence, le contenu de l’Academy${recrutement ? '' : ', le recrutement'}, le journal d’audit.`,
    );
    const commande = [
      'pnpm personnel:vider --confirmer',
      ...(recrutement ? ['--avec-recrutement'] : []),
      ...(identifiant ? ['--organisation', identifiant] : []),
    ].join(' ');
    console.log(
      appliquer
        ? '\nLe personnel est vidé. L’import se fait maintenant depuis le compte de l’administration.'
        : `\nEssai à blanc : rien n’a été effacé. Pour effacer : ${commande}`,
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
