'use client';

import { useState } from 'react';
import type { CourseDetail, EvaluationView } from '@teranga/contracts';
import { Button, Card, cn } from '@teranga/ui';
import { pourcent, quandLisible } from '../lib/academy';
import { formatDate } from '../lib/hooks';
import { compte } from '../lib/mots';
import { ApercuCertificat } from './academy-certificat';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   L'évaluation finale, sur la page d'une formation.

   Elle dit, selon le moment, la seule chose utile : ce qui manque pour
   l'ouvrir, comment elle se passe, combien de tentatives restent, quand la
   prochaine s'ouvre — ou le certificat obtenu. L'orange n'y paraît que pour
   l'ATTENTE : les tentatives du jour épuisées.

   Le formateur d'une formation en suit les leçons, pas l'évaluation : la
   carte le lui dit d'emblée, plutôt que de le laisser buter sur un refus.

   Le bouton « Passer l'évaluation » n'y figure pas : il est déjà l'action
   principale de la page, en haut à droite, et deux boutons identiques à
   deux cents pixels l'un de l'autre se font concurrence.

   Sans évaluation, la même carte dit le certificat que délivre la formation
   suivie en entier (ADR-0049) : les leçons qui restent, ou le certificat
   obtenu.
   ———————————————————————————————————————————————————————————————— */

/** « 2 tentatives restent aujourd’hui. » — rien quand elles sont sans limite. */
export function tentativesDuJour(ev: EvaluationView): string | null {
  const n = ev.tentativesRestantes;
  if (n === null) return null;
  return `${compte(n, 'tentative')} ${n > 1 ? 'restent' : 'reste'} aujourd’hui.`;
}

export function reglesEvaluation(ev: EvaluationView): string {
  return `${compte(ev.questionCount, 'question')} · ${Math.round(ev.seuil * 100)} % pour réussir`;
}

type IconeCarte = 'lock' | 'quiz' | 'timer' | 'edit' | 'workspace_premium' | 'school';

export function CarteEvaluation({ formation }: { formation: CourseDetail }) {
  const ev = formation.evaluation;
  const [apercu, setApercu] = useState(false);
  if (!ev) return <CarteCertificat formation={formation} />;
  const suivi = formation.mode === 'suivi';
  let icone: IconeCarte = 'quiz';
  let ton = 'bg-primary-soft text-primary';
  let titre = 'Évaluation finale';
  let texte: React.ReactNode = null;
  let action: React.ReactNode = null;

  if (!suivi) {
    icone = 'lock';
    ton = 'bg-line-soft/70 text-ink-muted';
    texte =
      'Les agents la passent une fois toutes les leçons validées ; la réussir délivre un certificat.';
  } else if (ev.etat === 'verrouillee') {
    icone = 'lock';
    ton = 'bg-line-soft/70 text-ink-muted';
    const restantes = formation.lessonCount - formation.completedLessons;
    texte = `Elle s’ouvre quand toutes les leçons sont validées. Encore ${compte(restantes, 'leçon')}.`;
  } else if (ev.etat === 'fermee') {
    icone = ev.fermeture === 'formateur' ? 'school' : 'lock';
    ton = 'bg-line-soft/70 text-ink-muted';
    texte =
      ev.fermeture === 'formateur'
        ? 'Vous êtes le formateur de cette formation : l’évaluation ne vous concerne pas. Les leçons restent ouvertes, et votre dossier indique que vous l’avez animée.'
        : ev.fermeture === 'reponses'
          ? 'Vous en avez vu les réponses en gérant le catalogue : cette évaluation vous est fermée.'
          : 'Vous gérez le catalogue et en connaissez les questions : les évaluations vous sont fermées.';
  } else if (ev.etat === 'ouverte' && ev.renouvellement && ev.certificat?.expiresAt) {
    icone = 'workspace_premium';
    titre = 'Renouveler le certificat';
    texte = `Votre certificat expire le ${formatDate(ev.certificat.expiresAt)}.${tentativesDuJour(ev) ? ` ${tentativesDuJour(ev)}` : ''}`;
  } else if (ev.etat === 'ouverte') {
    texte =
      ev.derniere && !ev.derniere.passed
        ? `Dernière tentative : ${pourcent(ev.derniere.score)}. ${tentativesDuJour(ev) ?? 'Vous pouvez la repasser.'}`
        : `La réussir délivre un certificat.${ev.tentativesParJour ? ` ${ev.tentativesParJour} tentatives par jour.` : ''}`;
  } else if (ev.etat === 'en_cours') {
    icone = 'edit';
    texte = 'Votre copie est ouverte : reprenez-la quand vous voulez.';
  } else if (ev.etat === 'attente') {
    icone = 'timer';
    ton = 'bg-accent-soft text-accent-text';
    texte = (
      <>
        Vos {ev.tentativesParJour} tentatives du jour sont passées. La prochaine s’ouvre{' '}
        <b className="font-bold text-ink">
          {ev.prochaineTentative ? quandLisible(ev.prochaineTentative) : 'bientôt'}
        </b>
        , le temps de revoir les leçons.
      </>
    );
  } else if (ev.etat === 'reussie' && ev.certificat) {
    icone = 'workspace_premium';
    ton = 'bg-success-soft text-success';
    titre = 'Évaluation réussie';
    texte = `Certificat obtenu le ${formatDate(ev.certificat.issuedAt)}${ev.certificat.score !== null ? ` avec ${pourcent(ev.certificat.score)}` : ''}${ev.certificat.expiresAt ? `, valable jusqu’au ${formatDate(ev.certificat.expiresAt)}` : ''}.`;
    action = (
      <Button onClick={() => setApercu(true)}>
        <Icon name="workspace_premium" size={16} />
        Voir le certificat
      </Button>
    );
  }

  return (
    <Cadre
      icone={icone}
      ton={ton}
      titre={titre}
      regles={reglesEvaluation(ev)}
      texte={texte}
      action={action}
      attente={ev.etat === 'attente' && suivi}
    >
      {apercu && ev.certificat ? (
        <ApercuCertificat certificat={ev.certificat} onClose={() => setApercu(false)} />
      ) : null}
    </Cadre>
  );
}

