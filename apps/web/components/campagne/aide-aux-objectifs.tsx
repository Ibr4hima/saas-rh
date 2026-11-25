'use client';

import { useState, type ReactNode } from 'react';
import { insecables } from '../../lib/mots';
import { Modal } from '../modal';
import { Bleu, FiletDuBandeau } from './charte';

/* ────────────────────────────────────────────────────────────────
   L'aide à la rédaction des objectifs de l'année (ADR-0262).

   À côté du titre des objectifs, pendant que le N+1 fixe ceux d'un agent
   de son équipe (ADR-0274), un bouton « Comment définir des objectifs ? »
   ouvre une fiche pratique, à la charte de l'APIX : le bandeau bleu et son
   filet orange, les titres en Anton, les parties numérotées en orange.
   Elle explique ce qu'est un objectif, la méthode SMART, la rédaction pas
   à pas et l'indicateur de réussite, puis donne des exemples tirés des
   métiers de l'APIX, chacun avec son indicateur de réussite et son
   échéance, comme les colonnes de la fiche. Elle ne porte aucune année :
   elle sert à chaque campagne, et ses échéances se disent en jour et en
   mois.

   Les textes sont des chaînes : les espaces devant « ? », « : », « ; »,
   « % » et dans les guillemets y deviennent insécables à l'affichage.
   ──────────────────────────────────────────────────────────────── */

/** Le bouton, et la fiche qu'il ouvre. */
export function AideAuxObjectifs() {
  const [ouverte, setOuverte] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOuverte(true)}
        aria-haspopup="dialog"
        className="inline-flex h-8 shrink-0 items-center rounded-bloc bg-primary-soft px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-primary transition-colors duration-150 hover:bg-primary hover:text-primary-ink focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      >
        Comment définir des objectifs ?
      </button>
      <Modal
        open={ouverte}
        onClose={() => setOuverte(false)}
        title="Fiche pratique"
        subtitle="La méthode SMART"
        maxWidth="max-w-4xl"
      >
        <FicheDesObjectifs />
      </Modal>
    </>
  );
}

// ──────────────────────────────────────────────── les textes de la fiche

/** Les trois colonnes de la fiche, pour chaque objectif. */
const ELEMENTS: readonly { terme: string; definition: string }[] = [
  { terme: 'Objectif', definition: 'ce que l’agent doit réaliser, en une phrase.' },
  {
    terme: 'Indicateur de réussite',
    definition: 'ce qui permettra de dire, en fin d’année, si l’objectif est atteint.',
  },
  { terme: 'Échéance', definition: 'la date à laquelle le résultat est attendu.' },
];

const SMART: readonly { lettre: string; mot: string; texte: string }[] = [
  {
    lettre: 'S',
    mot: 'Spécifique',
    texte:
      'L’objectif porte sur un résultat précis. Évitez les formules générales comme « améliorer » ou « renforcer », sans préciser ce qui doit changer ni dans quelle mesure.',
  },
  {
    lettre: 'M',
    mot: 'Mesurable',
    texte:
      'On peut constater objectivement si l’objectif est atteint : un nombre, un délai, un taux, un document remis. C’est le rôle de l’indicateur de réussite.',
  },
  {
    lettre: 'A',
    mot: 'Atteignable',
    texte:
      'L’objectif demande un effort, mais reste à la portée de l’agent, compte tenu de son poste, de son expérience et de sa charge de travail.',
  },
  {
    lettre: 'R',
    mot: 'Réaliste',
    texte:
      'Les moyens nécessaires sont réunis : temps, budget, outils, appui des autres services. L’objectif s’inscrit dans les priorités de la direction et de l’APIX.',
  },
  {
    lettre: 'T',
    mot: 'Temporellement défini',
    texte:
      'L’objectif a une échéance : une date précise, la fin d’un trimestre ou la fin de l’année.',
  },
];

