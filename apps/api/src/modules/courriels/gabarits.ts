import { deElide, premierDuMois } from '@teranga/contracts';
import { MARGE_DU_LOGO, type LogoCourriel } from './logo';

/* ────────────────────────────────────────────────────────────────
   Ce que disent les courriels, et à quoi ils ressemblent.

   Court, et rien de plus que ce que la plateforme montre déjà à la même
   personne : un courriel se transfère, se lit par-dessus l'épaule, dort dans
   une boîte des années. Le lien mène au portail, où le reste se lit derrière
   un mot de passe.

   L'habit suit la charte de l'APIX de 2026, comme le certificat d'APIX
   Academy (ADR-0186) : une feuille blanche sur le fond #F5F7F9 ; en tête,
   le logo et « Direction du Capital Humain » au-dessus d'un filet ; un
   surtitre, le titre souligné d'un filet orange, le bouton bleu ; en bas, la
   courbe bleue de la charte, soulignée d'orange. Raleway pour le texte, Exo
   pour les mentions, Anton pour l'en-tête, servies par le site.

   Les messageries n'en rendent pas toutes autant. La mise en page tient dans
   des tableaux et des styles en ligne, et chaque effet a son repli :
   - les polices : sans elles (Gmail, Outlook), Segoe UI, Roboto, Helvetica
     ou Arial ;
   - Outlook sur Windows : des angles droits, mais le bouton reste arrondi
     (VML) ;
   - le thème sombre : le fond s'assombrit, la feuille reste blanche ; une
     messagerie qui assombrit tout garde le logo lisible sur son fond blanc ;
   - les images bloquées : le texte du logo dit l'organisation, et rien
     d'autre ne manque à la lecture.
   ──────────────────────────────────────────────────────────────── */

export interface ContenuCourriel {
  subject: string;
  text: string;
  html: string;
}

/** Ce qu'un courriel dit, gardé tel quel jusqu'à son départ. */
export type Gabarit =
  | {
      nom: 'invitation';
      prenom: string;
      organisation: string;
      lien: string;
      /** ISO 8601. */
      expireLe: string;
      /** Absent : un nouveau compte (cf. AccueilInvitation). */
      accueil?: 'retour' | 'compte';
    }
  | { nom: 'notification'; prenom: string; organisation: string; titre: string; lien: string }
  | { nom: 'reinitialisation'; prenom: string; organisation: string; lien: string }
  | ({ nom: 'accuse_candidature' } & AuCandidat)
  | ({ nom: 'refus_candidature' } & AuCandidat);

/** Ce que disent les courriels au candidat : l'accusé de réception, le refus. */
interface AuCandidat {
  prenom: string;
  organisation: string;
  poste: string;
  reference: string | null;
}

/** Ce qui ne se décide qu'au départ : le logo, l'adresse du site (polices), l'année. */
export interface Rendu {
  logo: LogoCourriel | null;
  portail: string;
  annee?: number;
}

/** Les couleurs de la charte : ses deux principales, et deux de ses secondaires pour le texte. */
const BLEU = '#004f91';
const ORANGE = '#ca631f';
/** L'orange des petits textes : #ca631f n'atteint pas 4,5:1 sur le blanc. */
const ORANGE_TEXTE = '#b14600';
const ANTHRACITE = '#383838';
const ARDOISE = '#546775';
const FILET = '#dfe6ee';
const FOND = '#f5f7f9';

/** Les polices de la charte, puis celles du système, pour les messageries qui ne les chargent pas. */
const SYSTEME = "'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";
const RALEWAY = `Raleway,${SYSTEME}`;
const EXO = `Exo,${SYSTEME}`;
const ANTON = "Anton,'Arial Narrow','Helvetica Neue',Arial,sans-serif";

/** Les plages des sous-ensembles servis par le site (apps/web/scripts/fetch-mail-fonts.mjs). */
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_ETENDU =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF';