/** Une formation sans évaluation : le certificat qu'elle délivre, suivie en entier. */
function CarteCertificat({ formation: f }: { formation: CourseDetail }) {
  const [apercu, setApercu] = useState(false);
  const restantes = f.lessonCount - f.completedLessons;
  let icone: IconeCarte = 'workspace_premium';
  let ton = 'bg-primary-soft text-primary';
  let titre = 'Certificat';
  let texte: string;
  let action: React.ReactNode = null;

  if (f.mode !== 'suivi') {
    ton = 'bg-line-soft/70 text-ink-muted';
    texte = 'Les agents l’obtiennent en validant toutes les leçons.';
  } else if (f.certificat) {
    ton = 'bg-success-soft text-success';
    titre = 'Certificat obtenu';
    texte = `Délivré le ${formatDate(f.certificat.issuedAt)}${f.certificat.expiresAt ? `, valable jusqu’au ${formatDate(f.certificat.expiresAt)}` : ''}.`;
    action = (
      <Button onClick={() => setApercu(true)}>
        <Icon name="workspace_premium" size={16} />
        Voir le certificat
      </Button>
    );
  } else if (f.fermeture) {
    icone = f.fermeture === 'formateur' ? 'school' : 'lock';
    ton = 'bg-line-soft/70 text-ink-muted';
    texte =
      f.fermeture === 'formateur'
        ? 'Vous animez cette formation : elle ne vous délivre pas de certificat. Les leçons restent ouvertes, et votre dossier le mentionne.'
        : 'Vous gérez le catalogue : ses formations ne vous délivrent pas de certificat.';
  } else if (restantes > 0) {
    texte = `Délivré quand toutes les leçons sont validées. Encore ${compte(restantes, 'leçon')}.`;
  } else {
    // Toutes les leçons validées, sans certificat en cours : il a expiré, ou
    // il a été révoqué. La formation terminée se lit déjà plus haut.
    return null;
  }

  return (
    <Cadre icone={icone} ton={ton} titre={titre} texte={texte} action={action}>
      {apercu && f.certificat ? (
        <ApercuCertificat certificat={f.certificat} onClose={() => setApercu(false)} />
      ) : null}
    </Cadre>
  );
}

function Cadre({
  icone,
  ton,
  titre,
  regles,
  texte,
  action,
  attente = false,
  children,
}: {
  icone: IconeCarte;
  ton: string;
  titre: string;
  regles?: string;
  texte: React.ReactNode;
  action: React.ReactNode;
  attente?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('shrink-0', attente && 'border-accent/30')}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-[12px]', ton)}>
          <Icon name={icone} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[15px] font-bold text-ink-strong">{titre}</span>
            {regles ? (
              <span className="text-[12px] font-semibold text-ink-muted">{regles}</span>
            ) : null}
          </p>
          {texte ? (
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{texte}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </Card>
  );
}
