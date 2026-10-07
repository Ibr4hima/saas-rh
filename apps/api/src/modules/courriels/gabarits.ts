import { deElide } from '@teranga/contracts';
import type { LogoCourriel } from './logo';

/* ────────────────────────────────────────────────────────────────
   Ce que disent les courriels, et à quoi ils ressemblent.

   Court, et rien de plus que ce que la plateforme montre déjà à la même
   personne : un courriel se transfère, se lit par-dessus l'épaule, dort dans
   une boîte des années. Le lien mène au portail, où le reste se lit derrière
   un mot de passe.

   L'habit est celui de l'écran de connexion : le dôme bleu, le logo en blanc,
   « Direction du Capital Humain » entre deux traits, la carte
   blanche aux coins de 14 px, le bouton en pilule, Google Sans. Les
   messageries n'en rendent pas toutes autant : la mise en page tient dans des
   tableaux et des styles en ligne, et chaque effet a son repli. Outlook sur
   Windows garde un dôme uni, des angles droits et Segoe UI ; son bouton reste
   arrondi (VML).
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

const BLEU = '#004f91';
const ENCRE = '#14172a';
const ENCRE_DOUCE = '#5a5f75';
const POLICE = "'Google Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const echapper = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dateLongue = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Dakar',
  });

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
  'Ce lien vous est personnel et vaut une heure.',
  'Si vous n’avez rien demandé, ignorez ce courriel : votre mot de passe ne change pas.',
];

/** L'invitation selon qui la reçoit : un nouveau compte, un retour, un compte en service. */
const ACCUEILS = {
  nouveau: {
    titre: 'Bienvenue',
    accroche: 'La DCH vous invite à activer votre compte.',
    apercu: 'Choisissez votre mot de passe pour ouvrir votre accès au portail RH.',
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
        `Ce lien vous est personnel et vaut jusqu’au ${jusquau}.`,
        'Si vous n’attendiez pas ce courriel, ignorez-le.',
      ].join('\n'),
      html: page(rendu, {
        organisation: g.organisation,
        apercu: a.apercu,
        titre: `${a.titre}, ${g.prenom}`,
        sousTitre: accroche,
        bouton: { libelle: a.bouton, lien: g.lien },
        apres: [
          `Ce lien vous est personnel et vaut jusqu’au ${jusquau}.`,
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
        salutation: `Bonjour ${g.prenom},`,
        titre: 'Mot de passe oublié',
        sousTitre: 'Choisissez votre nouveau mot de passe.',
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
      salutation: `Bonjour ${g.prenom},`,
      titre: g.titre,
      bouton: { libelle: 'Voir sur le portail', lien: g.lien },
      apres: [],
      reglages: true,
    }),
  };
}