/** Les polices du courriel, prises sur le site. */
function polices(portail: string): string {
  const familles = [
    ['Raleway', 'raleway', '400 700'],
    ['Exo', 'exo', '400 700'],
    ['Anton', 'anton', '400'],
  ] as const;
  return familles
    .flatMap(([famille, fichier, graisses]) =>
      (
        [
          ['latin-ext', LATIN_ETENDU],
          ['latin', LATIN],
        ] as const
      ).map(
        ([sousEnsemble, plage]) =>
          `@font-face{font-family:'${famille}';font-style:normal;font-weight:${graisses};font-display:swap;src:url('${portail}/fonts/${fichier}-${sousEnsemble}.woff2') format('woff2');unicode-range:${plage};}`,
      ),
    )
    .join('\n');
}

/** Le surtitre de chaque courriel : ce dont il parle, d'un mot. */
const SURTITRES: Record<Gabarit['nom'], string> = {
  invitation: 'Portail RH',
  reinitialisation: 'Portail RH',
  notification: 'Notification',
  accuse_candidature: 'Recrutement',
  refus_candidature: 'Recrutement',
};

const echapper = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Un texte à lire, échappé, aux espaces insécables de la typographie
 * française : avant « ? », « ! », « : », « ; », dans les guillemets et dans
 * une date (« 14 novembre 2026 » ne se coupe pas).
 */
const enClair = (v: string) =>
  echapper(v)
    .replace(/ ([?!:;»])/g, '\u00a0$1')
    .replace(/« /g, '«\u00a0')
    .replace(/(\d{1,2}(?:er)?) (\p{Ll}+) (\d{4})/gu, '$1\u00a0$2\u00a0$3');

const dateLongue = (iso: string) =>
  premierDuMois(
    new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Dakar',
    }),
  );

/** « au poste de Chargé d'études », « au poste d'Analyste ». */
const auPoste = (poste: string) => `au poste ${deElide(poste).replace("'", '’')}${poste}`;

/** L'objet dit la chose, sans le nom de l'organisation devant. */
export function objetDe(g: Gabarit): string {
  if (g.nom === 'invitation') return 'Votre accès au portail RH';
  if (g.nom === 'reinitialisation') return 'Votre mot de passe';
  if (g.nom === 'refus_candidature') return `Votre candidature ${auPoste(g.poste)}`;
  if (g.nom === 'accuse_candidature') {
    return `Nous avons bien reçu votre candidature ${auPoste(g.poste)}`;
  }
  return g.titre;
}

/**
 * Le refus d'une candidature : remercier, dire la décision sans détour, ne
 * pas fermer la porte. Aucun lien : le candidat n'a pas de compte, et rien
 * ne l'attend ailleurs.
 */
function lettreDeRefus(g: LettreAuCandidat): string[] {
  return [
    `Nous vous remercions de l’intérêt que vous portez à ${g.organisation} et du temps que vous avez consacré à votre candidature ${auPoste(g.poste)}.`,
    'Votre dossier a été étudié avec attention. Nous sommes toutefois au regret de vous informer qu’il n’a pas été retenu, votre profil ne correspondant pas entièrement aux critères recherchés pour ce poste.',
    'Cette décision ne remet en cause ni vos compétences ni votre parcours. Nous vous invitons à consulter nos prochaines offres et à y postuler si elles correspondent à votre projet.',
    'Nous vous souhaitons pleine réussite dans la suite de vos démarches.',
  ];
}

/**
 * L'accusé de réception : le dossier est arrivé, il sera étudié, la réponse
 * viendra par courriel (refus, cf. lettreDeRefus, ou suite du recrutement).
 */
function lettreDAccuse(g: LettreAuCandidat): string[] {
  return [
    `Nous accusons bonne réception de votre candidature ${auPoste(g.poste)} et vous remercions de l’intérêt que vous portez à ${g.organisation}.`,
    'Votre dossier va être étudié avec attention par la Direction du Capital Humain. Nous reviendrons vers vous par courriel dès que son examen sera terminé.',
  ];
}

type LettreAuCandidat = Extract<Gabarit, { nom: 'accuse_candidature' | 'refus_candidature' }>;

const SIGNATURE_DCH = ['Cordialement,', 'La Direction du Capital Humain'];

