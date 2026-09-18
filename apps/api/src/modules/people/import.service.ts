import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { LigneImport, RapportImportEmployes, SessionUser } from '@teranga/contracts';
import { problem } from '../../common/problem';
import { lirePremiereFeuille, XlsxIllisible } from '../../common/xlsx';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { convertirLigne, correspondre } from './import-employes';
import { PeopleService } from './people.service';

/* ————————————————————————————————————————————————————————————————
   L'import d'un fichier d'effectif.

   Saisir trois cents dossiers à la main, c'est trois cents fois quinze
   champs : personne ne le fait, et c'est pour cela qu'un SIRH se remplit
   d'abord par un classeur. Le fichier de la RH devient donc la source, et
   cet import son point d'entrée.

   ——— Il ne se fait jamais à l'aveugle

   Le même envoi sert DEUX FOIS. La première, en aperçu : on lit, on traduit,
   on vérifie, on rend le compte rendu — et on n'écrit rien. La seconde, une
   fois le compte rendu approuvé, applique. Deux envois d'un fichier de vingt
   kilooctets ne coûtent rien, et l'alternative — garder le fichier entre les
   deux appels — demanderait un dépôt temporaire, sa durée de vie, son
   nettoyage, pour économiser une seconde.

   ——— Trois règles, décidées avec la RH

   1. UN MATRICULE DÉJÀ PRÉSENT est ignoré, jamais écrasé. Le dossier de la
      plateforme peut être plus riche que la ligne du fichier (pièces,
      affectations successives, portail ouvert) : un import qui le remplace
      détruit ce que personne n'a demandé à détruire.
   2. UN ABRÉGÉ D'UNITÉ INCONNU ne perd pas l'agent. Le dossier est créé avec
      son poste, sans rattachement, et le rapport le dit. Refuser la ligne
      punirait l'agent d'une direction qui n'est pas encore dans
      l'organigramme.
   3. UNE LIGNE FAUTIVE n'arrête pas les autres. Chaque dossier est créé dans
      sa propre transaction : la ligne 50 peut échouer sans annuler les
      quarante-neuf précédentes, et le rapport nomme la ligne ET la colonne
      pour que la RH corrige dans son tableur.
   ———————————————————————————————————————————————————————————————— */

/** Au-delà, c'est un fichier qu'on n'importe pas : c'est une migration. */
const MAX_LIGNES = 5_000;