/** La page : le dôme, le logo, la carte, la signature. Tout ce qui vient de dehors est échappé. */
function page(
  rendu: Rendu,
  o: {
    organisation: string;
    /** L'aperçu que la boîte de réception montre sous l'objet. */
    apercu: string;
    salutation?: string;
    titre: string;
    sousTitre?: string;
    /** Après le sous-titre, d'un seul tenant : « OFF-2026-001 » ne se coupe pas. */
    reference?: string;
    /** Absent : un courriel qui n'appelle aucun geste (un refus). */
    bouton?: { libelle: string; lien: string };
    /** Un courrier en toutes lettres, aligné à gauche sous le titre. */
    lettre?: { paragraphes: string[]; signature: string[] };
    apres: string[];
    /** Le lien vers ses réglages, sous la signature : une notification se règle. */
    reglages?: boolean;
  },
): string {
  const portail = echapper(rendu.portail.replace(/\/$/, ''));
  const lien = o.bouton ? echapper(o.bouton.lien) : '';
  const libelle = o.bouton ? echapper(o.bouton.libelle) : '';
  const annee = rendu.annee ?? new Date().getFullYear();
  const texte = (taille: number, couleur: string, extra = '') =>
    `font-family:${POLICE};font-size:${taille}px;line-height:1.55;color:${couleur};${extra}`;

  const logo = rendu.logo
    ? `<img src="${echapper(rendu.logo.src)}" width="${rendu.logo.largeur}" height="${rendu.logo.hauteur}" alt="${echapper(o.organisation)}" style="display:block;margin:0 auto;width:${rendu.logo.largeur}px;height:${rendu.logo.hauteur}px;border:0;outline:none;${texte(20, '#ffffff', 'font-weight:700;letter-spacing:0.16em')}">`
    : `<div style="${texte(24, '#ffffff', 'font-weight:700;letter-spacing:0.16em;line-height:44px')}">${echapper(o.organisation.toUpperCase())}</div>`;

  const trait = (sens: 'gauche' | 'droite') =>
    `<td class="trait" width="44" valign="middle" style="width:44px;${sens === 'gauche' ? 'padding-right:14px' : 'padding-left:14px'}"><div style="height:1px;line-height:1px;font-size:0;background-color:#5b80aa;background-image:linear-gradient(90deg,${sens === 'gauche' ? 'rgba(255,255,255,0),rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.4),rgba(255,255,255,0)'})">&nbsp;</div></td>`;

  const bouton = !o.bouton
    ? ''
    : `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${lien}" style="height:50px;v-text-anchor:middle;width:376px;" arcsize="50%" stroke="f" fillcolor="${BLEU}"><w:anchorlock/><center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold;">${libelle} &rarr;</center></v:roundrect>
<![endif]--><!--[if !mso]><!-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px">
<tr><td align="center" bgcolor="${BLEU}" style="background-color:${BLEU};border-radius:999px;box-shadow:0 10px 22px rgba(0,79,145,0.28)">
<a href="${lien}" target="_blank" style="display:block;padding:15px 24px;border-radius:999px;${texte(15, '#ffffff', 'font-weight:700;line-height:20px;text-decoration:none')}">${libelle}&nbsp;&nbsp;<span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:20px">&rarr;</span></a>
</td></tr></table>
<!--<![endif]-->`;

  const lettre = o.lettre
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-top:1px solid #eceae7">
<tr><td align="left" style="padding-top:22px;text-align:left">
${o.lettre.paragraphes.map((p) => `<p style="margin:0 0 14px;${texte(14, ENCRE, 'line-height:1.65;text-align:left')}">${echapper(p)}</p>`).join('\n')}
<p style="margin:20px 0 0;${texte(14, ENCRE, 'line-height:1.65;text-align:left')}">${o.lettre.signature.map(echapper).join('<br>')}</p>
</td></tr></table>`
    : '';

  const police = (sousEnsemble: string, plage: string) =>
    `@font-face{font-family:'Google Sans';font-style:normal;font-weight:400 700;src:url('${portail}/fonts/google-sans-${sousEnsemble}.woff2') format('woff2');unicode-range:${plage};}`;

  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${echapper(o.titre)}</title>
<style>
${police('latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0')}
${police('latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD')}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{text-decoration:none}
@media (max-width:520px){
.cadre{padding:16px 10px 24px !important}
.dome{padding:34px 14px 22px !important}
.trait{display:none !important}
.carte-corps{padding:28px 22px 24px !important}
.carte-pied{padding:14px 22px !important}
.titre{font-size:21px !important}
}
</style>
<!--[if mso]><style>body,table,td,a,p,div,h1{font-family:'Segoe UI',Arial,sans-serif !important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#eef3f9">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${echapper(o.apercu)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef3f9" style="background-color:#eef3f9">
<tr><td align="center" class="cadre" style="padding:32px 16px 28px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
<tr><td class="dome" align="center" bgcolor="#00427c" style="background-color:#00427c;background-image:radial-gradient(70% 32% at 50% 30%,rgba(255,255,255,0.12),rgba(255,255,255,0) 70%),linear-gradient(180deg,#00335f 0%,#00335f 16%,#00427c 30%,#004f91 44%,#2670b6 60%,#8fb6dd 78%,#e3ecf6 100%);border-radius:16px;padding:42px 28px 30px">
${logo}
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 0">
<tr>${trait('gauche')}<td align="center" style="${texte(10.5, '#c9d4e3', 'font-weight:700;letter-spacing:0.16em;text-transform:uppercase;line-height:16px')}">Direction du Capital Humain</td>${trait('droite')}</tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:440px;margin:28px auto 0;background-color:#ffffff;border:1px solid #e3e5ea;border-radius:14px;box-shadow:0 18px 40px rgba(0,35,80,0.22),0 2px 6px rgba(0,0,0,0.06)">
<tr><td class="carte-corps" align="center" style="padding:34px 32px ${o.bouton ? '26px' : '30px'};border-radius:${o.bouton ? '14px 14px 0 0' : '14px'}">
${o.salutation ? `<p style="margin:0 0 8px;${texte(14, ENCRE_DOUCE)}">${echapper(o.salutation)}</p>` : ''}
<h1 class="titre" style="margin:0;${texte(o.salutation ? 22 : 24, ENCRE, 'font-weight:700;letter-spacing:-0.02em;line-height:1.28')}">${echapper(o.titre)}</h1>
${o.sousTitre ? `<p style="margin:10px 0 0;${texte(14, ENCRE_DOUCE, 'line-height:1.6')}">${echapper(o.sousTitre)}${o.reference ? ` · <span style="white-space:nowrap">${echapper(o.reference)}</span>` : ''}</p>` : ''}
${lettre}
${bouton}
${o.apres.length ? `<p style="margin:18px 0 0;${texte(12.5, ENCRE_DOUCE, 'line-height:1.6')}">${o.apres.map(echapper).join('<br>')}</p>` : ''}
</td></tr>
${
  o.bouton
    ? `<tr><td class="carte-pied" align="center" bgcolor="#fafaf9" style="background-color:#fafaf9;border-top:1px solid #eceae7;border-radius:0 0 14px 14px;padding:15px 32px;${texte(12.5, ENCRE_DOUCE)}">
Le bouton ne s’ouvre pas ? Copiez ce <a href="${lien}" target="_blank" style="color:${BLEU};font-weight:700;text-decoration:none">lien</a>.
</td></tr>`
    : ''
}
</table>
</td></tr>
</table>
<p style="margin:18px 0 0;${texte(11.5, '#6b7186')}">© ${annee} APIX S.A · DCH. Tous droits réservés.</p>
<p style="margin:4px 0 0;${texte(11.5, '#6b7186')}">${echapper(SANS_REPONSE)}</p>
${o.reglages ? `<p style="margin:6px 0 0;${texte(11.5, '#6b7186')}"><a href="${portail}/notifications" target="_blank" style="color:#6b7186;text-decoration:underline">Gérer mes notifications</a></p>` : ''}
</td></tr>
</table>
</body>
</html>`;
}
