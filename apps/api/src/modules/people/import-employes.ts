import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  NATIONALITY_LABELS,
  type ContractType,
  type CreateEmployeeInput,
  type Gender,
  type IdDocumentType,
  type MaritalStatus,
} from '@teranga/contracts';
import type { CelluleXlsx } from '../../common/xlsx';

/* ————————————————————————————————————————————————————————————————
   Du fichier du RH au dossier de la plateforme.

   La RH tient son effectif dans un classeur : vingt-trois colonnes en
   français, des dates au format du pays, « Homme » et « Femme » écrits en
   toutes lettres, la direction désignée par son abrégé. La plateforme, elle,
   attend des énumérations anglaises, des dates ISO, des numéros en E.164 et
   des identifiants d'unité. Toute la traduction est ici, dans un module PUR :
   aucune écriture, aucune base — ce qui le rend testable ligne par ligne.

   Le principe de lecture : on est TOLÉRANT sur la forme, JAMAIS sur le fond.
   L'intitulé « Prénom » se reconnaît écrit « prenom » ou « PRÉNOM », une date
   passe qu'elle soit une vraie date du tableur ou du texte, et un matricule
   entouré d'espaces est nettoyé. Mais un sexe écrit « H » n'est pas deviné,
   et une ligne sans matricule ne crée rien : mieux vaut une ligne signalée
   qu'un dossier inventé.
   ———————————————————————————————————————————————————————————————— */

/** Les clés internes, dans l'ordre où le fichier type les présente. */
type Champ =
  | 'prenom'
  | 'nom'
  | 'sexe'
  | 'situation'
  | 'naissance'
  | 'paysNaissance'
  | 'piece'
  | 'numeroPiece'
  | 'delivrance'
  | 'expiration'
  | 'indicatif'
  | 'telephone'
  | 'emailPersonnel'
  | 'adresse'
  | 'matricule'
  | 'contrat'
  | 'debutContrat'
  | 'duree'
  | 'emailPro'
  | 'indicatifPro'
  | 'telephonePro'
  | 'poste'
  | 'unite'
  | 'responsable';

/**
 * Les intitulés attendus, et leurs variantes admises.
 *
 * Le premier de chaque liste est celui du fichier type — c'est lui qu'on
 * écrit dans le modèle à télécharger. Les suivants couvrent ce qu'on trouve
 * en vrai : un classeur repris d'année en année perd ses accents, gagne des
 * abréviations, et personne ne devrait refaire sa mise en forme pour importer.
 */
const INTITULES: Record<Champ, string[]> = {
  prenom: ['Prénom', 'Prénoms'],
  nom: ['Nom', 'Nom de famille'],
  sexe: ['Sexe', 'Genre'],
  situation: ['Situation matrimoniale', 'Situation familiale', 'État civil'],
  naissance: ['Date de naissance', 'Né(e) le'],
  paysNaissance: ['Pays de naissance', 'Lieu de naissance'],
  piece: ["Pièce d'identité", 'Type de pièce', "Type de pièce d'identité"],
  numeroPiece: ['Numéro de la pièce', 'Numéro de pièce', 'CNI', 'NINEA'],
  delivrance: ['Date de délivrance', 'Délivrée le'],
  expiration: ["Date d'expiration", 'Expire le'],
  indicatif: ['Indicatif téléphone', 'Indicatif'],
  telephone: ['Téléphone', 'Téléphone personnel', 'Portable'],
  emailPersonnel: ['Email personnel', 'Adresse email personnelle'],
  adresse: ['Adresse', 'Adresse personnelle', 'Domicile'],
  matricule: ['Matricule', 'N° matricule'],
  contrat: ['Type de contrat', 'Contrat'],
  debutContrat: ['Début du contrat', 'Date de début', "Date d'embauche"],
  duree: ['Durée (mois)', 'Durée', 'Durée en mois'],
  emailPro: ['Email professionnel', 'Email pro', 'Adresse email professionnelle'],
  indicatifPro: ['Indicatif téléphone professionnel', 'Indicatif pro'],
  telephonePro: ['Téléphone professionnel', 'Téléphone pro', 'Poste téléphonique'],
  poste: ['Poste', 'Fonction', 'Intitulé du poste'],
  unite: ['Direction affectée', 'Direction', 'Unité', 'Service'],
  // Le n+1 se désigne par son MATRICULE, pas par son nom : deux homonymes
  // existent dans toute agence de trois cents personnes, et un nom mal
  // orthographié ne se rattache à personne. Le matricule, lui, est unique et
  // déjà dans la colonne d'à côté.
  responsable: [
    'Matricule du responsable',
    'Matricule responsable',
    'Responsable hiérarchique',
    'Matricule du supérieur',
    'Supérieur hiérarchique',
    'N+1',
  ],
};

