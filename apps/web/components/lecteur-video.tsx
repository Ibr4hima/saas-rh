'use client';

import * as React from 'react';
import type { BeatResult, Intervalle, LessonPlayback } from '@teranga/contracts';
import { BATTEMENT_S, SEUIL_VISIONNAGE } from '@teranga/contracts';
import { Button, cn } from '@teranga/ui';
import { horloge, pourcent } from '../lib/academy';
import { api, ApiError, apiUrl } from '../lib/api';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Le lecteur d'APIX Academy.

   Il fait deux métiers. Le premier se voit : lire une vidéo, proprement, avec
   des commandes à la main de la marque plutôt que celles du navigateur. Le
   second ne se voit pas : RENDRE COMPTE. Toutes les dix secondes, il dit au
   serveur quel passage il vient de jouer d'une traite ; à chaque pause, à
   chaque retour en arrière, il ferme le passage en cours et le déclare.

   Il ne décide de rien. C'est le serveur qui crédite (cf. `visionnage.ts` de
   l'API) — un lecteur trafiqué ne gagne pas une seconde. Ce qu'il fait en
   plus relève du confort de l'agent HONNÊTE, pour qu'il ne triche pas par
   facilité :

   · en première lecture, la barre ne laisse pas avancer au-delà du point le
     plus loin atteint — reculer reste libre ;
   · l'onglet quitté ou la fenêtre réduite mettent la vidéo en pause ;
   · la vitesse reste à ×1.

   Une fois la leçon validée, tout se libère : on révise comme on veut. En
   aperçu (la RH qui relit), rien n'est compté et rien n'est retenu.
   ———————————————————————————————————————————————————————————————— */

/** La couleur des passages VUS : le bleu de la marque sur fond sombre. */
const BLEU_VU = '#86b5ea';

/** Le premier passage non vu, pour y renvoyer l'agent qui a fini à 84 %. */
function premierTrou(intervalles: Intervalle[], duree: number): number {
  let curseur = 0;
  for (const [de, a] of [...intervalles].sort((x, y) => x[0] - y[0])) {
    if (de > curseur + 1) return curseur;
    curseur = Math.max(curseur, a);
  }
  return curseur < duree - 1 ? curseur : 0;
}

const arrondi = (s: number) => Math.round(s * 10) / 10;

/* Le son choisi, gardé dans ce navigateur : une commodité de lecture. */
const CLE_SON = 'teranga-lecteur-son';

function lireSon(): { volume: number; muet: boolean } {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_SON) ?? 'null') as {
      volume?: unknown;
      muet?: unknown;
    } | null;
    const volume = typeof brut?.volume === 'number' ? Math.min(1, Math.max(0, brut.volume)) : 1;
    return { volume, muet: brut?.muet === true };
  } catch {
    return { volume: 1, muet: false };
  }
}

function ecrireSon(son: { volume: number; muet: boolean }): void {
  try {
    localStorage.setItem(CLE_SON, JSON.stringify(son));
  } catch {
    // Stockage refusé : le son tient pour la leçon.
  }
}