/** Le lien « mot de passe oublié » vaut une heure (cf. REINITIALISATION_TTL_MINUTES). */
const APRES_REINITIALISATION = [
  'Ce lien est personnel et valable une heure.',
  'Si vous n’avez rien demandé, ignorez ce courriel : votre mot de passe restera inchangé.',
];

/** L'invitation selon qui la reçoit : un nouveau compte, un retour, un compte en service. */
const ACCUEILS = {
  nouveau: {
    titre: 'Bienvenue',
    accroche: 'La DCH vous invite à activer votre compte.',
    apercu: 'Choisissez votre mot de passe pour accéder au portail RH.',
    consigne: 'Pour choisir votre mot de passe',
    bouton: 'Choisir mon mot de passe',
  },
  retour: {
    titre: 'Bon retour',
    accroche: 'La DCH vous invite à réactiver votre compte.',
    apercu: 'Choisissez un nouveau mot de passe pour retrouver votre compte.',
    consigne: 'Pour choisir votre nouveau mot de passe',
    bouton: 'Choisir mon mot de passe',
  },
  compte: {
    titre: 'Bienvenue',
    accroche: 'La DCH vous invite à relier votre compte.',
    apercu: 'Reliez votre compte à votre dossier sur le portail RH.',
    consigne: 'Pour relier votre compte',
    bouton: 'Relier mon compte',
  },
} as const;

/** Sous chaque courriel : personne ne lit les réponses (cf. transports.ts). */
export const SANS_REPONSE = 'Message automatique, merci de ne pas y répondre.';

export function composer(g: Gabarit, rendu: Rendu): ContenuCourriel {
  const c = corps(g, rendu);
  return { ...c, text: `${c.text}\n\n${SANS_REPONSE}` };
}

function corps(g: Gabarit, rendu: Rendu): ContenuCourriel {
  const subject = objetDe(g);
  if (g.nom === 'invitation') {
    const jusquau = dateLongue(g.expireLe);
    const a = ACCUEILS[g.accueil ?? 'nouveau'];
    const accroche = a.accroche;
    return {
      subject,
      text: [
        `Bonjour ${g.prenom},`,
        '',
        accroche,
        '',
        `${a.consigne}, ouvrez ce lien :`,
        g.lien,
        '',
        `Ce lien est personnel et valable jusqu’au ${jusquau}.`,
        'Si vous n’attendiez pas ce courriel, ignorez-le.',
      ].join('\n'),
      html: page(rendu, {
        organisation: g.organisation,
        apercu: a.apercu,
        surtitre: SURTITRES.invitation,
        titre: `${a.titre}, ${g.prenom}`,
        texte: accroche,
        bouton: { libelle: a.bouton, lien: g.lien },
        apres: [
          `Ce lien est personnel et valable jusqu’au ${jusquau}.`,
          'Si vous n’attendiez pas ce courriel, ignorez-le.',
        ],
      }),
    };
  }
  if (g.nom === 'refus_candidature' || g.nom === 'accuse_candidature') {
    const lettre = g.nom === 'refus_candidature' ? lettreDeRefus(g) : lettreDAccuse(g);
    const reference = g.reference ? `Référence de l’offre : ${g.reference}` : null;
    return {
      subject,
      text: [
        `Bonjour ${g.prenom},`,
        '',
        ...lettre.flatMap((p) => [p, '']),
        ...SIGNATURE_DCH,
        ...(reference ? ['', reference] : []),
      ].join('\n'),
      html: page(rendu, {
        organisation: g.organisation,
        apercu: lettre[0]!,
        surtitre: SURTITRES[g.nom],
        titre: g.nom === 'refus_candidature' ? 'Votre candidature' : 'Candidature reçue',
        sousTitre: g.poste,
        ...(g.reference ? { reference: g.reference } : {}),
        lettre: {
          paragraphes: [`Bonjour ${g.prenom},`, ...lettre],
          signature: SIGNATURE_DCH,
        },
        apres: [],
      }),
    };
  }
  if (g.nom === 'reinitialisation') {
    return {
      subject,
      text: [
        `Bonjour ${g.prenom},`,
        '',
        'Pour choisir votre nouveau mot de passe, ouvrez ce lien :',
        g.lien,
        '',
        ...APRES_REINITIALISATION,
      ].join('\n'),
      html: page(rendu, {
        organisation: g.organisation,
        apercu: 'Choisissez votre nouveau mot de passe.',
        surtitre: SURTITRES.reinitialisation,
        salutation: `Bonjour ${g.prenom},`,
        titre: 'Mot de passe oublié',
        texte: 'Choisissez votre nouveau mot de passe.',
        bouton: { libelle: 'Choisir mon mot de passe', lien: g.lien },
        apres: APRES_REINITIALISATION,
      }),
    };
  }
  return {
    subject,
    text: [
      `Bonjour ${g.prenom},`,
      '',
      g.titre,
      '',
      'Pour la voir sur le portail RH :',
      g.lien,
      '',
      `Gérer mes notifications : ${rendu.portail.replace(/\/$/, '')}/notifications`,
    ].join('\n'),
    html: page(rendu, {
      organisation: g.organisation,
      apercu: g.titre,
      surtitre: SURTITRES.notification,
      salutation: `Bonjour ${g.prenom},`,
      titre: g.titre,
      bouton: { libelle: 'Voir sur le portail', lien: g.lien },
      apres: [],
      reglages: true,
    }),
  };
}