/** Sans ces quatre colonnes, aucune ligne ne peut créer de dossier. */
const OBLIGATOIRES: Champ[] = ['prenom', 'nom', 'matricule', 'debutContrat'];

/**
 * Deux intitulés se comparent sur leur SQUELETTE : minuscules, sans accents,
 * sans ponctuation, espaces réduits. « N° matricule », « No Matricule » et
 * « n matricule » désignent la même colonne, et c'est tout ce qui compte.
 */
export function normaliserIntitule(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const VOCABULAIRE_SEXE: Record<string, Gender> = {
  homme: 'male',
  masculin: 'male',
  m: 'male',
  femme: 'female',
  feminin: 'female',
  f: 'female',
};

const VOCABULAIRE_SITUATION: Record<string, MaritalStatus> = {
  celibataire: 'single',
  marie: 'married',
  mariee: 'married',
  divorce: 'divorced',
  divorcee: 'divorced',
  veuf: 'widowed',
  veuve: 'widowed',
};

const VOCABULAIRE_PIECE: Record<string, IdDocumentType> = {
  'carte nationale d identite': 'cni',
  cni: 'cni',
  'carte d identite': 'cni',
  'carte nationale d identite cedeao': 'cni',
  passeport: 'passport',
  passport: 'passport',
};

const VOCABULAIRE_CONTRAT: Record<string, ContractType> = {
  cdi: 'cdi',
  cdd: 'cdd',
  stage: 'stage',
  stagiaire: 'stage',
  consultant: 'consultant',
  consultance: 'consultant',
  prestataire: 'consultant',
  detachement: 'detachement',
  detache: 'detachement',
};

/** Les noms de pays en français, comme le formulaire les écrit. */
const PAYS_PAR_NOM = (() => {
  const noms = new Intl.DisplayNames(['fr'], { type: 'region' });
  const table = new Map<string, string>();
  for (const code of Object.keys(NATIONALITY_LABELS)) {
    const nom = noms.of(code);
    if (nom && nom !== code) table.set(normaliserIntitule(nom), nom);
  }
  return table;
})();

/* ————————————————— Lecture d'une cellule ————————————————— */

function texte(v: CelluleXlsx): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).trim();
  return t === '' ? undefined : t;
}

/**
 * Une date, quelle que soit la façon dont le tableur l'a gardée.
 *
 * Le classeur type donne de vraies dates ; un fichier repris à la main donne
 * du texte, et pas toujours dans le même sens. « 12/04/1990 » se lit donc
 * jour-mois-année — la convention d'ici, celle du tableur français — et
 * « 1990-04-12 » se lit comme l'ISO qu'il est. Ce qui reste ambigu est
 * REFUSÉ : une date d'embauche mal lue décale une ancienneté de dix ans.
 */
function date(v: CelluleXlsx): { iso: string } | { erreur: string } | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date) return { iso: v.toISOString().slice(0, 10) };
  const t = String(v).trim();
  if (t === '') return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fr) {
    const [, j, m, a] = fr;
    const jour = Number(j);
    const mois = Number(m);
    if (jour < 1 || jour > 31 || mois < 1 || mois > 12) {
      return { erreur: `« ${t} » n’est pas une date valide` };
    }
    return { iso: `${a}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}` };
  }
  return { erreur: `« ${t} » ne se lit pas comme une date (attendu 12/04/1990 ou 1990-04-12)` };
}