@Injectable()
export class ImportEmployesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(PeopleService) private readonly people: PeopleService,
  ) {}

  async importer(
    user: SessionUser,
    fichier: Buffer,
    appliquer: boolean,
  ): Promise<RapportImportEmployes> {
    const feuille = this.lire(fichier);
    const [entetes, ...donnees] = feuille.lignes;
    if (!entetes) {
      problem(422, 'import.vide', 'Le fichier ne contient aucune ligne');
    }
    if (donnees.length > MAX_LIGNES) {
      problem(422, 'import.trop_long', `Le fichier dépasse ${MAX_LIGNES} lignes`);
    }

    const { colonnes, inconnues, manquantes } = correspondre(entetes);
    const vide: RapportImportEmployes = {
      feuille: feuille.nom,
      colonnesInconnues: inconnues,
      colonnesManquantes: manquantes,
      lignes: [],
      total: 0,
      aCreer: 0,
      ignores: 0,
      erreurs: 0,
      sansUnite: 0,
      rattaches: 0,
      sansResponsable: 0,
      applique: false,
      crees: 0,
    };
    // Une colonne obligatoire absente : on s'arrête AVANT de parler des
    // lignes. Rendre quatre-vingts erreurs identiques quand il n'en faut
    // qu'une — « la colonne Matricule manque » — noie la seule qui compte.
    if (manquantes.length > 0) return vide;

    const { employesParMatricule, unitesParAbrege } = await this.contexte(user);

    // Les matricules vus DANS LE FICHIER : deux lignes ne peuvent pas créer
    // le même dossier, et la deuxième s'ignore comme un doublon de base.
    const vusDansLeFichier = new Map<string, number>();
    const lignes: LigneImport[] = [];
    const aCreer: { ligne: number; converti: ReturnType<typeof convertirLigne> }[] = [];

    donnees.forEach((valeurs, i) => {
      // +2 : la ligne 1 porte les en-têtes, et la RH compte depuis 1.
      const numero = i + 2;
      // Une ligne entièrement vide n'est pas une erreur : les classeurs en
      // traînent souvent quelques-unes en bas, laissées par une suppression.
      if (valeurs.every((v) => v === null || v === undefined || String(v).trim() === '')) return;

      const converti = convertirLigne(valeurs, colonnes);
      if ('refus' in converti) {
        lignes.push({
          ligne: numero,
          matricule: converti.refus.matricule,
          nom: converti.refus.nom,
          poste: null,
          uniteAbrege: null,
          uniteResolue: null,
          responsable: null,
          responsableResolu: null,
          etat: 'erreur',
          motif: converti.refus.motif,
          colonne: converti.refus.colonne,
          avertissements: [],
        });
        return;
      }

      const { matricule, nom, poste, uniteAbrege, responsableMatricule } = converti.ok;
      // L'unité se résout AVANT qu'on sache si la ligne sera écrite : la
      // colonne « Direction » du compte rendu dit ce que la plateforme a
      // compris de l'abrégé, et une ligne ignorée pour doublon n'a pas pour
      // autant une direction inconnue. Sans cela, le rejeu d'un fichier déjà
      // importé affichait TOUS ses abrégés comme introuvables.
      const unite = uniteAbrege ? unitesParAbrege.get(normaliser(uniteAbrege)) : undefined;
      const dejaLa = employesParMatricule.has(cleMatricule(matricule));
      const dejaVu = vusDansLeFichier.get(matricule);
      if (dejaLa || dejaVu !== undefined) {
        lignes.push({
          ligne: numero,
          matricule,
          nom,
          poste,
          uniteAbrege,
          uniteResolue: unite?.nom ?? null,
          responsable: responsableMatricule,
          responsableResolu: null,
          etat: 'ignore',
          motif: dejaLa
            ? 'Ce matricule existe déjà dans la plateforme — le dossier reste inchangé'
            : `Ce matricule apparaît déjà à la ligne ${dejaVu}`,
          colonne: 'Matricule',
          avertissements: [],
        });
        return;
      }
      vusDansLeFichier.set(matricule, numero);

      lignes.push({
        ligne: numero,
        matricule,
        nom,
        poste,
        uniteAbrege,
        uniteResolue: unite?.nom ?? null,
        responsable: responsableMatricule,
        // Résolu dans une seconde passe : le responsable peut se trouver PLUS
        // BAS dans le même fichier, et l'on ne le sait qu'après avoir lu
        // toutes les lignes.
        responsableResolu: null,
        etat: 'a-creer',
        motif: null,
        colonne: null,
        avertissements:
          uniteAbrege && !unite
            ? [
                {
                  colonne: 'Direction affectée',
                  // Sans temps : le même texte se relit dans l'aperçu
                  // (« sera créé ») et dans le compte rendu d'après.
                  texte: 'Abrégé inconnu dans l’organigramme : dossier sans rattachement',
                },
              ]
            : [],
      });
      aCreer.push({ ligne: numero, converti });
    });

    // ——— Les responsables hiérarchiques, une fois TOUTES les lignes lues ———
    //
    // Le n+1 d'un agent peut se trouver plus bas dans le même fichier : on ne
    // peut donc pas le résoudre à la volée. Deux sources, dans cet ordre :
    // l'effectif déjà en base, puis les dossiers que ce fichier va créer.
    const aNaitre = new Map<string, string>();
    for (const l of lignes) {
      if (l.etat === 'a-creer' && l.matricule && l.nom)
        aNaitre.set(cleMatricule(l.matricule), l.nom);
    }
    for (const l of lignes) {
      if (l.etat !== 'a-creer' || !l.responsable) continue;
      const cle = cleMatricule(l.responsable);
      if (l.matricule && cle === cleMatricule(l.matricule)) {
        l.avertissements.push({
          colonne: NOM_COLONNE_RESPONSABLE,
          texte: 'Un agent ne peut pas être son propre responsable : dossier créé sans n+1',
        });
        continue;
      }
      const nom = employesParMatricule.get(cle)?.nom ?? aNaitre.get(cle) ?? null;
      if (nom) {
        l.responsableResolu = nom;
      } else {
        l.avertissements.push({
          colonne: NOM_COLONNE_RESPONSABLE,
          texte: `Matricule « ${l.responsable} » introuvable : dossier créé sans n+1`,
        });
      }
    }

    const compter = (lignesRapport: LigneImport[]) => ({
      aCreer: lignesRapport.filter((l) => l.etat === 'a-creer').length,
      ignores: lignesRapport.filter((l) => l.etat === 'ignore').length,
      erreurs: lignesRapport.filter((l) => l.etat === 'erreur').length,
      sansUnite: lignesRapport.filter(
        (l) => l.etat === 'a-creer' && l.uniteAbrege && !l.uniteResolue,
      ).length,
      rattaches: lignesRapport.filter((l) => l.etat === 'a-creer' && l.responsableResolu).length,
      sansResponsable: lignesRapport.filter((l) => l.etat === 'a-creer' && !l.responsableResolu)
        .length,
    });

    const rapport: RapportImportEmployes = {
      ...vide,
      lignes,
      total: lignes.length,
      ...compter(lignes),
    };
    if (!appliquer) return rapport;

    // ——— L'écriture : on crée TOUT, puis on rattache ———
    //
    // Deux passes, et c'est le fichier qui l'impose : la ligne 3 peut relever
    // de la ligne 40, qui n'existe pas encore quand on écrit la troisième.
    // Créer d'abord, rattacher ensuite, c'est le seul ordre qui marche sans
    // demander au RH de trier son classeur.
    let crees = 0;
    const nes = new Map<string, string>();
    for (const { ligne, converti } of aCreer) {
      if (!('ok' in converti)) continue;
      const { entree, uniteAbrege, matricule } = converti.ok;
      const unite = uniteAbrege ? unitesParAbrege.get(normaliser(uniteAbrege)) : undefined;
      try {
        const { id } = await this.people.create(user, {
          ...entree,
          ...(entree.assignment
            ? {
                assignment: {
                  positionTitle: entree.assignment.positionTitle,
                  startDate: entree.assignment.startDate,
                  ...(unite ? { orgUnitId: unite.id } : {}),
                },
              }
            : {}),
        });
        nes.set(cleMatricule(matricule), id);
        crees++;
      } catch (err) {
        // La ligne échoue seule. Le cas courant : un matricule créé entre
        // l'aperçu et l'application, par quelqu'un d'autre.
        const cible = rapport.lignes.find((l) => l.ligne === ligne);
        if (cible) {
          cible.etat = 'erreur';
          cible.motif = messageDErreur(err);
          cible.colonne = null;
        }
      }
    }

    // ——— Seconde passe : les rattachements ———
    for (const l of rapport.lignes) {
      if (l.etat !== 'a-creer' || !l.responsable || !l.responsableResolu || !l.matricule) continue;
      const id = nes.get(cleMatricule(l.matricule));
      const cleResp = cleMatricule(l.responsable);
      const responsableId = employesParMatricule.get(cleResp)?.id ?? nes.get(cleResp) ?? null;
      if (!id || !responsableId) continue;
      try {
        await this.people.update(user, id, { employee: { managerEmployeeId: responsableId } });
      } catch (err) {
        // Le dossier RESTE : seul le rattachement échoue. Le cas courant est
        // la règle de direction — un responsable d'une autre direction —, et
        // c'est exactement ce que la RH doit lire pour corriger son classeur.
        l.responsableResolu = null;
        l.avertissements.push({ colonne: NOM_COLONNE_RESPONSABLE, texte: messageDErreur(err) });
      }
    }

    return {
      ...rapport,
      ...compter(rapport.lignes),
      applique: true,
      crees,
    };
  }

  private lire(fichier: Buffer) {
    try {
      return lirePremiereFeuille(fichier);
    } catch (err) {
      if (err instanceof XlsxIllisible) {
        problem(422, 'import.illisible', err.message);
      }
      throw err;
    }
  }

  /**
   * Ce qu'il faut savoir AVANT de lire les lignes : les matricules déjà pris
   * et les unités de l'organigramme. Deux requêtes, pas deux par ligne.
   */
  private async contexte(user: SessionUser) {
    return this.db.withTenant(ctxOf(user), async (tx: Tx) => {
      // Le nom et l'identifiant en plus du matricule : le fichier désigne le
      // n+1 par son matricule, et le compte rendu doit pouvoir écrire son nom
      // — puis le rattachement, son identifiant.
      const employes = await tx
        .select({
          id: t.employees.id,
          numero: t.employees.employeeNumber,
          prenom: t.persons.givenName,
          nom: t.persons.familyName,
        })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.employees.tenantId, user.tenantId));
      const unites = await tx
        .select({
          id: t.orgUnits.id,
          nom: t.orgUnits.name,
          abrege: t.orgUnits.shortName,
        })
        .from(t.orgUnits)
        .where(and(eq(t.orgUnits.tenantId, user.tenantId), isNull(t.orgUnits.deletedAt)));

      // On accepte l'abrégé ET le nom complet : un fichier peut écrire
      // « DCH » comme « Direction du Capital Humain », et les deux désignent
      // la même unité.
      const unitesParAbrege = new Map<string, { id: string; nom: string }>();
      for (const u of unites) {
        const valeur = { id: u.id, nom: u.nom };
        if (u.abrege) unitesParAbrege.set(normaliser(u.abrege), valeur);
        unitesParAbrege.set(normaliser(u.nom), valeur);
      }
      const employesParMatricule = new Map<string, { id: string; nom: string }>();
      for (const e of employes) {
        employesParMatricule.set(cleMatricule(e.numero), {
          id: e.id,
          nom: `${e.prenom} ${e.nom}`,
        });
      }
      return { employesParMatricule, unitesParAbrege };
    });
  }
}

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

/** L'intitulé du fichier type, pour situer les avertissements du n+1. */
const NOM_COLONNE_RESPONSABLE = 'Matricule du responsable';

/**
 * La clé d'un matricule : ce qui doit se retrouver malgré la frappe.
 *
 * « APIX-0001 », « apix 0001 » et « APIX0001 » désignent la même personne dans
 * un classeur tenu à la main depuis des années — et c'est par ce matricule
 * qu'on rattache un agent à son n+1. On compare donc les lettres et les
 * chiffres, sans la casse ni les séparateurs.
 */
function cleMatricule(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Même squelette que les intitulés de colonnes : « D.C.H » vaut « dch ». */
function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function messageDErreur(err: unknown): string {
  const probleme = (err as { response?: { detail?: string } }).response?.detail;
  if (typeof probleme === 'string') return probleme;
  return err instanceof Error && err.message ? err.message : 'Création impossible';
}