/** Ce que la page d'un courriel porte. Tout ce qui vient de dehors y est échappé. */
interface Page {
  organisation: string;
  /** L'aperçu que la boîte de réception montre sous l'objet. */
  apercu: string;
  /** Au-dessus du titre, en capitales orange : ce dont parle le courriel. */
  surtitre: string;
  salutation?: string;
  titre: string;
  /** Sous le titre : le poste d'une candidature. */
  sousTitre?: string;
  /** Après le sous-titre, d'un seul tenant : « OFF-2026-001 » ne se coupe pas. */
  reference?: string;
  /** Sous le filet orange : la phrase qui dit la chose. */
  texte?: string;
  /** Absent : un courriel qui n'appelle aucun geste (un refus). */
  bouton?: { libelle: string; lien: string };
  /** Un courrier en toutes lettres, sous le filet orange. */
  lettre?: { paragraphes: string[]; signature: string[] };
  apres: string[];
  /** Le lien vers ses réglages, dans le pied : une notification se règle. */
  reglages?: boolean;
}

/** Le style d'un texte en Raleway, aux chiffres alignés (Raleway les dessine à l'ancienne). */
const enRaleway = (taille: number, couleur: string, interligne: string, extra = '') =>
  `font-family:${RALEWAY};font-size:${taille}px;line-height:${interligne};color:${couleur};font-variant-numeric:lining-nums;font-feature-settings:'lnum' 1;mso-line-height-rule:exactly;${extra}`;

/**
 * Une rangée vide de `hauteur` pixels : Outlook ignore les marges d'un
 * tableau, pas la hauteur d'une cellule.
 */
const espace = (hauteur: number) =>
  `<tr><td height="${hauteur}" style="height:${hauteur}px;line-height:${hauteur}px;font-size:0">&nbsp;</td></tr>`;

/** Un trait plein, en tableau : Outlook ne connaît pas les autres. */
const trait = (largeur: string, hauteur: number, couleur: string, espaceAvant = 0) =>
  `<table role="presentation" width="${largeur}" cellpadding="0" cellspacing="0" border="0" style="width:${largeur === '100%' ? '100%' : `${largeur}px`}">${espaceAvant ? espace(espaceAvant) : ''}<tr><td height="${hauteur}" bgcolor="${couleur}" style="height:${hauteur}px;line-height:${hauteur}px;font-size:0;background-color:${couleur};border-radius:${hauteur > 1 ? 2 : 0}px">&nbsp;</td></tr></table>`;

/**
 * La page : la feuille blanche, son en-tête, le message, la bande de la
 * charte, puis le pied. Les classes ne servent qu'aux messageries qui lisent
 * les styles de l'en-tête : le petit écran, le thème sombre.
 */