export function LecteurVideo({
  lecture,
  onBattement,
  onReprendreIci,
  onSuivante,
}: {
  lecture: LessonPlayback;
  onBattement?: (r: BeatResult) => void;
  /** La lecture a été reprise ailleurs, ou l'adresse a expiré : en demander une neuve. */
  onReprendreIci: () => void;
  onSuivante?: () => void;
}) {
  const video = React.useRef<HTMLVideoElement>(null);
  const cadre = React.useRef<HTMLDivElement>(null);
  const duree = lecture.durationSeconds;
  const suivi = lecture.mode === 'suivi';

  const [intervalles, setIntervalles] = React.useState<Intervalle[]>(lecture.intervalles);
  const [plusLoinServeur, setPlusLoinServeur] = React.useState(lecture.plusLoin);
  const [validee, setValidee] = React.useState(lecture.validee);
  const [temps, setTemps] = React.useState(lecture.reprise);
  const [enLecture, setEnLecture] = React.useState(false);
  const [attente, setAttente] = React.useState(false);
  const [fini, setFini] = React.useState(false);
  // Le son se retrouve d'une leçon à l'autre : baissé une fois, il le reste.
  const [muet, setMuet] = React.useState(() => lireSon().muet);
  const [volume, setVolume] = React.useState(() => lireSon().volume);
  const [pleinEcran, setPleinEcran] = React.useState(false);
  // Les proportions de la vidéo, lues dans le fichier : le cadre les épouse.
  // 16:9 tant qu'on ne les connaît pas — c'est le format de presque toutes.
  const [format, setFormat] = React.useState(16 / 9);
  const [ailleurs, setAilleurs] = React.useState(false);
  const [erreurMedia, setErreurMedia] = React.useState(false);
  const [avis, setAvis] = React.useState<string | null>(null);
  const [commandes, setCommandes] = React.useState(true);

  // Ce que le lecteur tient pour lui entre deux rendus.
  const segDebut = React.useRef<number | null>(null);
  const dernierTemps = React.useRef(lecture.reprise);
  const plusLoinLocal = React.useRef(lecture.plusLoin);
  const echec = React.useRef<{ de: number; a: number } | null>(null);
  const ailleursRef = React.useRef(false);
  const libreRef = React.useRef(!suivi || lecture.validee);
  libreRef.current = !suivi || validee;
  const minuterieAvis = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const minuterieCommandes = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const permis = () =>
    libreRef.current ? duree : Math.max(plusLoinServeur, plusLoinLocal.current);

  const direAvis = React.useCallback((texte: string) => {
    setAvis(texte);
    if (minuterieAvis.current) clearTimeout(minuterieAvis.current);
    minuterieAvis.current = setTimeout(() => setAvis(null), 3200);
  }, []);

  // ———— rendre compte au serveur

  const envoyer = React.useCallback(
    (de: number, a: number) => {
      if (!suivi || !lecture.sessionId || ailleursRef.current) return;
      let depuis = de;
      // Un battement perdu en route (réseau) se rattrape au suivant, s'ils se
      // touchent : le passage raté et le nouveau n'en font qu'un.
      if (echec.current && Math.abs(echec.current.a - de) < 0.6) depuis = echec.current.de;
      echec.current = null;
      if (a - depuis < 0.3) return;
      api<BeatResult>(`/academy/lessons/${lecture.lessonId}/battement`, {
        method: 'POST',
        body: { sessionId: lecture.sessionId, de: arrondi(depuis), a: arrondi(a) },
      })
        .then((r) => {
          setIntervalles(r.intervalles);
          setPlusLoinServeur(r.plusLoin);
          setValidee(r.validee);
          if (r.refus === 'saut' && video.current) {
            video.current.currentTime = r.plusLoin;
            direAvis('Reprise au dernier passage vu.');
          }
          onBattement?.(r);
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.problem.code === 'academy.playing_elsewhere') {
            ailleursRef.current = true;
            setAilleurs(true);
            video.current?.pause();
          } else if (!(err instanceof ApiError)) {
            echec.current = { de: depuis, a };
          }
        });
    },
    [suivi, lecture.sessionId, lecture.lessonId, onBattement, direAvis],
  );

  const fermerSegment = React.useCallback(() => {
    if (segDebut.current !== null) {
      envoyer(segDebut.current, dernierTemps.current);
      segDebut.current = null;
    }
  }, [envoyer]);

  // Le battement régulier, pendant la lecture seulement.
  React.useEffect(() => {
    if (!enLecture || !suivi) return;
    const id = setInterval(() => {
      const v = video.current;
      if (!v || segDebut.current === null) return;
      const a = v.currentTime;
      envoyer(segDebut.current, a);
      segDebut.current = a;
    }, BATTEMENT_S * 1000);
    return () => clearInterval(id);
  }, [enLecture, suivi, envoyer]);

  // L'onglet quitté met la vidéo en pause — la pause ferme le passage.
  React.useEffect(() => {
    const surVisibilite = () => {
      if (document.hidden && video.current && !video.current.paused) {
        video.current.pause();
        direAvis('Pause automatique : la vidéo s’arrête quand vous quittez l’onglet.');
      }
    };
    document.addEventListener('visibilitychange', surVisibilite);
    return () => document.removeEventListener('visibilitychange', surVisibilite);
  }, [direAvis]);

  // En quittant la page, le dernier passage part quand même.
  React.useEffect(() => () => fermerSegment(), [fermerSegment]);

  React.useEffect(() => {
    const surPleinEcran = () => setPleinEcran(document.fullscreenElement === cadre.current);
    document.addEventListener('fullscreenchange', surPleinEcran);
    return () => document.removeEventListener('fullscreenchange', surPleinEcran);
  }, []);

  // ———— les gestes

  const basculer = () => {
    const v = video.current;
    if (!v || ailleurs) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      setFini(false);
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  };

  const allerA = (cible: number) => {
    const v = video.current;
    if (!v) return;
    const max = permis();
    if (cible > max + 0.5) {
      v.currentTime = max;
      direAvis('Vous ne pouvez pas avancer au-delà de ce que vous avez déjà vu.');
      return;
    }
    v.currentTime = Math.max(0, Math.min(cible, duree));
    setFini(false);
  };

  const pleinEcranBascule = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void cadre.current?.requestFullscreen?.();
  };

  const reveiller = () => {
    setCommandes(true);
    if (minuterieCommandes.current) clearTimeout(minuterieCommandes.current);
    minuterieCommandes.current = setTimeout(() => setCommandes(false), 2600);
  };

  /**
   * Les raccourcis, sur TOUTE la page — pas seulement quand le cadre a le
   * focus : sinon « F » ne faisait rien tant qu'on n'avait pas cliqué dans la
   * vidéo, ni après un clic sur l'un de ses boutons.
   *
   *   F plein écran (et retour) · K ou Espace lecture/pause · M son
   *   ← → cinq secondes · ↑ ↓ volume, quand le lecteur a le focus ou en plein
   *   écran (ailleurs, ces flèches font défiler la page).
   *
   * Jamais pendant une saisie — la recherche du bandeau reçoit bien son « f » —,
   * ni quand une fenêtre (le support PDF) est ouverte par-dessus.
   */
  const clavier = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const cible = e.target instanceof HTMLElement ? e.target : null;
    if (cible?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) {
      return;
    }
    if (document.querySelector('[role="dialog"]')) return;
    const dansLeLecteur = Boolean(cible && cadre.current?.contains(cible));
    const touche = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const volumeDe = (pas: number) => {
      const v = Math.round(Math.min(1, Math.max(0, (muet ? 0 : volume) + pas)) * 20) / 20;
      setVolume(v);
      setMuet(v === 0);
      direAvis(v === 0 ? 'Son coupé' : `Volume ${Math.round(v * 100)} %`);
    };

    if (touche === 'f') pleinEcranBascule();
    else if (touche === 'k') basculer();
    else if (touche === 'm') setMuet((m) => !m);
    else if (touche === ' ') {
      // L'espace active déjà le bouton ou le lien qui a le focus : on ne le
      // prend que sur la page elle-même et sur le cadre du lecteur.
      if (cible && cible !== document.body && cible !== cadre.current) return;
      basculer();
    } else if (touche === 'ArrowLeft') allerA((video.current?.currentTime ?? 0) - 5);
    else if (touche === 'ArrowRight') allerA((video.current?.currentTime ?? 0) + 5);
    else if ((touche === 'ArrowUp' || touche === 'ArrowDown') && (dansLeLecteur || pleinEcran)) {
      volumeDe(touche === 'ArrowUp' ? 0.05 : -0.05);
    } else return;
    e.preventDefault();
    reveiller();
  };
  // Le gestionnaire change à chaque rendu (il lit l'état courant) ; l'écoute,
  // elle, est posée une fois et appelle toujours le dernier.
  const clavierCourant = React.useRef(clavier);
  clavierCourant.current = clavier;
  React.useEffect(() => {
    const ecoute = (e: KeyboardEvent) => clavierCourant.current(e);
    document.addEventListener('keydown', ecoute);
    return () => document.removeEventListener('keydown', ecoute);
  }, []);

  React.useEffect(() => {
    if (video.current) {
      video.current.muted = muet;
      video.current.volume = volume;
    }
    ecrireSon({ volume, muet });
  }, [muet, volume]);

  const vu = Math.min(1, intervalles.reduce((s, [de, a]) => s + (a - de), 0) / duree);
  const limite =
    validee || !suivi ? duree : Math.max(plusLoinServeur, plusLoinLocal.current, temps);
  const montrerCommandes = commandes || !enLecture || fini;

  return (
    <div
      ref={cadre}
      tabIndex={0}
      onMouseMove={reveiller}
      onMouseLeave={() => enLecture && setCommandes(false)}
      aria-label={`Lecteur vidéo : ${lecture.title}`}
      className={cn(
        'group/lecteur relative isolate w-full overflow-hidden bg-black select-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none',
        pleinEcran
          ? 'rounded-none'
          : 'mx-auto rounded-[20px] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_18px_40px_-18px_rgb(0_0_0/0.35)]',
        !montrerCommandes && 'cursor-none',
      )}
      // Le cadre a les proportions EXACTES de la vidéo, et toute la largeur de
      // la page : ni bandes noires, ni marges plus larges qu'ailleurs. Seul
      // garde-fou, à 85 % de la hauteur d'écran : il ne joue que pour une
      // vidéo en hauteur (tournée au téléphone) ou un écran très large, où la
      // vidéo déborderait sinon de la fenêtre.
      style={
        pleinEcran
          ? undefined
          : { aspectRatio: format, maxWidth: `calc(85vh * ${format.toFixed(4)})` }
      }
    >
      <video
        ref={video}
        src={lecture.source.url.startsWith('/') ? apiUrl(lecture.source.url) : lecture.source.url}
        preload="metadata"
        playsInline
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        onClick={basculer}
        className="h-full w-full"
        onLoadedMetadata={(e) => {
          const { videoWidth: largeur, videoHeight: hauteur } = e.currentTarget;
          if (largeur > 0 && hauteur > 0) setFormat(largeur / hauteur);
          if (lecture.reprise > 1) {
            e.currentTarget.currentTime = lecture.reprise;
            direAvis(`Reprise à ${horloge(lecture.reprise)}`);
          }
        }}
        onPlay={() => {
          setEnLecture(true);
          setFini(false);
          reveiller();
        }}
        onPlaying={(e) => {
          setAttente(false);
          if (suivi && segDebut.current === null) segDebut.current = e.currentTarget.currentTime;
        }}
        onPause={() => {
          setEnLecture(false);
          setCommandes(true);
          fermerSegment();
        }}
        onEnded={() => {
          setEnLecture(false);
          setFini(true);
          fermerSegment();
        }}
        onWaiting={() => setAttente(true)}
        onCanPlay={() => setAttente(false)}
        onError={() => setErreurMedia(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.seeking) return;
          dernierTemps.current = v.currentTime;
          // On n'arrive au-delà de la limite QUE par une lecture continue :
          // les sauts sont ramenés avant (`onSeeking`).
          plusLoinLocal.current = Math.max(plusLoinLocal.current, v.currentTime);
          setTemps(v.currentTime);
        }}
        onSeeking={(e) => {
          const v = e.currentTarget;
          if (!libreRef.current && v.currentTime > permis() + 0.5) {
            v.currentTime = permis();
            direAvis('Vous ne pouvez pas avancer au-delà de ce que vous avez déjà vu.');
          }
          // Le passage en cours s'arrête là où l'on était AVANT le saut.
          fermerSegment();
        }}
        onSeeked={(e) => {
          const v = e.currentTarget;
          dernierTemps.current = v.currentTime;
          setTemps(v.currentTime);
          if (suivi && !v.paused) segDebut.current = v.currentTime;
        }}
        onRateChange={(e) => {
          if (suivi && e.currentTarget.playbackRate !== 1) e.currentTarget.playbackRate = 1;
        }}
      />

      {/* Un voile doux sous les commandes : juste assez pour que le blanc se
          lise sur une image claire, jamais une bande noire. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/55 via-black/15 to-transparent transition-opacity duration-300',
          montrerCommandes && !ailleurs ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* La grande touche, tant que rien ne joue : un disque blanc plein, le
          triangle au bleu de la marque, et une ombre qui le détache de
          n'importe quelle image. */}
      {!enLecture && !fini && !ailleurs && !erreurMedia ? (
        <button
          type="button"
          onClick={basculer}
          aria-label="Lire la vidéo"
          className="absolute top-1/2 left-1/2 grid size-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[#004f91] shadow-[0_12px_40px_-8px_rgb(0_0_0/0.55)] transition-transform duration-200 ease-out hover:scale-[1.06] focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none active:scale-95 sm:size-[84px]"
        >
          <Icon name="play_arrow" size={40} fill className="ml-1" />
        </button>
      ) : null}

      {attente && enLecture ? (
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-white/20 border-t-white"
        />
      ) : null}

      {/* L'avis passager, en haut : une capsule du même verre que les commandes. */}
      {avis ? (
        <div
          role="status"
          className="absolute top-4 left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-center text-[12px] font-semibold text-white ring-1 ring-white/10 backdrop-blur-xl"
        >
          {avis}
        </div>
      ) : null}

      {/* ———— fin de la vidéo ———— */}
      {fini && !ailleurs ? (
        <div className="absolute inset-0 grid place-items-center bg-black/60 p-6 text-center text-white backdrop-blur-md">
          <div className="flex max-w-sm flex-col items-center gap-3">
            {validee || !suivi ? (
              <>
                <span className="grid size-14 place-items-center rounded-full bg-white/10 ring-1 ring-white/15">
                  <Icon name="check" size={30} weight={600} className="text-[#69d3c6]" />
                </span>
                <p className="text-[17px] font-bold tracking-[-0.01em]">
                  {suivi ? 'Leçon validée' : 'Fin de la leçon'}
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" size="sm" onClick={basculer}>
                    <Icon name="replay" size={15} />
                    Revoir
                  </Button>
                  {onSuivante ? (
                    <Button size="sm" onClick={onSuivante}>
                      Leçon suivante
                      <Icon name="arrow_forward" size={15} />
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <p className="text-[17px] font-bold tracking-[-0.01em]">Vue à {pourcent(vu)}</p>
                <p className="text-[12.5px] leading-relaxed text-white/75">
                  Il faut {Math.round(SEUIL_VISIONNAGE * 100)} % pour valider la leçon. Les passages
                  non vus restent clairs sur la barre.
                </p>
                <Button
                  size="sm"
                  className="mt-1"
                  onClick={() => {
                    allerA(premierTrou(intervalles, duree));
                    void video.current?.play();
                  }}
                >
                  <Icon name="play_arrow" size={16} fill />
                  Voir les passages manquants
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ———— la lecture continue ailleurs ———— */}
      {ailleurs || erreurMedia ? (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-white backdrop-blur-md">
          <div className="flex max-w-sm flex-col items-center gap-3">
            <p className="text-[16px] font-bold tracking-[-0.01em]">
              {ailleurs ? 'La lecture continue ailleurs' : 'La vidéo ne se charge pas'}
            </p>
            <p className="text-[12.5px] leading-relaxed text-white/70">
              {ailleurs
                ? 'Une autre leçon, ou celle-ci dans un autre onglet, a pris le relais. Une seule lecture compte à la fois.'
                : 'La connexion a peut-être été coupée, ou l’adresse de lecture a expiré.'}
            </p>
            <Button size="sm" className="mt-1" onClick={onReprendreIci}>
              {ailleurs ? 'Reprendre ici' : 'Réessayer'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ———— les commandes ————
          Une capsule de verre sombre posée AU-DESSUS de l'image, détachée des
          bords, sur une seule ligne : lecture, temps, barre, durée, son,
          plein écran. Elle s'efface pendant la lecture et revient au moindre
          mouvement. */}
      <div
        className={cn(
          'absolute inset-x-2 bottom-2 flex items-center gap-0.5 rounded-[14px] bg-black/50 p-1 text-white ring-1 ring-white/10 backdrop-blur-xl transition-[opacity,transform] duration-300 ease-out sm:inset-x-5 sm:bottom-5 sm:gap-2 sm:rounded-[16px] sm:px-2.5 sm:py-1.5',
          montrerCommandes && !ailleurs
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        <BoutonLecteur label={enLecture ? 'Pause' : 'Lecture'} onClick={basculer}>
          <Icon name={enLecture ? 'pause' : 'play_arrow'} size={24} fill />
        </BoutonLecteur>
        <Temps>{horloge(temps)}</Temps>
        <BarreTemps
          duree={duree}
          temps={temps}
          intervalles={suivi ? intervalles : []}
          limite={limite}
          libre={validee || !suivi}
          onAller={allerA}
        />
        <Temps attenue>{horloge(duree)}</Temps>
        <div className="group/son flex items-center">
          <BoutonLecteur
            label={muet ? 'Activer le son' : 'Couper le son'}
            onClick={() => setMuet((m) => !m)}
          >
            <Icon name={muet || volume === 0 ? 'volume_off' : 'volume_up'} size={21} />
          </BoutonLecteur>
          {/* La glissière du son s'ouvre au survol du bouton, et au clavier. */}
          <div className="hidden w-0 overflow-hidden transition-[width] duration-200 ease-out group-focus-within/son:w-[76px] group-hover/son:w-[76px] sm:block">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muet ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuet(Number(e.target.value) === 0);
              }}
              className="glissiere-son mr-2 ml-1 w-[64px]"
              style={{ ['--niveau' as string]: `${(muet ? 0 : volume) * 100}%` }}
            />
          </div>
        </div>
        <BoutonLecteur
          label={pleinEcran ? 'Quitter le plein écran' : 'Plein écran'}
          onClick={pleinEcranBascule}
        >
          <Icon name={pleinEcran ? 'fullscreen_exit' : 'fullscreen'} size={22} />
        </BoutonLecteur>
      </div>
    </div>
  );
}

/** Un temps de la capsule, en chiffres de largeur fixe : rien ne bouge quand il défile. */
function Temps({ children, attenue = false }: { children: string; attenue?: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 px-0.5 text-[12px] font-semibold',
        attenue ? 'text-white/60' : 'text-white/95',
      )}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {children}
    </span>
  );
}

function BoutonLecteur({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-[10px] sm:size-9 sm:rounded-[11px] text-white/90 transition-colors duration-150 hover:bg-white/12 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none active:bg-white/20"
    >
      {children}
    </button>
  );
}

/**
 * La barre du temps. Trois couches, de bas en haut : la piste ; les passages
 * VUS, en bleu ; la position, en blanc. Au-delà de ce qu'on a le droit
 * d'atteindre en première lecture, la piste est hachurée : on voit où l'on
 * ne peut pas aller, avant d'essayer. Fine au repos, elle s'épaissit sous le
 * pointeur, montre son curseur et le temps visé dans une bulle blanche.
 */
function BarreTemps({
  duree,
  temps,
  intervalles,
  limite,
  libre,
  onAller,
}: {
  duree: number;
  temps: number;
  intervalles: Intervalle[];
  limite: number;
  libre: boolean;
  onAller: (s: number) => void;
}) {
  const piste = React.useRef<HTMLDivElement>(null);
  const [survol, setSurvol] = React.useState<number | null>(null);
  const [glisse, setGlisse] = React.useState(false);
  const pct = (s: number) => `${(Math.max(0, Math.min(s, duree)) / duree) * 100}%`;

  const tempsA = (clientX: number) => {
    const r = piste.current!.getBoundingClientRect();
    return (Math.max(0, Math.min(clientX - r.left, r.width)) / r.width) * duree;
  };

  return (
    <div
      ref={piste}
      role="slider"
      tabIndex={-1}
      aria-label="Position dans la vidéo"
      aria-valuemin={0}
      aria-valuemax={Math.round(duree)}
      aria-valuenow={Math.round(temps)}
      aria-valuetext={`${horloge(temps)} sur ${horloge(duree)}`}
      className="group/barre relative mx-1 flex h-7 min-w-0 flex-1 cursor-pointer items-center"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setGlisse(true);
        onAller(tempsA(e.clientX));
      }}
      onPointerMove={(e) => {
        setSurvol(tempsA(e.clientX));
        if (glisse) onAller(tempsA(e.clientX));
      }}
      onPointerUp={() => setGlisse(false)}
      onPointerLeave={() => setSurvol(null)}
    >
      <div
        className={cn(
          'relative h-[4px] w-full overflow-hidden rounded-full bg-white/22 transition-[height] duration-150 ease-out group-hover/barre:h-[6px]',
          glisse && 'h-[6px]',
        )}
      >
        {!libre && limite < duree ? (
          <div
            aria-hidden
            className="absolute inset-y-0 right-0"
            style={{
              left: pct(limite),
              background:
                'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.12) 0 2px, transparent 2px 6px)',
            }}
          />
        ) : null}
        {intervalles.map(([de, a]) => (
          <div
            key={`${de}-${a}`}
            className="absolute inset-y-0"
            style={{ left: pct(de), width: `calc(${pct(a)} - ${pct(de)})`, background: BLEU_VU }}
          />
        ))}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white"
          style={{ width: pct(temps) }}
        />
      </div>
      <span
        aria-hidden
        className={cn(
          'absolute size-[14px] -translate-x-1/2 scale-0 rounded-full bg-white shadow-[0_0_0_4px_rgb(255_255_255/0.18),0_2px_6px_rgb(0_0_0/0.4)] transition-transform duration-150 ease-out group-hover/barre:scale-100',
          glisse && 'scale-100',
        )}
        style={{ left: pct(temps) }}
      />
      {survol !== null ? (
        <span
          aria-hidden
          className="absolute bottom-8 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#14172a] shadow-[0_4px_14px_rgb(0_0_0/0.35)]"
          style={{ left: pct(survol), fontVariantNumeric: 'tabular-nums' }}
        >
          {horloge(survol)}
        </span>
      ) : null}
    </div>
  );
}
