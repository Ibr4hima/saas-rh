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
  const [muet, setMuet] = React.useState(false);
  const [volume, setVolume] = React.useState(1);
  const [pleinEcran, setPleinEcran] = React.useState(false);
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

  const clavier = (e: React.KeyboardEvent) => {
    if (e.target !== cadre.current) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      basculer();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      allerA((video.current?.currentTime ?? 0) - 5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      allerA((video.current?.currentTime ?? 0) + 5);
    } else if (e.key === 'm') {
      setMuet((m) => !m);
    } else if (e.key === 'f') {
      pleinEcranBascule();
    }
    reveiller();
  };

  React.useEffect(() => {
    if (video.current) {
      video.current.muted = muet;
      video.current.volume = volume;
    }
  }, [muet, volume]);

  const vu = Math.min(1, intervalles.reduce((s, [de, a]) => s + (a - de), 0) / duree);
  const limite =
    validee || !suivi ? duree : Math.max(plusLoinServeur, plusLoinLocal.current, temps);
  const montrerCommandes = commandes || !enLecture || fini;

  return (
    <div
      ref={cadre}
      tabIndex={0}
      onKeyDown={clavier}
      onMouseMove={reveiller}
      onMouseLeave={() => enLecture && setCommandes(false)}
      aria-label={`Lecteur vidéo — ${lecture.title}`}
      className={cn(
        'group/lecteur relative isolate aspect-video w-full overflow-hidden bg-black select-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none',
        // Toute la largeur, mais pas toute la hauteur : au-delà de 62 % de
        // l'écran, la vidéo repoussait sous la ligne de flottaison la leçon et
        // ses boutons. Le cadre garde alors sa largeur, la vidéo se centre
        // dedans sur fond noir — comme au cinéma.
        pleinEcran ? 'rounded-none' : 'max-h-[62vh] rounded-[16px]',
        !montrerCommandes && 'cursor-none',
      )}
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

      {/* ———— la grande touche lecture, tant que rien ne joue ———— */}
      {!enLecture && !fini && !ailleurs && !erreurMedia ? (
        <button
          type="button"
          onClick={basculer}
          aria-label="Lire la vidéo"
          className="absolute top-1/2 left-1/2 grid size-[68px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-md transition-transform duration-200 hover:scale-105 hover:bg-white/25"
        >
          <Icon name="play_arrow" size={38} fill />
        </button>
      ) : null}

      {attente && enLecture ? (
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-[3px] border-white/25 border-t-white"
        />
      ) : null}

      {/* ———— l'avis passager, en haut ———— */}
      {avis ? (
        <div
          role="status"
          className="absolute top-3 left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded-full bg-black/70 px-3.5 py-1.5 text-center text-[12px] font-semibold text-white ring-1 ring-white/15 backdrop-blur-md"
        >
          {avis}
        </div>
      ) : null}

      {/* ———— fin de la vidéo ———— */}
      {fini && !ailleurs ? (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-white backdrop-blur-sm">
          <div className="flex max-w-sm flex-col items-center gap-3">
            {validee || !suivi ? (
              <>
                <Icon name="check_circle" size={40} fill className="text-[#7fd4a8]" />
                <p className="text-[16px] font-bold">
                  {suivi ? 'Leçon validée' : 'Fin de la leçon'}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
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
                <p className="text-[16px] font-bold">Vue à {pourcent(vu)}</p>
                <p className="text-[12.5px] leading-relaxed text-white/80">
                  Il faut {Math.round(SEUIL_VISIONNAGE * 100)} % pour valider la leçon. Les passages
                  non vus restent clairs sur la barre.
                </p>
                <Button
                  size="sm"
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
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-white">
          <div className="flex max-w-sm flex-col items-center gap-3">
            <p className="text-[15px] font-bold">
              {ailleurs ? 'La lecture continue ailleurs' : 'La vidéo ne se charge pas'}
            </p>
            <p className="text-[12.5px] leading-relaxed text-white/75">
              {ailleurs
                ? 'Une autre leçon, ou celle-ci dans un autre onglet, a pris le relais. Une seule lecture compte à la fois.'
                : 'La connexion a peut-être été coupée, ou l’adresse de lecture a expiré.'}
            </p>
            <Button size="sm" onClick={onReprendreIci}>
              {ailleurs ? 'Reprendre ici' : 'Réessayer'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ———— les commandes ———— */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pt-12 pb-2.5 transition-opacity duration-300 sm:px-4',
          montrerCommandes && !ailleurs ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <BarreTemps
          duree={duree}
          temps={temps}
          intervalles={suivi ? intervalles : []}
          limite={limite}
          libre={validee || !suivi}
          onAller={allerA}
        />
        <div className="mt-1.5 flex items-center gap-1 text-white sm:gap-2">
          <BoutonLecteur label={enLecture ? 'Pause' : 'Lecture'} onClick={basculer}>
            <Icon name={enLecture ? 'pause' : 'play_arrow'} size={24} fill />
          </BoutonLecteur>
          <BoutonLecteur
            label={muet ? 'Activer le son' : 'Couper le son'}
            onClick={() => setMuet((m) => !m)}
          >
            <Icon name={muet || volume === 0 ? 'volume_off' : 'volume_up'} size={21} />
          </BoutonLecteur>
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
            className="hidden h-1 w-20 cursor-pointer accent-white sm:block"
          />
          <span
            className="ml-1 text-[12px] font-semibold text-white/90"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {horloge(temps)} <span className="text-white/50">/ {horloge(duree)}</span>
          </span>
          <span className="flex-1" />
          {suivi ? (
            <span
              className={cn(
                'rounded-full px-2.5 py-[3px] text-[11px] font-bold ring-1',
                validee
                  ? 'bg-[#7fd4a8]/15 text-[#a8e6c5] ring-[#7fd4a8]/35'
                  : 'bg-white/10 text-white/90 ring-white/20',
              )}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {validee ? 'Validée' : `Vue ${pourcent(vu)}`}
            </span>
          ) : null}
          <BoutonLecteur
            label={pleinEcran ? 'Quitter le plein écran' : 'Plein écran'}
            onClick={pleinEcranBascule}
          >
            <Icon name={pleinEcran ? 'fullscreen_exit' : 'fullscreen'} size={22} />
          </BoutonLecteur>
        </div>
      </div>
    </div>
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
      className="grid size-9 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

/**
 * La barre du temps. Trois couches, de bas en haut : la piste ; les passages
 * VUS, en bleu ; la position, en blanc. Au-delà de ce qu'on a le droit
 * d'atteindre en première lecture, la piste est hachurée — on voit où l'on
 * ne peut pas aller, avant d'essayer.
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
      className="group/barre relative flex h-4 cursor-pointer items-center"
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
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover/barre:h-1.5">
        {!libre && limite < duree ? (
          <div
            aria-hidden
            className="absolute inset-y-0 right-0"
            style={{
              left: pct(limite),
              background:
                'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.16) 0 3px, transparent 3px 7px)',
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
        <div className="absolute inset-y-0 left-0 bg-white" style={{ width: pct(temps) }} />
      </div>
      <span
        aria-hidden
        className="absolute size-3 -translate-x-1/2 scale-0 rounded-full bg-white shadow transition-transform duration-150 group-hover/barre:scale-100"
        style={{ left: pct(temps) }}
      />
      {survol !== null ? (
        <span
          aria-hidden
          className="absolute bottom-5 -translate-x-1/2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white"
          style={{ left: pct(survol), fontVariantNumeric: 'tabular-nums' }}
        >
          {horloge(survol)}
        </span>
      ) : null}
    </div>
  );
}