const ETAPES: readonly { titre: string; texte: string }[] = [
  {
    titre: 'Commencez par un verbe d’action',
    texte:
      'Organiser, publier, réaliser, réduire, accompagner, mettre en place : le verbe dit ce que l’agent va faire. Évitez « participer », « contribuer » ou « suivre », qui ne disent pas quel résultat est attendu.',
  },
  {
    titre: 'Précisez le résultat attendu',
    texte:
      'Chiffrez-le chaque fois que c’est possible : combien, dans quel délai, avec quel niveau de qualité.',
  },
  {
    titre: 'Fixez l’échéance',
    texte:
      'Choisissez une date précise. Pour un objectif qui court sur toute l’année, retenez la fin de la période, par exemple le 31 décembre.',
  },
  {
    titre: 'Choisissez l’indicateur de réussite',
    texte:
      'Posez-vous la question : en fin d’année, sur quoi s’appuiera-t-on pour dire que l’objectif est atteint ? Donnez aussi la valeur à atteindre : « 20 entreprises accompagnées » plutôt que « nombre d’entreprises accompagnées ».',
  },
];

const FORMES: readonly { forme: string; exemples: string }[] = [
  {
    forme: 'Un nombre',
    exemples: 'projets accompagnés, investisseurs rencontrés, dossiers traités',
  },
  { forme: 'Un délai', exemples: 'délai moyen de traitement, respect d’une date de remise' },
  {
    forme: 'Un taux',
    exemples: 'part des demandes traitées dans les délais, taux de satisfaction',
  },
  { forme: 'Un livrable', exemples: 'étude remise, guide publié, outil mis en service' },
  {
    forme: 'Une appréciation',
    exemples: 'travail validé par la direction, retour écrit des partenaires',
  },
];

interface Exemple {
  domaine: string;
  objectif: string;
  indicateur: string;
  echeance: string;
}

const EXEMPLES: readonly Exemple[] = [
  {
    domaine: 'Promotion des investissements',
    objectif:
      'Organiser quatre missions de prospection auprès d’investisseurs étrangers des secteurs de l’agro-industrie et du numérique.',
    indicateur:
      'Quatre missions réalisées ; au moins 40 entreprises rencontrées ; un compte rendu remis après chaque mission.',
    echeance: '15 décembre',
  },
  {
    domaine: 'Accueil des investisseurs',
    objectif:
      'Répondre à chaque demande d’information d’un investisseur dans un délai de cinq jours ouvrés.',
    indicateur:
      'Au moins 90 % des demandes traitées en cinq jours ouvrés, d’après le registre des demandes.',
    echeance: '31 décembre',
  },
  {
    domaine: 'Suivi des projets',
    objectif:
      'Effectuer une visite de suivi de 30 projets d’investissement agréés et mettre à jour leur fiche dans la base de données.',
    indicateur: '30 visites réalisées ; 30 fiches de suivi à jour.',
    echeance: '30 novembre',
  },
  {
    domaine: 'Études et environnement des affaires',
    objectif:
      'Réaliser une étude sur les freins à l’investissement dans le tourisme et la présenter à la direction générale.',
    indicateur: 'Étude remise à la date prévue et validée par la direction générale.',
    echeance: '30 septembre',
  },
  {
    domaine: 'Communication',
    objectif:
      'Publier chaque trimestre une lettre d’information destinée aux investisseurs et aux partenaires de l’APIX.',
    indicateur: 'Quatre lettres publiées à la date prévue ; 20 % d’abonnés en plus sur l’année.',
    echeance: '31 décembre',
  },
  {
    domaine: 'Ressources humaines',
    objectif:
      'Mettre en service un tableau de bord mensuel des congés et des absences pour toutes les directions.',
    indicateur: 'Tableau de bord livré, puis mis à jour chaque mois sans retard.',
    echeance: '31 mars',
  },
];

