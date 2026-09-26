import { Badge, CardContent } from '@teranga/ui';
import { CartePleine, Page } from './gabarit';
import { Icon, type IconName } from './icons';

/* ————————————————————————————————————————————————————————————————
   L'écran d'un module qui n'existe pas encore.

   Une rubrique de menu doit MENER QUELQUE PART. Une entrée éteinte se
   comprend tant qu'elle est grise ; allumée, elle promet un écran, et une
   page blanche tiendrait mal cette promesse.

   Cet écran-là ne s'excuse donc pas : il dit ce que le module portera, dans
   les mots du métier. C'est autant une page qu'une FICHE DE CADRAGE — on peut
   l'ouvrir devant la Direction du Capital Humain et demander « c'est bien
   cela ? » avant qu'une ligne de code ne soit écrite.

   Trois écrans la partagent (évaluation, compétences, formations) : c'était le
   moment d'en faire une pièce plutôt qu'une troisième copie.
   ———————————————————————————————————————————————————————————————— */

export function ModuleAVenir({
  icone,
  promesse,
  points,
  note,
}: {
  icone: IconName;
  /** Une phrase : la question à laquelle l'écran répondra, en mots du métier. */
  promesse: string;
  /** Ce que le module portera — cinq lignes au plus, chacune un vrai usage. */
  points: string[];
  /** D'où vient la demande, ou ce que l'écran remplacera. */
  note?: React.ReactNode;
}) {
  return (
    <Page>
      {/* La carte occupe la page comme les autres — un module à venir n'est
          pas une exception au gabarit — et son contenu se centre dedans
          plutôt que de se tasser en haut d'un fond nu. */}
      <CartePleine className="justify-center">
        <CardContent className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
            <Icon name={icone} size={26} />
          </span>
          <Badge tone="primary">Bientôt disponible</Badge>
          <p className="text-[15px] leading-relaxed font-bold text-ink-strong">{promesse}</p>

          <ul className="mt-1 flex w-full flex-col gap-2 text-left">
            {points.map((p) => (
              <li
                key={p}
                className="flex items-start gap-2.5 rounded-[10px] bg-surface-raised/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink"
              >
                <Icon
                  name="check"
                  size={15}
                  aria-hidden
                  className="mt-[3px] shrink-0 text-primary"
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {note ? <p className="text-[11.5px] leading-relaxed text-ink-muted">{note}</p> : null}
        </CardContent>
      </CartePleine>
    </Page>
  );
}