function page(rendu: Rendu, o: Page): string {
  const portail = echapper(rendu.portail.replace(/\/$/, ''));
  const annee = rendu.annee ?? new Date().getFullYear();
  const lien = o.bouton ? echapper(o.bouton.lien) : '';
  const libelle = o.bouton ? enClair(o.bouton.libelle) : '';

  // Le logo porte sa marge blanche (apps/web/app/courriel/logo.png) : la
  // cellule la retranche, pour que le logo s'aligne sur le texte.
  const logo = rendu.logo
    ? `<img src="${echapper(rendu.logo.src)}" width="${rendu.logo.largeur}" height="${rendu.logo.hauteur}" alt="${echapper(o.organisation)}" style="display:block;width:${rendu.logo.largeur}px;height:${rendu.logo.hauteur}px;border:0;outline:none;font-family:${ANTON};font-size:22px;line-height:${rendu.logo.hauteur}px;color:${BLEU}">`
    : `<div style="padding:${MARGE_DU_LOGO}px;font-family:${ANTON};font-size:26px;line-height:44px;color:${BLEU};letter-spacing:0.02em">${echapper(o.organisation.toUpperCase())}</div>`;

  const titre = `<h1 class="titre" style="margin:0;${enRaleway(26, ANTHRACITE, '33px', 'font-weight:700;letter-spacing:-0.01em;text-wrap:balance')}">${enClair(o.titre)}</h1>`;

  const sousTitre = o.sousTitre
    ? `<p style="margin:8px 0 0;${enRaleway(15, ARDOISE, '24px', 'font-weight:600')}">${enClair(o.sousTitre)}${o.reference ? ` · <span style="white-space:nowrap">${echapper(o.reference)}</span>` : ''}</p>`
    : '';

  const paragraphe = (texte: string, marge: number) =>
    `<p style="margin:${marge}px 0 0;${enRaleway(15, ARDOISE, '25px')}">${enClair(texte)}</p>`;

  const lettre = o.lettre
    ? [
        ...o.lettre.paragraphes.map((p, i) => paragraphe(p, i === 0 ? 24 : 14)),
        `<p style="margin:24px 0 0;${enRaleway(15, ARDOISE, '25px')}">${o.lettre.signature
          .map((ligne, i, tout) =>
            i === tout.length - 1
              ? `<span style="font-weight:700;color:${ANTHRACITE}">${enClair(ligne)}</span>`
              : enClair(ligne),
          )
          .join('<br>')}</p>`,
      ].join('\n')
    : '';

  // Outlook sur Windows dessine le bouton en VML, arrondi, à sa largeur
  // estimée ; les autres messageries, un lien aux coins de 8 px.
  const largeurVml = Math.round((o.bouton?.libelle.length ?? 0) * 8.4 + 56);
  const bouton = !o.bouton
    ? ''
    : `<table role="presentation" class="bouton" cellpadding="0" cellspacing="0" border="0" style="margin:0"><tr><td style="padding-top:30px">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${lien}" style="height:48px;v-text-anchor:middle;width:${largeurVml}px;" arcsize="17%" stroke="f" fillcolor="${BLEU}"><w:anchorlock/><center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold;">${libelle}</center></v:roundrect>
<![endif]--><!--[if !mso]><!-->
<table role="presentation" class="bouton" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${BLEU}" style="background-color:${BLEU};border-radius:8px">
<a href="${lien}" target="_blank" style="display:inline-block;padding:14px 28px;border-radius:8px;${enRaleway(15, '#ffffff', '20px', 'font-weight:700;text-decoration:none;text-align:center')}">${libelle}</a>
</td></tr></table>
<!--<![endif]-->
</td></tr></table>`;

  const apres = o.apres.length
    ? `<p style="margin:22px 0 0;${enRaleway(13, ARDOISE, '21px')}">${o.apres.map(enClair).join('<br>')}</p>`
    : '';

  // Pour qui ne peut pas cliquer sur le bouton : le même lien, à copier.
  const secours = o.bouton
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${espace(30)}<tr><td style="border-top:1px solid ${FILET};padding-top:18px;${enRaleway(12.5, ARDOISE, '20px')}">
${enClair('Le bouton ne fonctionne pas ? Copiez ce')} <a href="${lien}" target="_blank" style="color:${BLEU};font-weight:700;text-decoration:none">lien</a>.
</td></tr></table>`
    : '';

  const html = `<!doctype html>
<html lang="fr" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${echapper(o.titre)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
${polices(portail)}
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;width:100%;word-spacing:normal;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{text-decoration:none}
@media (max-width:620px){
.cadre{padding:12px 10px 28px !important}
.marge{padding-left:24px !important;padding-right:24px !important}
.marge-logo{padding-left:16px !important;padding-right:24px !important}
.colonne{display:block !important;width:100% !important;text-align:left !important}
.service{padding:10px 0 0 ${MARGE_DU_LOGO}px !important}
.titre{font-size:23px !important;line-height:30px !important}
.bouton{width:100% !important}
.bouton a{display:block !important}
}
@media (prefers-color-scheme:dark){
.fond{background-color:#0f1722 !important}
.pied,.pied a{color:#93a3b4 !important}
}
</style>
<!--[if mso]><style>body,table,td,p,a,h1,span,div{font-family:'Segoe UI',Arial,sans-serif !important}</style><![endif]-->
</head>
<body class="fond" style="margin:0;padding:0;background-color:${FOND};word-spacing:normal">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${enClair(o.apercu)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
<div role="article" aria-roledescription="email" aria-label="${echapper(o.titre)}" lang="fr" dir="ltr">
<table role="presentation" class="fond" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FOND}" style="background-color:${FOND}">
<tr><td align="center" class="cadre" style="padding:40px 16px 32px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="feuille" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px;box-shadow:0 1px 2px rgba(16,40,72,0.05),0 18px 40px -22px rgba(16,40,72,0.3)">
<tr><td class="marge-logo" style="padding:${28 - MARGE_DU_LOGO}px 48px 0 ${48 - MARGE_DU_LOGO}px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="colonne" valign="middle" align="left">${logo}</td>
<td class="colonne service" valign="middle" align="right" style="padding-left:16px;font-family:${ANTON};font-size:13px;line-height:18px;letter-spacing:0.1em;text-transform:uppercase;color:${BLEU};white-space:nowrap;mso-line-height-rule:exactly">Direction du Capital Humain</td>
</tr></table>
</td></tr>
<tr><td class="marge" style="padding:${20 - MARGE_DU_LOGO}px 48px 0">${trait('100%', 1, FILET)}</td></tr>
<tr><td class="marge" align="left" style="padding:36px 48px 0;text-align:left">
<p style="margin:0 0 14px;font-family:${EXO};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${ORANGE_TEXTE};mso-line-height-rule:exactly">${enClair(o.surtitre)}</p>
${o.salutation ? `<p style="margin:0 0 6px;${enRaleway(15, ARDOISE, '24px')}">${enClair(o.salutation)}</p>` : ''}
${titre}
${sousTitre}
${trait('40', 3, ORANGE, 20)}
${o.texte ? paragraphe(o.texte, 22) : ''}
${lettre}
${bouton}
${apres}
${secours}
</td></tr>
<tr><td style="padding:32px 0 0;font-size:0;line-height:0"><img src="${portail}/courriel/bande.png" width="600" height="64" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none"></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td class="marge pied" align="center" style="padding:22px 48px 0;font-family:${EXO};font-size:12px;line-height:20px;color:${ARDOISE};text-align:center;mso-line-height-rule:exactly">
© ${annee} APIX S.A · DCH. Tous droits réservés.<br>
${enClair(SANS_REPONSE)}${o.reglages ? `<br><a href="${portail}/notifications" target="_blank" style="color:${ARDOISE};text-decoration:underline">Gérer mes notifications</a>` : ''}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
  // Les parties absentes laissent des lignes vides : la page n'en garde aucune.
  return html.replace(/\n{2,}/g, '\n');
}