/**
 * Le numéro, tel que la plateforme le stocke.
 *
 * L'indicatif et le numéro local vivent dans deux colonnes ; on les recolle
 * et on laisse libphonenumber trancher — la même bibliothèque que le
 * formulaire de saisie, pour qu'un numéro importé et un numéro tapé
 * s'écrivent pareil. Le zéro de tête est une règle PAR PAYS (il disparaît en
 * France, il reste en Côte d'Ivoire) : on ne la réécrit pas à la main.
 */
function telephone(indicatif: CelluleXlsx, local: CelluleXlsx): string | undefined {
  const brutLocal = texte(local);
  if (!brutLocal) return undefined;
  const brutIndicatif = texte(indicatif);
  const complet = brutIndicatif
    ? `${brutIndicatif.startsWith('+') ? '' : '+'}${brutIndicatif} ${brutLocal}`
    : brutLocal;
  const analyse = parsePhoneNumberFromString(complet, 'SN');
  if (analyse) return analyse.number;
  // Numéro non reconnu : on garde ce qui est écrit plutôt que de le perdre —
  // la fiche l'affichera tel quel et la RH corrigera.
  return complet;
}

/**
 * La fin d'un contrat à durée déterminée, déduite de sa durée en mois.
 *
 * Le dernier jour est la VEILLE du jour anniversaire : un contrat de douze
 * mois commencé le 20 mai 2024 s'achève le 19 mai 2025. C'est la lecture d'un
 * terme exprimé en mois, et c'est aussi ce que la plateforme entend par « fin
 * de contrat » — la date affichée est le dernier jour travaillé.
 *
 * Le 31 d'un mois qui n'en compte que trente ne déborde pas sur le mois
 * suivant : on retient le dernier jour du mois atteint.
 */
export function finDeContrat(debutIso: string, mois: number): string {
  const [a, m, j] = debutIso.split('-').map(Number) as [number, number, number];
  const cible = new Date(Date.UTC(a, m - 1 + mois, j));
  // Débordement : le 31 janvier + 1 mois donnerait le 3 mars.
  if (cible.getUTCDate() !== j) cible.setUTCDate(0);
  cible.setUTCDate(cible.getUTCDate() - 1);
  return cible.toISOString().slice(0, 10);
}

/* ————————————————— La conversion d'une ligne ————————————————— */

export interface LigneConvertie {
  matricule: string;
  nom: string;
  poste: string | null;
  /** L'abrégé écrit dans le fichier, à résoudre contre l'organigramme. */
  uniteAbrege: string | null;
  /** Le matricule du n+1 écrit dans le fichier, à résoudre contre l'effectif. */
  responsableMatricule: string | null;
  /** Prête à passer à la création de dossier, orgUnitId non résolu. */
  entree: Omit<CreateEmployeeInput, 'assignment'> & {
    assignment?: { positionTitle: string; startDate: string };
  };
}

export interface LigneRefusee {
  matricule: string | null;
  nom: string | null;
  motif: string;
  colonne: string | null;
}

export type Correspondance = Partial<Record<Champ, number>>;

/**
 * Où se trouve chaque champ dans la ligne d'en-tête.
 *
 * On ne se fie pas à l'ORDRE des colonnes : une colonne insérée au milieu du
 * fichier ne doit pas décaler tout l'import. On cherche les intitulés.
 */
export function correspondre(entetes: CelluleXlsx[]): {
  colonnes: Correspondance;
  inconnues: string[];
  manquantes: string[];
} {
  const index = new Map<string, Champ>();
  for (const [champ, variantes] of Object.entries(INTITULES) as [Champ, string[]][]) {
    for (const v of variantes) index.set(normaliserIntitule(v), champ);
  }

  const colonnes: Correspondance = {};
  const inconnues: string[] = [];
  entetes.forEach((brut, i) => {
    const t = texte(brut);
    if (!t) return;
    const champ = index.get(normaliserIntitule(t));
    if (!champ) inconnues.push(t);
    else if (colonnes[champ] === undefined) colonnes[champ] = i;
  });

  const manquantes = OBLIGATOIRES.filter((c) => colonnes[c] === undefined).map(
    (c) => INTITULES[c][0]!,
  );
  return { colonnes, inconnues, manquantes };
}

