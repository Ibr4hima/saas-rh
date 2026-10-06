/* ────────────────────────────────────────────────────────────────
   Ce que disent les courriels.

   Court, et sans rien de la personne au-delà de son prénom : un courriel se
   transfère, se lit par-dessus l'épaule, dort dans une boîte des années. Le
   lien mène au portail, où le reste se lit derrière un mot de passe.

   La mise en page tient dans des tableaux et des styles en ligne : Outlook,
   que l'APIX utilise, ignore le reste.
   ──────────────────────────────────────────────────────────────── */

export interface ContenuCourriel {
  subject: string;
  text: string;
  html: string;
}

const BLEU = '#004f91';

const echapper = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dateLongue = (d: Date) =>
  d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Dakar',
  });

/** La page : un bandeau au nom de l'organisation, le texte, un bouton. */
function page(o: {
  organisation: string;
  paragraphes: string[];
  bouton: { libelle: string; lien: string };
  apres: string[];
}): string {
  const p = (t: string) =>
    `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#1f2937">${t}</p>`;
  const petit = (t: string) =>
    `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:18px;color:#6b7280">${t}</p>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:560px;width:100%">
<tr><td bgcolor="${BLEU}" style="padding:18px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff">${echapper(o.organisation)}</td></tr>
<tr><td style="padding:28px 28px 8px">
${o.paragraphes.map(p).join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px">
<tr><td bgcolor="${BLEU}" style="padding:12px 22px"><a href="${echapper(o.bouton.lien)}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">${echapper(o.bouton.libelle)}</a></td></tr>
</table>
${o.apres.map(petit).join('\n')}
</td></tr>
<tr><td style="padding:8px 28px 24px">${petit(`Si le bouton ne s’ouvre pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all">${echapper(o.bouton.lien)}</span>`)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** L'invitation au portail : le lien pour choisir son mot de passe. */
export function courrielInvitation(o: {
  prenom: string;
  organisation: string;
  lien: string;
  expireLe: Date;
}): ContenuCourriel {
  const jusquau = dateLongue(o.expireLe);
  return {
    subject: `${o.organisation} : votre accès au portail RH`,
    text: [
      `Bonjour ${o.prenom},`,
      '',
      `${o.organisation} vous ouvre l’accès à son portail RH : vos congés, vos documents, vos objectifs.`,
      '',
      'Pour choisir votre mot de passe, ouvrez ce lien :',
      o.lien,
      '',
      `Ce lien vous est personnel et vaut jusqu’au ${jusquau}.`,
      'Si vous n’attendiez pas ce courriel, ignorez-le.',
    ].join('\n'),
    html: page({
      organisation: o.organisation,
      paragraphes: [
        `Bonjour ${echapper(o.prenom)},`,
        `${echapper(o.organisation)} vous ouvre l’accès à son portail RH : vos congés, vos documents, vos objectifs.`,
      ],
      bouton: { libelle: 'Choisir mon mot de passe', lien: o.lien },
      apres: [
        `Ce lien vous est personnel et vaut jusqu’au ${jusquau}.`,
        'Si vous n’attendiez pas ce courriel, ignorez-le.',
      ],
    }),
  };
}