const AVANT_APRES: readonly { flou: string; smart: string }[] = [
  {
    flou: 'Améliorer la promotion de l’APIX.',
    smart:
      'Représenter l’APIX à trois salons internationaux de l’investissement et en rapporter au moins 30 contacts d’investisseurs intéressés, d’ici le 30 novembre.',
  },
  {
    flou: 'Suivre les dossiers des investisseurs.',
    smart:
      'Ramener de 15 à 10 jours ouvrés le délai moyen de traitement des dossiers des investisseurs, d’ici le 30 juin.',
  },
  {
    flou: 'Se perfectionner en anglais.',
    smart:
      'Suivre une formation en anglais des affaires et atteindre le niveau B2, attesté par un test, d’ici le 31 octobre.',
  },
];

// ──────────────────────────────────────────────── la fiche

const TEXTE = 'text-[13.5px] leading-relaxed text-ink';
const ETIQUETTE =
  'text-[10px] leading-none font-extrabold tracking-[0.12em] text-ink-muted uppercase';

function FicheDesObjectifs() {
  return (
    <article className="flex flex-col gap-3">
      {/* Le bandeau de la charte : le bleu, ses ondulations, le filet orange. */}
      <header className="overflow-hidden rounded-bloc shadow-xs">
        <Bleu className="px-5 py-6 sm:px-7 sm:py-7">
          <p className="text-[11px] font-bold tracking-[0.14em] text-white/75 uppercase">
            Évaluation annuelle · Fixation des objectifs
          </p>
          <p className="mt-2 font-titre text-[24px] leading-[1.1] tracking-[0.015em] uppercase sm:text-[28px]">
            {insecables('Comment définir des objectifs ?')}
          </p>
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-white/90">
            {insecables(
              'Les objectifs fixés pendant l’entretien guident le travail de l’année à venir et servent de base à l’évaluation suivante.',
            )}
          </p>
        </Bleu>
        <FiletDuBandeau />
      </header>

      <Partie numero={1} titre="Ce qu’est un objectif">
        <p className={TEXTE}>
          {insecables(
            'Un objectif décrit un résultat à atteindre, pas une tâche à accomplir. « Traiter les demandes des investisseurs » fait partie du travail habituel du poste ; « répondre à chaque demande d’information sous cinq jours ouvrés » est un objectif, car le résultat attendu est précis et se vérifie.',
          )}
        </p>
        <p className={TEXTE}>{insecables('Pour chaque objectif, trois éléments sont requis :')}</p>
        <dl className="grid gap-2.5 sm:grid-cols-3">
          {ELEMENTS.map(({ terme, definition }) => (
            <div key={terme} className="rounded-controle bg-primary-soft/60 px-4 py-3.5">
              <dt className="text-[13px] font-bold text-primary">{terme}</dt>
              <dd className="mt-1 text-[13px] leading-snug text-ink">{insecables(definition)}</dd>
            </div>
          ))}
        </dl>
        <p className={TEXTE}>
          {insecables(
            'Définissez trois à cinq objectifs, assez pour couvrir l’essentiel du poste.',
          )}
        </p>
      </Partie>

      <Partie numero={2} titre="La méthode SMART">
        <p className={TEXTE}>
          {insecables(
            'Pour vérifier qu’un objectif est bien rédigé, on utilise la méthode SMART. Chacune de ses cinq lettres correspond à une qualité que l’objectif doit avoir.',
          )}
        </p>
        <ul className="flex flex-col divide-y divide-line-soft">
          {SMART.map((q) => (
            <li key={q.lettre} className="flex gap-4 py-3.5 first:pt-1 last:pb-0">
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-controle bg-primary font-titre text-[26px] leading-none text-primary-ink"
              >
                {q.lettre}
              </span>
              <div className="min-w-0">
                <p className="text-[14.5px] leading-tight font-bold text-ink-strong">{q.mot}</p>
                <p className={`mt-1 ${TEXTE}`}>{insecables(q.texte)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Partie>

      <Partie numero={3} titre="Rédiger un objectif, pas à pas">
        <ol className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {ETAPES.map((e, i) => (
            <li key={e.titre} className="flex gap-3">
              <span
                aria-hidden
                className="w-6 shrink-0 font-titre text-[22px] leading-[1.05] text-accent"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] leading-snug font-bold text-ink-strong">{e.titre}</p>
                <p className={`mt-1 ${TEXTE}`}>{insecables(e.texte)}</p>
              </div>
            </li>
          ))}
        </ol>
        {/* Les formes que prend l'indicateur : la fiche le veut « quantifiable ou qualifiable ». */}
        <div className="rounded-controle border border-line-soft bg-surface-raised px-4 py-4 sm:px-5">
          <p className="text-[13px] font-bold text-ink-strong">
            {insecables('L’indicateur de réussite peut être :')}
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {FORMES.map((f) => (
              <li key={f.forme} className={`flex gap-2.5 ${TEXTE}`}>
                <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0">
                  <span className="font-semibold text-ink-strong">{f.forme}</span>
                  {insecables(` : ${f.exemples}.`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Partie>

      <Partie numero={4} titre="Exemples d’objectifs">
        <p className={TEXTE}>
          {insecables(
            'Ces exemples montrent la forme attendue sur la fiche. Adaptez-les au poste de l’agent et aux priorités de sa direction.',
          )}
        </p>
        <ul className="flex flex-col gap-2.5">
          {EXEMPLES.map((x) => (
            <li
              key={x.domaine}
              className="rounded-controle border border-line-soft bg-surface px-4 py-4 sm:px-5"
            >
              <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-accent-text uppercase">
                {x.domaine}
              </p>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,0.7fr)]">
                <div className="min-w-0">
                  <dt className={ETIQUETTE}>Objectif</dt>
                  <dd className="mt-1.5 text-[13.5px] leading-snug font-semibold text-ink-strong">
                    {insecables(x.objectif)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className={ETIQUETTE}>Indicateur de réussite</dt>
                  <dd className="mt-1.5 text-[13.5px] leading-snug text-ink">
                    {insecables(x.indicateur)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className={ETIQUETTE}>Échéance</dt>
                  <dd className="mt-1.5 text-[13.5px] leading-snug text-ink">{x.echeance}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </Partie>

      <Partie numero={5} titre="D’un objectif flou à un objectif SMART">
        <ul className="flex flex-col gap-2.5">
          {AVANT_APRES.map((x) => (
            <li
              key={x.flou}
              className="grid overflow-hidden rounded-controle border border-line-soft sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]"
            >
              <div className="bg-surface-raised px-4 py-3.5">
                <p className={ETIQUETTE}>Trop vague</p>
                <p className="mt-1.5 text-[13.5px] leading-snug text-ink-muted">
                  {insecables(x.flou)}
                </p>
              </div>
              <div className="border-t border-line-soft bg-surface px-4 py-3.5 sm:border-t-0 sm:border-l">
                <p className="text-[10px] leading-none font-extrabold tracking-[0.12em] text-primary uppercase">
                  Objectif SMART
                </p>
                <p className="mt-1.5 text-[13.5px] leading-snug font-semibold text-ink-strong">
                  {insecables(x.smart)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Partie>
    </article>
  );
}

/** Une partie de la fiche : son numéro en orange, son titre en Anton, dans une carte. */
function Partie({
  numero,
  titre,
  children,
}: {
  numero: number;
  titre: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-bloc border border-line-soft bg-surface px-5 py-5 shadow-xs sm:px-6 sm:py-6">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="shrink-0 font-titre text-[30px] leading-[0.9] text-accent sm:text-[34px]"
        >
          {String(numero).padStart(2, '0')}
        </span>
        <h3 className="font-titre text-[18px] leading-[1.15] tracking-[0.015em] text-primary uppercase sm:text-[20px]">
          {titre}
        </h3>
      </div>
      <span aria-hidden className="mt-3 block h-[3px] w-10 rounded-full bg-accent" />
      <div className="mt-4 flex flex-col gap-3.5">{children}</div>
    </section>
  );
}
