import { Inject, Injectable, Optional } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AccesAgent,
  AcceptResult,
  EtatDesAcces,
  InvitationInfo,
  InvitableRole,
  InviteResult,
  InviterPlusieursResult,
  SessionUser,
} from '@teranga/contracts';
import { passwordDiffersFromEmail, passwordShortfall } from '@teranga/contracts';
import { ECHECS_PAR_COMPTE, Limiteur, empreinte } from '../../common/limiteur';
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { AuthService, IssuedSession } from '../auth/auth.service';
import { directionDuPersonnel } from '../acces/dch';
import { ExpediteurCourriels } from '../courriels/expediteur';
import { directeurGeneral, directionDeLUnite, uniteEnVigueur } from '../people/chaine';
import { finDeContratPassee } from '../people/en-activite';
import { reconcilierLeCircuit } from '../time/visas';
import { accueilDe, compteALAdresse, hashToken, preparerInvitation } from './invitation';

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/**
 * Le dossier a fermé depuis l'envoi : archivé, ou contrat échu que la liste
 * n'a pas encore rangé. Suppose app.tenant_id posé.
 */
async function dossierFerme(tx: Tx, personId: string): Promise<boolean> {
  const [dossier] = await tx
    .select({ id: t.employees.id, status: t.employees.status })
    .from(t.employees)
    .where(eq(t.employees.personId, personId))
    .orderBy(sql`${t.employees.status} = 'active' DESC`)
    .limit(1);
  return (
    !dossier || dossier.status !== 'active' || Boolean(await finDeContratPassee(tx, dossier.id))
  );
}

/**
 * Un compte fermé (sans mot de passe) ne retient pas son adresse : une
 * adresse professionnelle se redonne, des années après, à quelqu'un d'autre.
 * S'il revient, son invitation lui en donnera une.
 */
async function libererLAdresse(tx: Tx, userId: string): Promise<void> {
  // Un compte qui sert ailleurs n'appartient pas à cette organisation : son
  // adresse ne se reprend pas d'ici.
  const { rows } = await tx.execute<{ oui: boolean }>(
    sql`SELECT compte_d_une_autre_organisation(${userId}) AS oui`,
  );
  if (rows[0]?.oui) {
    problem(
      409,
      'portal.adresse_prise',
      'Cette adresse est celle d’un autre compte',
      'Demandez à la Direction du Capital Humain une invitation à une autre adresse.',
    );
  }
  await tx.execute(sql`
    UPDATE users SET email = 'ancien+' || id || '@compte.invalide'
     WHERE id = ${userId} AND password_hash IS NULL`);
}

/**
 * Le portail de la direction (le DG, le directeur du Capital Humain) et
 * celui d'un administrateur portent tous les droits : seul un
 * administrateur ou le directeur du Capital Humain en envoie l'invitation.
 * Un délégué qui l'enverrait choisirait qui hérite de ces droits.
 */
