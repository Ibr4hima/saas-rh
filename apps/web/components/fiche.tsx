import * as React from 'react';
import { cn } from '@teranga/ui';

/* ————————————————————————————————————————————————————————————————
   Les pièces d'un registre : un intitulé gris, une valeur, des sections
   coupées par un filet.

   Elles servaient la fiche employé côté RH ; le portail de l'agent montre
   exactement les mêmes champs et doit donc les écrire de la même façon —
   sinon la même date de naissance se lit dans deux typographies selon qui
   la regarde.
   ———————————————————————————————————————————————————————————————— */

/**
 * Une donnée d'état civil : l'intitulé au-dessus, petit et gris, la valeur en
 * dessous.
 *
 * Aucun filet sous les champs. Chaque case portait le sien, et comme les deux
 * colonnes ne se remplissent jamais à la même hauteur — une valeur qui se
 * replie décale tout ce qui suit — les traits partaient en échelle de
 * travers. Ce sont les intitulés de section, eux, qui découpent la carte ; à
 * l'intérieur d'une section, l'espace suffit.
 */
export function Donnee({
  label,
  children,
  large,
}: {
  label: string;
  children?: React.ReactNode;
  /** Occupe deux colonnes — une adresse ne se coupe pas en trois. */
  large?: boolean;
}) {
  const vide = children === null || children === undefined || children === '';
  return (
    <div className={cn('min-w-0', large && 'sm:col-span-2')}>
      <dt className="text-[9.5px] font-bold tracking-[0.1em] text-ink-muted uppercase">{label}</dt>
      <dd
        className={cn(
          'mt-1.5 text-[13.5px] leading-snug font-semibold break-words',
          // Un champ vide s'efface : on balaie la carte pour ce qui est
          // renseigné, pas pour compter les tirets.
          vide ? 'text-ink-muted/45' : 'text-ink-strong',
        )}
      >
        {vide ? '—' : children}
      </dd>
    </div>
  );
}

/**
 * Un groupe de données : son intitulé, puis un filet qui court jusqu'au bord
 * de la carte.
 *
 * L'intitulé est GRIS, pas bleu. Le titre de la carte est déjà en petites
 * capitales bleues ; trois sections du même bleu juste en dessous mettaient
 * quatre intitulés au même rang et l'œil ne savait plus lequel commandait
 * lequel. Le gris les range d'un cran en dessous, et c'est le filet — qu'un
 * titre de carte n'a pas — qui les fait lire comme des coupures.
 */
export function Groupe({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h3 className="shrink-0 text-[10px] font-bold tracking-[0.12em] text-ink-muted uppercase">
          {titre}
        </h3>
        <span aria-hidden className="h-px flex-1 bg-line-soft" />
      </div>
      <dl className="grid grid-cols-1 gap-x-10 gap-y-[18px] sm:grid-cols-2">{children}</dl>
    </section>
  );
}

/**
 * Ce qu'il advient d'une pièce d'identité qui arrive à terme.
 *
 * La date seule ne dit rien à qui ne compte pas : « 10 avr. 2030 » se lit
 * comme « c'est bon ». Le rappel n'apparaît que quand il y a lieu de s'en
 * occuper — trois mois avant, puis après.
 */
export function Peremption({ date }: { date: string }) {
  const jours = Math.round((new Date(`${date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000);
  if (jours > 90) return null;
  return (
    <span
      className={cn(
        'ml-1.5 text-[11.5px] font-bold',
        jours < 0 ? 'text-danger' : 'text-accent-text',
      )}
    >
      {jours < 0 ? '· expirée' : jours === 0 ? "· expire aujourd'hui" : `· dans ${jours} j`}
    </span>
  );
}
