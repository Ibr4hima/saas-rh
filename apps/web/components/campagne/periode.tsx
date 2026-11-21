import Link from 'next/link';
import {
  periodeDEvaluationEnLettres,
  type AutoDeLAgent,
  type EvaluationRecue,
  type PeriodeDeLaCampagne,
} from '@teranga/contracts';
import { Card } from '@teranga/ui';
import { AUTO_EVALUATION, MON_EVALUATION } from '../../lib/campagne';
import { Icon } from '../icons';
import { AutoFaite, EvaluationValidee, periodeDeLAuto } from './fiche';

/* ────────────────────────────────────────────────────────────────
   La période d'évaluation annuelle, sur l'accueil de l'agent (ADR-0220) :
   ses deux temps, l'auto-évaluation puis l'évaluation, côte à côte sur un
   grand écran, l'un sous l'autre ailleurs. Chacun dit sa période, telle que
   l'administration l'a réglée, et en trois puces ce qu'il demande. La coche
   bleue dit ce qui est fait ; un lien rouvre ce qui se relit.
   ──────────────────────────────────────────────────────────────── */

/** Le lendemain d'un jour, AAAA-MM-JJ. */
function lendemain(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * « Du 21 au 30 décembre 2026 » : le temps de l'évaluation, du lendemain de
 * la fin de l'auto-évaluation à la fin de la période. Sans fin propre à
 * l'auto-évaluation, la période entière.
 */
export function periodeDeLEvaluationDuN1(periode: PeriodeDeLaCampagne | null): string {
  if (!periode) return 'Période non fixée';
  const du = periode.autoAu && periode.autoAu < periode.au ? lendemain(periode.autoAu) : periode.du;
  const texte = periodeDEvaluationEnLettres({ du, au: periode.au });
  return texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);
}

/** Ce qui se relit d'un temps, une fois là. */
interface Lien {
  href: string;
  libelle: string;
}

/**
 * La période d'évaluation annuelle, en une carte : son titre, puis ses deux
 * temps. Les puces disent ce que chacun demande à l'agent.
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
    <Card className="mb-4">
      <div className="flex items-center gap-4 border-b border-line-soft p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-bloc bg-primary-soft text-primary">
          <Icon name="event" size={22} />
        </span>
        {/* « annuelle · 2026 » ne se coupe pas : l'année ne part pas seule à la ligne. */}
        <h2 className="text-[15px] leading-tight font-bold text-ink-strong">
          Période d’évaluation {`annuelle\u00a0·\u00a0${annee}`}
        </h2>
      </div>
      <div className="grid grid-cols-1 divide-y divide-line-soft md:grid-cols-2 md:divide-x md:divide-y-0">
        <Temps
          titre="Auto-évaluation"
          marque={autoFaite ? <AutoFaite le={auto.transmiseLe} /> : null}
          periode={periodeDeLAuto(periode)}
          // Les textes de l'APIX (ADR-0223).
          puces={[
            'Faites le bilan de votre année ainsi que des difficultés rencontrées.',
            'Évaluez chacun de vos objectifs de l’année en cours.',
            'Exprimez vos souhaits conformément à votre projet professionnel.',
          ]}
          lien={autoFaite ? { href: AUTO_EVALUATION, libelle: 'Relire mon auto-évaluation' } : null}
        />
        <Temps
          titre="Évaluation"
          marque={recue?.etat === 'validee' ? <EvaluationValidee le={recue.valideeLe} /> : null}
          periode={periodeDeLEvaluationDuN1(periode)}
          puces={[
            'Rencontrez votre supérieur hiérarchique et discutez autour de votre auto-évaluation.',
            'Fixez ensemble vos objectifs de l’année à venir conformément à ceux de votre unité.',
            'Prenez connaissance de votre évaluation, puis validez-la ou renvoyez-la à votre N+1.',
          ]}
          lien={
            recue && recue.etat !== 'en_attente'
              ? { href: MON_EVALUATION, libelle: 'Lire mon évaluation' }
              : null
          }
        />
      </div>
    </Card>
  );
}

/**
 * Un temps de la période : son titre, et à côté la coche une fois fait ; sa
 * période ; ce qu'il demande, en puces, comme la liste des langues d'une
 * offre ; puis, s'il y a lieu, le lien qui le rouvre.
 */
function Temps({
  titre,
  marque,
  periode,
  puces,
  lien,
}: {
  titre: string;
  marque: React.ReactNode;
  periode: string;
  puces: readonly string[];
  lien: Lien | null;
}) {
  return (
    <section className="flex flex-col p-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h3 className="text-[14px] leading-tight font-bold text-ink-strong">{titre}</h3>
        {marque}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-tight text-ink-muted">{periode}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {puces.map((p) => (
          <li key={p} className="flex gap-3 text-[13.5px] leading-relaxed text-ink">
            <span aria-hidden className="mt-[8px] size-1.5 shrink-0 rounded-full bg-primary/45" />
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ul>
      {lien ? (
        <Link
          href={lien.href}
          className="group mt-4 -ml-1 inline-flex items-center gap-0.5 self-start rounded-controle py-1 pl-1 text-[12.5px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          {lien.libelle}
          <Icon
            name="chevron_right"
            size={16}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      ) : null}
    </section>
  );
}