/** Le premier intitulé d'un champ — celui qu'on cite dans un message. */
const nomColonne = (champ: Champ): string => INTITULES[champ][0]!;

/**
 * Une ligne du fichier, en dossier à créer — ou en refus expliqué.
 *
 * Les refus nomment TOUJOURS la colonne : la RH corrige dans son tableur, et
 * « ligne 7, colonne Sexe » se retrouve, là où « donnée invalide » ne se
 * cherche pas.
 */
export function convertirLigne(
  valeurs: CelluleXlsx[],
  colonnes: Correspondance,
): { ok: LigneConvertie } | { refus: LigneRefusee } {
  const lire = (champ: Champ): CelluleXlsx => {
    const i = colonnes[champ];
    return i === undefined ? null : (valeurs[i] ?? null);
  };
  const lireTexte = (champ: Champ) => texte(lire(champ));

  const prenom = lireTexte('prenom');
  const nom = lireTexte('nom');
  const matricule = lireTexte('matricule');
  const nomComplet = [prenom, nom].filter(Boolean).join(' ') || null;

  const refus = (motif: string, colonne: Champ | null): { refus: LigneRefusee } => ({
    refus: {
      matricule: matricule ?? null,
      nom: nomComplet,
      motif,
      colonne: colonne && nomColonne(colonne),
    },
  });

  if (!prenom) return refus('Le prénom manque', 'prenom');
  if (!nom) return refus('Le nom manque', 'nom');
  if (!matricule) return refus('Le matricule manque', 'matricule');

  const debut = date(lire('debutContrat'));
  if (!debut) return refus('La date de début du contrat manque', 'debutContrat');
  if ('erreur' in debut) return refus(debut.erreur, 'debutContrat');

  // Les dates facultatives : une erreur de FORME se signale, une absence non.
  const dates: Partial<Record<'naissance' | 'delivrance' | 'expiration', string>> = {};
  for (const champ of ['naissance', 'delivrance', 'expiration'] as const) {
    const d = date(lire(champ));
    if (d === undefined) continue;
    if ('erreur' in d) return refus(d.erreur, champ);
    dates[champ] = d.iso;
  }

  const sexeBrut = lireTexte('sexe');
  const sexe = sexeBrut ? VOCABULAIRE_SEXE[normaliserIntitule(sexeBrut)] : undefined;
  if (sexeBrut && !sexe) return refus(`« ${sexeBrut} » n’est ni Homme ni Femme`, 'sexe');

  const situationBrute = lireTexte('situation');
  const situation = situationBrute
    ? VOCABULAIRE_SITUATION[normaliserIntitule(situationBrute)]
    : undefined;
  if (situationBrute && !situation) {
    return refus(
      `« ${situationBrute} » ne se comprend pas (attendu Célibataire, Marié(e), Divorcé(e) ou Veuf/Veuve)`,
      'situation',
    );
  }

  const pieceBrute = lireTexte('piece');
  const piece = pieceBrute ? VOCABULAIRE_PIECE[normaliserIntitule(pieceBrute)] : undefined;
  if (pieceBrute && !piece) {
    return refus(
      `« ${pieceBrute} » n’est pas un type de pièce connu (attendu Carte Nationale d'Identité ou Passeport)`,
      'piece',
    );
  }

  const numeroPiece = lireTexte('numeroPiece');
  // La règle du produit, appliquée ici pour la dire AVANT l'écriture : un
  // numéro sans type n'est pas exploitable, et l'API le refuserait sans
  // pouvoir nommer la ligne du fichier.
  if (numeroPiece && !piece) {
    return refus('Le numéro de pièce est donné sans son type', 'piece');
  }
  if (dates.expiration && dates.expiration < new Date().toISOString().slice(0, 10)) {
    return refus(`La pièce d’identité est expirée depuis le ${dates.expiration}`, 'expiration');
  }

  const paysBrut = lireTexte('paysNaissance');
  const pays = paysBrut ? PAYS_PAR_NOM.get(normaliserIntitule(paysBrut)) : undefined;
  if (paysBrut && !pays) return refus(`Pays inconnu : « ${paysBrut} »`, 'paysNaissance');

  const contratBrut = lireTexte('contrat');
  const contrat = contratBrut ? VOCABULAIRE_CONTRAT[normaliserIntitule(contratBrut)] : undefined;
  if (contratBrut && !contrat) {
    return refus(`« ${contratBrut} » n’est pas un type de contrat connu`, 'contrat');
  }

  const dureeBrute = lire('duree');
  let fin: string | undefined;
  if (dureeBrute !== null && dureeBrute !== '' && dureeBrute !== undefined) {
    const mois = Number(String(dureeBrute).replace(',', '.'));
    if (!Number.isFinite(mois) || mois <= 0 || mois > 600) {
      return refus(`« ${String(dureeBrute)} » n’est pas une durée en mois`, 'duree');
    }
    if (contrat === 'cdi') {
      // Le classeur type le dit dans sa note de colonne : la durée ne
      // concerne que les CDD et les stages. Une durée sur un CDI est une
      // erreur de saisie, pas une fin de contrat à inventer.
      return refus('Un CDI ne prend pas de durée', 'duree');
    }
    fin = finDeContrat(debut.iso, Math.round(mois));
  }

  const emailPersonnel = lireTexte('emailPersonnel');
  const emailPro = lireTexte('emailPro');
  for (const [valeur, champ] of [
    [emailPersonnel, 'emailPersonnel'],
    [emailPro, 'emailPro'],
  ] as [string | undefined, Champ][]) {
    if (valeur && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur)) {
      return refus(`« ${valeur} » n’est pas une adresse email`, champ);
    }
  }

  const poste = lireTexte('poste') ?? null;

  return {
    ok: {
      matricule,
      nom: `${prenom} ${nom}`,
      poste,
      uniteAbrege: lireTexte('unite') ?? null,
      responsableMatricule: lireTexte('responsable') ?? null,
      entree: {
        person: {
          givenName: prenom,
          familyName: nom,
          ...(sexe ? { gender: sexe } : {}),
          ...(dates.naissance ? { birthDate: dates.naissance } : {}),
          ...(pays ? { birthPlace: pays } : {}),
          ...(situation ? { maritalStatus: situation } : {}),
          ...(numeroPiece ? { nationalId: numeroPiece } : {}),
          ...(piece ? { idDocumentType: piece } : {}),
          ...(dates.delivrance ? { idDocumentIssuedOn: dates.delivrance } : {}),
          ...(dates.expiration ? { idDocumentExpiresOn: dates.expiration } : {}),
          ...(emailPersonnel ? { personalEmail: emailPersonnel } : {}),
          ...(telephone(lire('indicatif'), lire('telephone'))
            ? { phone: telephone(lire('indicatif'), lire('telephone')) }
            : {}),
          ...(lireTexte('adresse') ? { addressLine: lireTexte('adresse') } : {}),
        },
        employee: {
          employeeNumber: matricule,
          // Première embauche : la date du contrat fait l'entrée dans
          // l'organisation. Le fichier n'en distingue pas deux.
          hiredOn: debut.iso,
          ...(emailPro ? { workEmail: emailPro } : {}),
          ...(telephone(lire('indicatifPro'), lire('telephonePro'))
            ? { workPhone: telephone(lire('indicatifPro'), lire('telephonePro')) }
            : {}),
        },
        ...(contrat
          ? {
              contract: {
                contractType: contrat,
                startDate: debut.iso,
                ...(fin ? { endDate: fin } : {}),
              },
            }
          : {}),
        ...(poste ? { assignment: { positionTitle: poste, startDate: debut.iso } } : {}),
      },
    },
  };
}
