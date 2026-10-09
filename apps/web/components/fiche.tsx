import * as React from 'react';
import { Card, CardHeader, CardTitle, cn } from '@teranga/ui';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Les pièces d'un registre : un intitulé gris, une valeur, des sections
   coupées par un filet.

   Elles servaient la fiche employé côté RH ; le portail de l'agent montre
   exactement les mêmes champs et doit donc les écrire de la même façon —
   sinon la même date de naissance se lit dans deux typographies selon qui
   la regarde.

   Les écrans de l'espace personnel se composent des mêmes pièces : une
   carte de tête (un titre, un geste, quatre repères), puis des cartes
   coupées en rubriques. Une page nouvelle s'écrit avec elles, pas à côté.
   ———————————————————————————————————————————————————————————————— */

/**
 * La carte de tête d'un écran : le titre et sa précision, le geste de la
 * page à droite, puis la bande des repères — ce qu'on cherche en arrivant.
 *
 * Sur un écran étroit, un geste en toutes lettres (« Signaler un
 * changement ») passe sous le titre plutôt que de le serrer sur deux lignes ;
 * une icône seule, elle, tient à côté.
 */
export function EnTete({
  titre,
  marque,
  sousTitre,
  note,
  action,
  reperes,
  colonnes = 4,
}: {
  titre: React.ReactNode;
  /** Un signe juste après le titre — l'état vérifié d'un agent. */
  marque?: React.ReactNode;
  sousTitre?: React.ReactNode;
  /** Une ligne sous la précision : un refus, un avertissement. */
  note?: React.ReactNode;
  action?: React.ReactNode;
  /** Des `<Repere>`, quatre au plus. */
  reperes?: React.ReactNode;
  /** Trois repères se partagent la bande en trois, sans colonne vide. */
  colonnes?: 3 | 4;
}) {
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
              {titre}
            </h1>
            {marque}
          </div>
          {sousTitre ? (
            <p className="mt-1.5 text-[12.5px] leading-tight text-ink-muted">{sousTitre}</p>
          ) : null}
          {note}
        </div>
        {action}
      </div>

      {/* Quatre colonnes séparées par un filet, repliées en deux sur une
          carte étroite — où le filet disparaît, deux valeurs empilées n'ayant
          rien à séparer. Le seuil suit la largeur du CONTENEUR et non celle
          de l'écran : la même bande servira un panneau latéral sans se
          couper en morceaux. */}
      {reperes ? (
        <div className="@container border-t border-line-soft px-5 py-4">
          <dl
            className={
              colonnes === 3
                ? 'grid grid-cols-3 gap-x-0 gap-y-5 [&>*]:pr-4 [&>*+*]:border-l [&>*+*]:border-line-soft [&>*+*]:pl-4 @[44rem]:[&>*]:pr-5 @[44rem]:[&>*+*]:pl-5'
                : 'grid grid-cols-2 gap-x-6 gap-y-5 @[44rem]:grid-cols-4 @[44rem]:gap-x-0 @[44rem]:[&>*]:pr-5 @[44rem]:[&>*+*]:border-l @[44rem]:[&>*+*]:border-line-soft @[44rem]:[&>*+*]:pl-5'
            }
          >
            {reperes}
          </dl>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Le bloc qui ouvre la fiche d'une demande (« Poser une demande »,
 * « Demander un document ») : son intitulé, et le « + » qui ouvre la fiche
 * en fenêtre. Après l'envoi, ce qui vient de partir se lit dessous.
 */
export function BlocQuiOuvre({
  titre,
  onOuvrir,
  disabled,
  envoi,
}: {
  titre: string;
  onOuvrir: () => void;
  disabled?: boolean;
  /** « Demande envoyée. », et où la suivre. */
  envoi?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="p-0">
        <button
          type="button"
          disabled={disabled}
          onClick={onOuvrir}
          className="group flex w-full items-center gap-3 px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          <CardTitle className="min-w-0 flex-1">{titre}</CardTitle>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors duration-200 group-hover:border-primary/40 group-hover:bg-primary/[0.06] group-hover:text-primary">
            <Icon name="add" size={18} />
          </span>
        </button>
      </CardHeader>
      {envoi ? (
        <p
          role="status"
          className="flex items-start gap-2 border-t border-line-soft px-5 py-3.5 text-[12.5px] font-semibold text-success"
        >
          <Icon name="check_circle" size={15} className="mt-px shrink-0" />
          <span>{envoi}</span>
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Un repère de la bande de tête : l'intitulé au-dessus, petit et gris, la
 * valeur en dessous. Pas de cadre — c'est le filet de la colonne voisine qui
 * sépare, et le blanc qui aère.
 *
 * Un intitulé de poste ou de direction peut être très long (« Direction de
 * l'Intelligence et des Perspectives Économiques ») : on le borne à deux
 * lignes, et l'infobulle rend le nom entier à qui en a besoin.
 */
export function Repere({
  label,
  valeur,
  titre,
  ton,
  children,
}: {
  label: string;
  /** Un texte, ou un composant quand la valeur s'actionne (un numéro, une adresse). */
  valeur?: React.ReactNode;
  /** L'infobulle, quand la valeur n'est pas un texte qu'on puisse y recopier. */
  titre?: string;
  /** La valeur qui attend un geste se dit en orange — la couleur de l'attente. */
  ton?: 'attente' | 'danger';
  /** Une seconde ligne, plus discrète — la date d'embauche sous l'ancienneté. */
  children?: React.ReactNode;
}) {
  const vide = valeur === null || valeur === undefined || valeur === '';
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] font-bold tracking-[0.11em] text-ink-muted uppercase">{label}</dt>
      <dd
        className={cn(
          'mt-1.5 line-clamp-2 text-[13.5px] leading-snug font-semibold break-words',
          vide
            ? 'text-ink-muted/45'
            : ton === 'attente'
              ? 'text-accent-text'
              : ton === 'danger'
                ? 'text-danger'
                : 'text-ink-strong',
        )}
        title={titre ?? (typeof valeur === 'string' ? valeur : undefined)}
      >
        {vide ? <Vide /> : valeur}
      </dd>
      {children ? (
        <dd className="mt-1 text-[11.5px] leading-tight font-normal text-ink-muted">{children}</dd>
      ) : null}
    </div>
  );
}

/**
 * Un champ vide reste vide : on balaie la carte pour ce qui est renseigné, pas
 * pour compter les tirets. La ligne garde sa hauteur, et un lecteur d'écran
 * dit ce que l'œil voit.
 */
function Vide() {
  return (
    <>
      <span aria-hidden>{'\u00a0'}</span>
      <span className="sr-only">Non renseigné</span>
    </>
  );
}

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
          vide ? 'text-ink-muted/45' : 'text-ink-strong',
        )}
      >
        {vide ? <Vide /> : children}
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
    <Rubrique titre={titre}>
      <dl className="grid grid-cols-1 gap-x-10 gap-y-[18px] sm:grid-cols-2">{children}</dl>
    </Rubrique>
  );
}

/**
 * Une rubrique de carte — le même intitulé gris et le même filet qu'un
 * groupe de données, autour de ce qu'on veut : des champs de formulaire, une
 * liste, un décompte.
 */
export function Rubrique({
  titre,
  children,
  className,
}: {
  titre: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-4 flex items-center gap-3">
        <h3 className="shrink-0 text-[10px] font-bold tracking-[0.12em] text-ink-muted uppercase">
          {titre}
        </h3>
        <span aria-hidden className="h-px flex-1 bg-line-soft" />
      </div>
      {children}
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
