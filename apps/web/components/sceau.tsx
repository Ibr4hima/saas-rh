import { Icon } from './icons';

/*
   Le sceau d'un agent, à côté de son nom. Actif : la rosette « verified » de
   Material Symbols, pleine, au bleu du rond de l'entrée courante du menu, la
   coche à la couleur de son icône (blanche en thème clair). Ses pointes
   s'arrondissent d'un trait de la même teinte, et la coche, tracée, finit en
   bouts ronds. Inactif : la rosette barrée de la police, au trait gris, à la
   même taille apparente. Ni l'un ni l'autre ne porte d'ombre.
*/

/** La rosette de Material Symbols (FILL 1, wght 400, opsz 20), en unités de la police. */
const ROSETTE =
  'M347 888 272 764 131 732 144 588 48 480 144 372 131 228 272 196 347 72 480 129 613 72 688 196 829 228 816 372 912 480 816 588 829 732 688 764 613 888 480 831Z';

/** La coche, tracée : le milieu de celle de la police. */
const COCHE = 'M344.1 488.8 L429 573 L616 386.9';

export function Sceau({ actif }: { actif: boolean }) {
  if (!actif) {
    // 20 px de police : la rosette au trait y a la taille du sceau plein de
    // 18 px, dont les pointes arrondies débordent un peu.
    return <Icon name="verified_off" size={20} className="text-ink-muted" />;
  }
  return (
    <svg aria-hidden viewBox="-16 -16 992 992" width={18} height={18} className="shrink-0">
      <path
        d={ROSETTE}
        className="fill-primary stroke-primary"
        strokeWidth={100}
        strokeLinejoin="round"
      />
      <path
        d={COCHE}
        fill="none"
        className="stroke-primary-ink"
        strokeWidth={92}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