async function exigerDePouvoirInviter(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<void> {
  if (user.role === 'admin' || user.dirigeLaDCH) return;
  const dch = await directionDuPersonnel(tx);
  const protege =
    dch?.directeurEmployeeId === employeeId || (await directeurGeneral(tx)) === employeeId;
  const { rows } = await tx.execute<{ admin: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM employees e
        JOIN persons p ON p.id = e.person_id
        JOIN user_tenant_memberships m ON m.user_id = p.user_id AND m.tenant_id = e.tenant_id
       WHERE e.id = ${employeeId} AND m.role = 'admin') AS admin`);
  if (protege || rows[0]?.admin) {
    problem(
      403,
      'portal.invitation_reservee',
      'Seuls l’administrateur et le directeur du Capital Humain invitent cet agent',
      'Son portail porte les droits de la direction ou de l’administration.',
    );
  }
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuthService) private readonly auth: AuthService,
    @Optional()
    @Inject(ExpediteurCourriels)
    private readonly expediteur?: ExpediteurCourriels,
    @Optional()
    @Inject(Limiteur)
    private readonly limiteur?: Limiteur,
  ) {}

  /** Une invitation, depuis la fiche de l'agent. */
  async invite(
    user: SessionUser,
    employeeId: string,
    role: InvitableRole,
    emailOverride?: string,
  ): Promise<InviteResult> {
    const r = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx) => {
        await exigerDePouvoirInviter(tx, user, employeeId);
        return preparerInvitation(tx, this.expediteur, user, employeeId, role, emailOverride);
      },
    );
    if (r.courriel) this.expediteur?.bientot();
    return r;
  }

  /**
   * Plusieurs invitations d'un coup. Chacune dans sa transaction : un agent
   * sans adresse ou déjà inscrit n'empêche pas les autres de partir.
   */
  async inviterPlusieurs(user: SessionUser, ids: string[]): Promise<InviterPlusieursResult> {
    // Sans courrier, une invitation n'est qu'un lien à transmettre à la main :
    // en lot, personne ne le recevrait.
    if (!this.expediteur?.actif) {
      problem(
        422,
        'portal.sans_courrier',
        'Aucun serveur de courrier n’est configuré',
        'Les invitations ne partent pas d’elles-mêmes : générez le lien depuis la fiche de chaque agent.',
      );
    }
    const invites: InviterPlusieursResult['invites'] = [];
    const refus: InviterPlusieursResult['refus'] = [];
    const noms = await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      tx
        .select({
          id: t.employees.id,
          nom: sql<string>`${t.persons.givenName} || ' ' || ${t.persons.familyName}`,
        })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(inArray(t.employees.id, ids)),
    );
    const nomDe = new Map(noms.map((n) => [n.id, n.nom]));
    for (const id of new Set(ids)) {
      const nom = nomDe.get(id);
      if (!nom) {
        refus.push({ employeeId: id, nom: '', raison: 'Employé introuvable' });
        continue;
      }
      try {
        const r = await this.db.withTenant(
          { tenantId: user.tenantId, userId: user.userId },
          async (tx) => {
            await exigerDePouvoirInviter(tx, user, id);
            return preparerInvitation(tx, this.expediteur, user, id, 'employee');
          },
        );
        invites.push({ employeeId: id, nom, email: r.email });
      } catch (err) {
        if (!(err instanceof ProblemException)) throw err;
        refus.push({ employeeId: id, nom, raison: err.problem.title });
      }
    }
    if (invites.length > 0) this.expediteur?.bientot();
    return { invites, refus, parCourriel: this.expediteur?.actif ?? false };
  }

  /**
   * Où en est l'accès au portail de chaque agent en activité : la vue de la
   * DCH sur qui est entré, qui attend, qui n'a jamais été invité.
   */
  async etatDesAcces(user: SessionUser): Promise<EtatDesAcces> {
    const agents = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx) => {
        const { rows } = await tx.execute<{
          employee_id: string;
          nom: string;
          matricule: string;
          unite: string | null;
          work_email: string | null;
          user_id: string | null;
          ferme: boolean | null;
          coupe: boolean | null;
          invite_le: string | null;
          expire_le: string | null;
          acceptee: boolean | null;
          courriel: string | null;
          erreur: boolean | null;
        }>(sql`
        SELECT e.id AS employee_id, p.given_name || ' ' || p.family_name AS nom,
               e.employee_number AS matricule,
               COALESCE(${directionDeLUnite(uniteEnVigueur(sql`e.id`), 'short_name')},
                        ${directionDeLUnite(uniteEnVigueur(sql`e.id`), 'name')}) AS unite,
               e.work_email, p.user_id,
               u.password_hash IS NULL AS ferme,
               m.acces_coupe_le IS NOT NULL AS coupe,
               i.created_at AS invite_le, i.expires_at AS expire_le,
               i.accepted_at IS NOT NULL AS acceptee,
               o.status AS courriel, o.last_error IS NOT NULL AS erreur
          FROM employees e
          JOIN persons p ON p.id = e.person_id
          LEFT JOIN users u ON u.id = p.user_id
          LEFT JOIN user_tenant_memberships m ON m.user_id = p.user_id AND m.tenant_id = e.tenant_id
          LEFT JOIN LATERAL (
            SELECT iv.id, iv.created_at, iv.expires_at, iv.accepted_at FROM invitations iv
             WHERE iv.person_id = p.id ORDER BY iv.created_at DESC LIMIT 1) i ON TRUE
          LEFT JOIN LATERAL (
            SELECT ob.status, ob.last_error FROM outbound_emails ob
             WHERE ob.subject_id = i.id AND ob.kind = 'invitation'
             ORDER BY ob.created_at DESC LIMIT 1) o ON TRUE
         WHERE e.status = 'active' AND p.deleted_at IS NULL
         ORDER BY p.family_name, p.given_name`);
        const maintenant = Date.now();
        return rows.map((r): AccesAgent => {
          const enAttente =
            r.invite_le !== null && !r.acceptee && new Date(r.expire_le!).getTime() > maintenant;
          const etat: AccesAgent['etat'] = r.coupe
            ? 'coupe'
            : r.user_id && !r.ferme
              ? 'actif'
              : enAttente
                ? 'invite'
                : r.user_id
                  ? 'ferme'
                  : r.invite_le && !r.acceptee
                    ? 'expire'
                    : 'jamais';
          return {
            employeeId: r.employee_id,
            nom: r.nom,
            matricule: r.matricule,
            unite: r.unite,
            etat,
            adresse: r.work_email,
            // Un essai manqué se dit tout de suite, même si d'autres suivent.
            courriel: !enAttente
              ? null
              : r.courriel === 'sent'
                ? 'envoye'
                : r.courriel === 'failed' || (r.courriel === 'pending' && r.erreur)
                  ? 'echec'
                  : r.courriel === 'pending'
                    ? 'en_attente'
                    : null,
          };
        });
      },
    );
    return { parCourriel: this.expediteur?.actif ?? false, agents };
  }

  /**
   * Couper l'accès d'un agent à l'organisation : ses sessions se ferment sur
   * tous ses appareils, et il ne se reconnecte plus jusqu'à ce qu'on le
   * rétablisse. Son dossier n'en est pas touché. Personne ne coupe le sien ;
   * le compte d'un administrateur, ou du directeur du Capital Humain, seul
   * un administrateur le coupe.
   */
  async couperLAcces(user: SessionUser, employeeId: string, coupe: boolean): Promise<void> {
    const compte = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx) => {
        const [row] = await tx
          .select({ userId: t.persons.userId })
          .from(t.employees)
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .where(eq(t.employees.id, employeeId))
          .limit(1);
        if (!row) problem(404, 'people.employee_not_found', 'Employé introuvable');
        if (!row.userId) {
          problem(422, 'portal.sans_compte', 'Cet agent n’a pas de compte sur le portail');
        }
        if (row.userId === user.userId) {
          problem(403, 'acces.son_propre_dossier', 'Vous ne pouvez pas couper votre propre accès');
        }
        const [membre] = await tx
          .select({ id: t.userTenantMemberships.id, role: t.userTenantMemberships.role })
          .from(t.userTenantMemberships)
          .where(
            and(
              eq(t.userTenantMemberships.userId, row.userId),
              eq(t.userTenantMemberships.tenantId, user.tenantId),
            ),
          )
          .limit(1);
        if (!membre) {
          problem(422, 'portal.sans_compte', 'Cet agent n’a pas de compte sur le portail');
        }
        // Rétablir un accès coupé : l'administrateur, le directeur du
        // Capital Humain, ou qui l'a coupé. Un délégué ne rouvre pas la
        // porte qu'un autre a fermée (un licenciement, une fraude).
        if (!coupe && user.role !== 'admin' && !user.dirigeLaDCH) {
          const [etat] = await tx
            .select({ par: t.userTenantMemberships.accesCoupeParUserId })
            .from(t.userTenantMemberships)
            .where(eq(t.userTenantMemberships.id, membre.id));
          if (etat?.par && etat.par !== user.userId) {
            problem(
              403,
              'portal.retablir_reserve',
              'Seul qui a coupé cet accès le rétablit',
              'Ou l’administrateur, ou le directeur du Capital Humain.',
            );
          }
        }
        if (user.role !== 'admin') {
          const dch = await directionDuPersonnel(tx);
          if (membre.role === 'admin' || dch?.directeurEmployeeId === employeeId) {
            problem(
              403,
              'portal.acces_reserve_admin',
              'Seul un administrateur coupe cet accès',
              'Ce compte administre l’organisation ou dirige la Direction du Capital Humain : seul un administrateur peut couper ou rétablir son accès.',
            );
          }
        }
        await tx
          .update(t.userTenantMemberships)
          .set(
            coupe
              ? { accesCoupeLe: new Date(), accesCoupeParUserId: user.userId }
              : { accesCoupeLe: null, accesCoupeParUserId: null },
          )
          .where(eq(t.userTenantMemberships.id, membre.id));
        return row.userId;
      },
    );
    if (coupe) await this.auth.deconnecterPartout(compte, user.tenantId);
  }

  /** Page publique : renseigne l'écran d'acceptation sans révéler autre chose. */
  async info(token: string): Promise<InvitationInfo> {
    return this.db.withInvitationToken(hashToken(token), async (tx) => {
      const [row] = await tx
        .select({
          invitation: t.invitations,
          organizationName: t.tenants.name,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          gender: t.persons.gender,
          personUserId: t.persons.userId,
        })
        .from(t.invitations)
        .innerJoin(t.tenants, eq(t.tenants.id, t.invitations.tenantId))
        .innerJoin(t.persons, eq(t.persons.id, t.invitations.personId))
        .limit(1);
      if (!row) return { valid: false, reason: 'not_found' };
      if (row.invitation.acceptedAt) return { valid: false, reason: 'used' };
      if (row.invitation.expiresAt < new Date()) return { valid: false, reason: 'expired' };
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${row.invitation.tenantId}, true)`);
      if (await dossierFerme(tx, row.invitation.personId))
        return { valid: false, reason: 'expired' };
      return {
        valid: true,
        organizationName: row.organizationName,
        givenName: row.givenName,
        familyName: row.familyName,
        gender: (row.gender as 'female' | 'male' | null) ?? null,
        email: row.invitation.email,
        role: row.invitation.role,
        accueil: await accueilDe(tx, row.personUserId, row.invitation.email),
      };
    });
  }

  /**
   * Acceptation : crée le compte (ou rattache un compte existant), le relie au
   * dossier (persons.user_id) et crée l'appartenance avec le rôle invité.
   */
  async accept(
    token: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ result: AcceptResult; session?: IssuedSession }> {
    const tokenHash = hashToken(token);
    // Argon2id AVANT la transaction : pas de travail long sous verrou.
    const passwordHash = await argonHash(password);

    const outcome = await this.db
      .withInvitationToken(tokenHash, async (tx) => {
        const [invitation] = await tx.select().from(t.invitations).limit(1);
        if (!invitation || invitation.expiresAt < new Date()) {
          problem(410, 'portal.invitation_invalid', "Cette invitation n'est plus valable");
        }

        // Le tenant est maintenant connu et prouvé par le token : on le pose
        // dans la transaction pour que les triggers d'audit puissent écrire
        // (leur policy exige app.tenant_id) et que les écritures suivantes
        // passent par les policies standard du tenant.
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${invitation.tenantId}, true)`);

        if (await dossierFerme(tx, invitation.personId)) {
          problem(410, 'portal.invitation_invalid', "Cette invitation n'est plus valable");
        }

        // Anti double-emploi : le premier UPDATE gagne, les suivants échouent.
        const marked = await tx
          .update(t.invitations)
          .set({ acceptedAt: new Date() })
          .where(and(eq(t.invitations.id, invitation.id), isNull(t.invitations.acceptedAt)))
          .returning({ id: t.invitations.id });
        if (marked.length === 0) {
          problem(410, 'portal.invitation_used', 'Cette invitation a déjà été utilisée');
        }

        const [personne] = await tx
          .select({
            userId: t.persons.userId,
            givenName: t.persons.givenName,
            familyName: t.persons.familyName,
          })
          .from(t.persons)
          .where(eq(t.persons.id, invitation.personId))
          .limit(1);
        const existing = await compteALAdresse(tx, invitation.email);

        // Trois cas. Il revient : son compte, relié au dossier, a perdu son
        // mot de passe ; il en choisit un neuf, et retrouve tout. Un compte
        // en service porte cette adresse : son mot de passe le relie. Sinon,
        // un compte neuf.
        let userId: string;
        let cas: 'retour' | 'compte' | 'nouveau';
        if (personne?.userId) {
          const [compte] = await tx
            .select({ passwordHash: t.users.passwordHash })
            .from(t.users)
            .where(eq(t.users.id, personne.userId));
          if (!compte || compte.passwordHash) {
            problem(409, 'portal.already_active', 'Ce dossier est déjà relié à un compte');
          }
          if (existing && existing.id !== personne.userId) {
            if (existing.passwordHash) {
              problem(
                409,
                'portal.adresse_prise',
                'Cette adresse est celle d’un autre compte',
                'Demandez à la Direction du Capital Humain une invitation à une autre adresse.',
              );
            }
            await libererLAdresse(tx, existing.id);
          }
          userId = personne.userId;
          cas = 'retour';
        } else if (existing?.passwordHash) {
          // Preuve de possession : relier un compte EXISTANT à un dossier exige
          // le mot de passe de CE compte. Un email saisi par l'invitant ne
          // suffit jamais à rattacher le compte d'un tiers.
          // Le même compteur que la connexion : une invitation n'ouvre pas
          // un second guichet pour deviner le mot de passe d'un compte. Compté
          // AVANT de vérifier : des essais simultanés ne passent pas tous.
          const sujet = empreinte(invitation.email);
          const verdict = await this.limiteur?.compter(ECHECS_PAR_COMPTE, sujet);
          if (verdict?.bloque) {
            problem(
              429,
              'auth.too_many_attempts',
              'Trop de tentatives',
              `Réessayez dans ${Math.ceil(verdict.reessayerDans / 60)} min.`,
            );
          }
          const owned = await argonVerify(existing.passwordHash, password);
          if (!owned || existing.status !== 'active') {
            problem(401, 'portal.existing_account', 'Mot de passe incorrect');
          }
          await this.limiteur?.oublier(ECHECS_PAR_COMPTE, sujet);
          userId = existing.id;
          cas = 'compte';
        } else {
          // Un compte fermé d'autrui garde cette adresse : elle lui est reprise.
          if (existing) await libererLAdresse(tx, existing.id);
          userId = uuidv7();
          cas = 'nouveau';
        }
        await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);

        if (cas !== 'compte') {
          // C'est ici, et seulement ici, qu'on POSE un mot de passe : la
          // politique s'applique. Relier un compte en service ne fait que
          // VÉRIFIER le sien, déjà en place : le soumettre à une règle
          // adoptée depuis interdirait de relier un compte ancien.
          const manque = passwordShortfall(password);
          if (manque) {
            problem(422, 'portal.weak_password', 'Mot de passe trop faible', manque);
          }
          if (!passwordDiffersFromEmail(password, invitation.email)) {
            problem(
              422,
              'portal.weak_password',
              'Mot de passe trop faible',
              'Le mot de passe ne doit pas reprendre votre adresse email.',
            );
          }
        }

        if (cas === 'retour') {
          // Le même compte : son mot de passe neuf, l'adresse de l'invitation,
          // son nom tel que le dossier le porte aujourd'hui.
          await tx
            .update(t.users)
            .set({
              passwordHash,
              email: invitation.email,
              givenName: personne?.givenName ?? '',
              familyName: personne?.familyName ?? '',
            })
            .where(eq(t.users.id, userId));
        } else if (cas === 'nouveau') {
          await tx.insert(t.users).values({
            id: userId,
            email: invitation.email,
            passwordHash,
            givenName: personne?.givenName ?? '',
            familyName: personne?.familyName ?? '',
          });
        }

        // Appartenance : jamais de changement de rôle silencieux. Si le compte
        // est déjà membre de l'organisation, son rôle actuel prévaut : une
        // invitation ne rétrograde ni n'élève un membre existant.
        const [member] = await tx
          .select({ id: t.userTenantMemberships.id })
          .from(t.userTenantMemberships)
          .where(
            and(
              eq(t.userTenantMemberships.tenantId, invitation.tenantId),
              eq(t.userTenantMemberships.userId, userId),
            ),
          )
          .limit(1);
        if (!member) {
          await tx.insert(t.userTenantMemberships).values({
            id: uuidv7(),
            tenantId: invitation.tenantId,
            userId,
            role: invitation.role,
          });
        }

        // Liaison conditionnelle : si la personne a été reliée entre-temps
        // (course invite/accept), on refuse au lieu d'écraser. Qui revient
        // l'est déjà, à ce même compte.
        if (cas !== 'retour') {
          const linked = await tx
            .update(t.persons)
            .set({ userId })
            .where(and(eq(t.persons.id, invitation.personId), isNull(t.persons.userId)))
            .returning({ id: t.persons.id });
          if (linked.length === 0) {
            problem(409, 'portal.already_active', 'Ce dossier est déjà relié à un compte');
          }
        }

        // Ce que la DCH lui a délégué l'attendait : les demandes en cours
        // vont désormais aussi à lui.
        await reconcilierLeCircuit(tx, invitation.tenantId);

        return { existingUser: cas === 'compte', userId, tenantId: invitation.tenantId };
      })
      .catch((err: unknown) => {
        if (pgCode(err) === '23505') {
          problem(
            409,
            'portal.email_conflict',
            'Un compte vient d’être créé avec cet email',
            'Réessayez : si ce compte est le vôtre, son mot de passe sera demandé.',
          );
        }
        throw err;
      });

    // Possession prouvée dans les deux cas (compte créé, ou mot de passe du
    // compte existant vérifié) : la session est émise directement.
    const session = await this.auth.issueSession(outcome.userId, outcome.tenantId, meta);
    return { result: { existingUser: outcome.existingUser }, session };
  }
}
