'use client';

import { useState } from 'react';
import type { CourseDetail, EvaluationView } from '@teranga/contracts';
import { Button, Card, cn } from '@teranga/ui';
import { pourcent, quandLisible } from '../lib/academy';
import { formatDate } from '../lib/hooks';
import { compte } from '../lib/mots';
import { ApercuCertificat, BoutonLienVerification } from './academy-certificat';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   L'évaluation finale, sur la page d'une formation.

   Elle dit, selon le moment, la seule chose utile : ce qui manque pour
   l'ouvrir, comment elle se passe, combien de tentatives restent, quand la
   prochaine s'ouvre — ou le certificat obtenu. L'orange n'y paraît que pour
   l'ATTENTE : les tentatives du jour épuisées.

   Le bouton « Passer l'évaluation » n'y figure pas : il est déjà l'action
   principale de la page, en haut à droite, et deux boutons identiques à
   deux cents pixels l'un de l'autre se font concurrence.
   ———————————————————————————————————————————————————————————————— */

/** « 2 tentatives restent aujourd’hui. » — rien quand elles sont sans limite. */
export function tentativesDuJour(ev: EvaluationView): string | null {
  const n = ev.tentativesRestantes;
  if (n === null) return null;
  return `${compte(n, 'tentative')} ${n > 1 ? 'restent' : 'reste'} aujourd’hui.`;
}

export function reglesEvaluation(ev: EvaluationView): string {
  return `${compte(ev.questionCount, 'question')} · ${ev.minutes} min · ${Math.round(ev.seuil * 100)} % pour réussir`;
}

export function CarteEvaluation({ formation }: { formation: CourseDetail }) {
  const ev = formation.evaluation;
  const [apercu, setApercu] = useState(false);
  if (!ev) return null;
  const suivi = formation.mode === 'suivi';

  let icone: 'lock' | 'quiz' | 'timer' | 'workspace_premium' = 'quiz';
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
    texte = `Elle s’ouvre quand toutes les leçons sont validées — encore ${compte(restantes, 'leçon')}.`;
  } else if (ev.etat === 'ouverte') {
    texte =
      ev.derniere && !ev.derniere.passed
        ? `Dernière tentative : ${pourcent(ev.derniere.score)}. ${tentativesDuJour(ev) ?? 'Vous pouvez la repasser.'}`
        : `La réussir délivre un certificat.${ev.tentativesParJour ? ` ${ev.tentativesParJour} tentatives par jour.` : ''}`;
  } else if (ev.etat === 'en_cours') {
    icone = 'timer';
    texte = 'Une copie est ouverte et le temps court encore.';
  } else if (ev.etat === 'attente') {
    icone = 'timer';
    ton = 'bg-accent-soft text-accent-text';
    texte = (
      <>
        Vos {ev.tentativesParJour} tentatives du jour sont passées. La prochaine s’ouvre{' '}
        <b className="font-bold text-ink">
          {ev.prochaineTentative ? quandLisible(ev.prochaineTentative) : 'bientôt'}
        </b>{' '}
        — le temps de revoir les leçons.
      </>
    );
  } else if (ev.etat === 'reussie' && ev.certificat) {
    icone = 'workspace_premium';
    ton = 'bg-success-soft text-success';
    titre = 'Évaluation réussie';
    texte = `Certificat obtenu le ${formatDate(ev.certificat.issuedAt)} avec ${pourcent(ev.certificat.score)}${ev.certificat.expiresAt ? `, valable jusqu’au ${formatDate(ev.certificat.expiresAt)}` : ''}.`;
    action = (
      <div className="flex flex-wrap items-center gap-1.5">
        <BoutonLienVerification numero={ev.certificat.number} />
        <Button onClick={() => setApercu(true)}>
          <Icon name="workspace_premium" size={16} />
          Voir le certificat
        </Button>
      </div>
    );
  }

  return (
    <Card className={cn('shrink-0', ev.etat === 'attente' && suivi && 'border-accent/30')}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-[12px]', ton)}>
          <Icon name={icone} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[15px] font-bold text-ink-strong">{titre}</span>
            <span className="text-[12px] font-semibold text-ink-muted">{reglesEvaluation(ev)}</span>
          </p>
          {texte ? (
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{texte}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {apercu && ev.certificat ? (
        <ApercuCertificat certificat={ev.certificat} onClose={() => setApercu(false)} />
      ) : null}
    </Card>
  );
}
