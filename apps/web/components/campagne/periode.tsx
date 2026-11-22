import Link from 'next/link';
import type { AutoDeLAgent, EvaluationRecue, PeriodeDeLaCampagne } from '@teranga/contracts';
import { Card } from '@teranga/ui';
import { AUTO_EVALUATION, MON_EVALUATION } from '../../lib/campagne';
import { Icon } from '../icons';
import { TitreDeSection } from './charte';
import { AutoFaite, EvaluationValidee, periodeDeLAuto, periodeDeLEvaluationDuN1 } from './fiche';

/* ────────────────────────────────────────────────────────────────
   La période d'évaluation annuelle, sur l'accueil de l'agent (ADR-0220) :
   ses deux temps, l'auto-évaluation puis l'évaluation, côte à côte sur un
   grand écran, l'un sous l'autre ailleurs. Chacun dit sa période, telle que
   l'administration l'a réglée, et en trois puces ce qu'il demande. La coche
   bleue dit ce qui est fait ; un lien rouvre ce qui se relit.
   À la charte de l'APIX (ADR-0227) : le titre en Anton au-dessus de la
   carte, et chaque temps numéroté en orange, « 01 » puis « 02 ».
   ──────────────────────────────────────────────────────────────── */

/** Ce qui se relit d'un temps, une fois là. */
interface Lien {
  href: string;
  libelle: string;
}

/**
 * La période d'évaluation annuelle : son titre, puis ses deux temps dans une
 * carte. Les puces disent ce que chacun demande à l'agent.
 */
export function CarteDeLaPeriode({
  annee,
  periode,
  auto,
  recue,
}: {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  auto: AutoDeLAgent;
  recue: EvaluationRecue | null;
}) {
  const autoFaite = auto.etat === 'transmise';
  return (
    <section aria-labelledby="periode-d-evaluation" className="flex flex-col gap-4">
      {/* « annuelle · 2026 » ne se coupe pas : l'année ne part pas seule à la ligne. */}
      <TitreDeSection id="periode-d-evaluation">
        Période d’évaluation {`annuelle\u00a0·\u00a0${annee}`}
      </TitreDeSection>
      <Card className="overflow-hidden">
        <ol className="grid grid-cols-1 divide-y divide-line-soft md:grid-cols-2 md:divide-x md:divide-y-0">
          <Temps
            numero={1}
            titre="Auto-évaluation"
            marque={autoFaite ? <AutoFaite le={auto.transmiseLe} /> : null}
            periode={periodeDeLAuto(periode)}
            // Les textes de l'APIX (ADR-0223, ADR-0236, ADR-0237, ADR-0245).
            puces={[
              'Faites le bilan de votre année ainsi que des difficultés rencontrées.',
              'Évaluez chacun de vos objectifs de l’année en cours.',
              'Exprimez vos souhaits conformément à vos projets personnel et professionnel.',
            ]}
            lien={
              autoFaite ? { href: AUTO_EVALUATION, libelle: 'Relire mon auto-évaluation' } : null
            }
          />
          <Temps
            numero={2}
            titre="Évaluation"
            marque={recue?.etat === 'validee' ? <EvaluationValidee le={recue.valideeLe} /> : null}
            periode={periodeDeLEvaluationDuN1(periode)}
            puces={[
              'Rencontrez votre N+1 et discutez autour de votre auto-évaluation.',
              'Fixez ensemble vos objectifs de l’année à venir.',
              'Prenez connaissance de votre évaluation, puis validez-la.',
            ]}
            lien={
              recue && recue.etat !== 'en_attente'
                ? { href: MON_EVALUATION, libelle: 'Lire mon évaluation' }
                : null
            }
          />
        </ol>
      </Card>
    </section>
  );
}

/**
 * Un temps de la période : son numéro en orange, son titre, et à côté la
 * coche une fois fait ; sa période ; ce qu'il demande, en puces ; puis, s'il
 * y a lieu, le lien qui le rouvre, au pied.
 */
function Temps({
  numero,
  titre,
  marque,
  periode,
  puces,
  lien,
}: {
  numero: number;
  titre: string;
  marque: React.ReactNode;
  periode: string;
  puces: readonly string[];
  lien: Lien | null;
}) {
  return (
    <li className="flex flex-col p-5 sm:p-7">
      <div className="flex items-start gap-4">
        {/* « 01 », « 02 » : la numérotation des sommaires de la charte, à
            largeur fixe, pour que les titres des deux temps s'alignent. */}
        <span
          aria-hidden
          className="w-12 shrink-0 font-titre text-[40px] leading-[0.9] text-accent sm:w-14 sm:text-[44px]"
        >
          {String(numero).padStart(2, '0')}
        </span>
        <div className="min-w-0 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="text-[16px] leading-tight font-bold text-ink-strong">{titre}</h3>
            {marque}
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] leading-tight font-semibold text-ink-muted">
            <Icon name="event" size={15} className="shrink-0" />
            {periode}
          </p>
        </div>
      </div>
      <ul className="mt-5 flex flex-col gap-2.5 border-t border-line-soft pt-5">
        {puces.map((p) => (
          <li key={p} className="flex gap-3 text-[13.5px] leading-relaxed text-ink">
            <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary/40" />
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ul>
      {lien ? (
        <Link
          href={lien.href}
          className="group mt-auto -ml-1 inline-flex items-center gap-1 self-start rounded-controle pt-5 pb-1 pl-1 text-[13px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          {lien.libelle}
          <Icon
            name="arrow_forward"
            size={16}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      ) : null}
    </li>
  );
}
