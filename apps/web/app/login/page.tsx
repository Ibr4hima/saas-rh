'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  DOMAINE_COURRIEL_PRO,
  type AttenteDuCode,
  type OptionsDeConnexion,
  type SessionUser,
} from '@teranga/contracts';
import { BoutonMarque } from '../../components/bouton-marque';
import { ChampMarque, EcranMarque, SaisieMarque } from '../../components/ecran-marque';
import { api, ApiError } from '../../lib/api';
import { useAnneeDeLaCampagne } from '../../lib/campagne';
import {
  appareilAvecCle,
  clesPossibles,
  gesteAnnule,
  presenterUneCle,
  retenirLAppareil,
} from '../../lib/cles-d-acces';
import { ouvrirSession } from '../../lib/session';
import {
  memoire,
  nomEnCapitales,
  pageDeRetour,
  useEcranDeConnexion,
  versLEcran,
} from './connexion';

/* ────────────────────────────────────────────────────────────────
   Connexion par code (ADR-0204), comme celle du vote électronique.

   Le nom de famille et l'adresse professionnelle ; si elles correspondent à
   un compte, un code part à cette adresse, et l'écran suivant le demande.
   L'écran suivant dit la même chose que le couple soit juste ou non : le
   serveur ne le dit pas non plus.

   La clé d'accès (ADR-0247) : sur un appareil qui en a déjà servi une, la
   connexion la propose d'abord, le code par email en second. Ailleurs, elle
   reste à un geste, sous le bouton du code : la clé d'un téléphone, ou
   synchronisée depuis un autre appareil.
   ──────────────────────────────────────────────────────────────── */

/** Un lien discret sous le bouton, comme celui du mot de passe. */
const LIEN_DISCRET =
  'mx-auto -mt-1 text-[13px] font-semibold text-ink-muted underline-offset-4 hover:text-primary hover:underline disabled:opacity-60';

const DOMAINE = `@${DOMAINE_COURRIEL_PRO}`;

/**
 * Seule la partie avant « @ » se saisit, le domaine étant posé dans le
 * champ : une adresse complète de l'APIX, collée dans le champ, y perd son
 * domaine. Celle d'un autre domaine reste telle quelle, et le serveur la
 * refuse.
 */
function partieLocale(saisie: string): string {
  const arobase = saisie.indexOf('@');
  if (arobase === -1) return saisie;
  return saisie.slice(arobase).toLowerCase() === DOMAINE ? saisie.slice(0, arobase) : saisie;
}

/**
 * La saisie du nom passée en capitales, sans accents, le curseur laissé où
 * il était. Le champ est corrigé sur-le-champ, curseur compris : React, qui
 * y trouve déjà la bonne valeur, ne la réécrit pas, ce qui renverrait le
 * curseur au bout. Rien n'attend la frappe suivante.
 */
function enCapitales(champ: HTMLInputElement): string {
  const valeur = nomEnCapitales(champ.value);
  if (valeur !== champ.value) {
    const { selectionStart, selectionEnd } = champ;
    champ.value = valeur;
    champ.setSelectionRange(selectionStart, selectionEnd);
  }
  return valeur;
}

export default function ConnexionPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ecran = useEcranDeConnexion();
  const annee = useAnneeDeLaCampagne();
  const [nom, setNom] = useState(memoire.nom);
  const [email, setEmail] = useState(memoire.email);
  const [erreur, setErreur] = useState<string | null>(memoire.erreur);
  const [envoi, setEnvoi] = useState(false);
  /** Le navigateur sait se servir des clés d'accès. Lu après le premier rendu. */
  const [cles, setCles] = useState(false);
  /** Cet appareil a déjà servi une clé : elle passe avant le code. */
  const [cleDAbord, setCleDAbord] = useState(false);
  const [parCle, setParCle] = useState(false);

  // L'erreur rapportée de l'écran du code ne se montre qu'une fois.
  useEffect(() => {
    memoire.erreur = null;
    const possibles = clesPossibles();
    setCles(possibles);
    // Revenu de l'écran du code (« Modifier mes informations »), le formulaire reste.
    setCleDAbord(possibles && appareilAvecCle() && !memoire.nom && !memoire.email);
  }, []);

  /** La clé de l'appareil, ou d'un téléphone à côté : le système demande laquelle. */
  const seConnecterAvecUneCle = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErreur(null);
    setParCle(true);
    try {
      const options = await api<OptionsDeConnexion>('/auth/cles/connexion/options', {
        method: 'POST',
      });
      const reponse = await presenterUneCle(options);
      await api<{ user: SessionUser }>('/auth/cles/connexion', { method: 'POST', body: reponse });
      retenirLAppareil(true);
      Object.assign(memoire, { nom: '', email: '', attente: null, erreur: null });
      // Rien de ce qu'un autre compte a lu dans cet onglet ne lui survit.
      ouvrirSession(queryClient);
      router.replace(pageDeRetour());
    } catch (err) {
      setParCle(false);
      // Fenêtre du système fermée : rien à dire.
      if (gesteAnnule(err)) return;
      if (err instanceof ApiError && err.problem.code === 'auth.cle_inconnue') {
        retenirLAppareil(false);
        setCleDAbord(false);
      }
      setErreur(err instanceof ApiError ? err.message : 'Connexion impossible, réessayez.');
    }
  };

  const messageDErreur = erreur ? (
    <p
      role="alert"
      className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
    >
      {erreur}
    </p>
  ) : null;

  const sousTitre = (
    <>
      Accédez à votre espace avec votre compte{' '}
      <span className="font-semibold text-ink">{DOMAINE}</span>
    </>
  );

  if (cleDAbord) {
    return (
      <EcranMarque
        titre="Connexion"
        sousTitre={sousTitre}
        pied="Contactez la DCH en cas de soucis."
      >
        <form
          method="post"
          onSubmit={seConnecterAvecUneCle}
          className="mt-6 flex flex-col gap-4"
          noValidate
        >
          {messageDErreur}
          <BoutonMarque enCours={parCle} libelleEnCours="Connexion…">
            Se connecter avec ma clé d’accès
          </BoutonMarque>
          <button
            type="button"
            disabled={parCle}
            onClick={() => {
              setErreur(null);
              setCleDAbord(false);
            }}
            className={LIEN_DISCRET}
          >
            Recevoir un code par email
          </button>
        </form>
      </EcranMarque>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErreur(null);
    if (!nom.trim() || !email.trim()) return setErreur('Merci de renseigner les deux champs.');
    setEnvoi(true);
    try {
      const attente = await api<AttenteDuCode>('/auth/code/demande', {
        method: 'POST',
        body: { nom, email },
      });
      Object.assign(memoire, { nom, email, attente });
      router.push(versLEcran('/login/code'));
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Envoi impossible, réessayez.');
      setEnvoi(false);
    }
  };

  return (
    <EcranMarque titre="Connexion" sousTitre={sousTitre} pied="Contactez la DCH en cas de soucis.">
      {/* En POST : envoyé avant que la page ne soit prête, le formulaire
          n'écrit ni le nom ni l'adresse dans l'URL. */}
      <form method="post" onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        {/* Le nom s'écrit en capitales, sans accents, et le navigateur n'y
            propose rien : ni les noms déjà saisis sur ce poste, ni ceux
            de ses fiches (ADR-0229). */}
        <ChampMarque id="nom" label="Nom de famille" icone="person">
          <SaisieMarque
            id="nom"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            maxLength={80}
            autoFocus={!nom}
            placeholder="Votre nom de famille"
            value={nom}
            onChange={(e) => {
              setErreur(null);
              // Pendant la composition d'un accent (« ` » puis « e »), la
              // saisie reste telle quelle : la changer romprait la touche morte.
              const composition = (e.nativeEvent as InputEvent).isComposing;
              setNom(composition ? e.target.value : enCapitales(e.currentTarget));
            }}
            onCompositionEnd={(e) => setNom(enCapitales(e.currentTarget))}
          />
        </ChampMarque>

        {/* Pas de propositions ici non plus : ni les adresses déjà saisies
            sur ce poste, ni celles des fiches du navigateur (ADR-0230). */}
        <ChampMarque id="email" label="Email professionnel" icone="mail">
          <SaisieMarque
            id="email"
            type="text"
            inputMode="email"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            maxLength={254}
            aria-describedby="email-domaine"
            className="pr-24"
            value={email}
            onChange={(e) => {
              setErreur(null);
              setEmail(partieLocale(e.target.value.trim()));
            }}
          />
          <span
            id="email-domaine"
            className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[14.5px] text-ink-muted"
          >
            {DOMAINE}
          </span>
        </ChampMarque>

        {messageDErreur}

        <BoutonMarque enCours={envoi} disabled={parCle} libelleEnCours="Envoi du code…">
          Recevoir mon code
        </BoutonMarque>

        {cles ? (
          <button
            type="button"
            disabled={parCle || envoi}
            onClick={() => void seConnecterAvecUneCle()}
            className={LIEN_DISCRET}
          >
            {parCle ? 'Connexion…' : 'Se connecter avec une clé d’accès'}
          </button>
        ) : null}

        {/* En campagne (ADR-0212), les agents entrent par leur code, et
            seulement par lui. Le lien attend de savoir s'il y a une campagne
            plutôt que de paraître puis de disparaître. */}
        {annee === null ? (
          <Link
            href={ecran('/login/mot-de-passe')}
            className="mx-auto -mt-1 text-[13px] font-semibold text-ink-muted underline-offset-4 hover:text-primary hover:underline"
          >
            Se connecter avec un mot de passe
          </Link>
        ) : null}
      </form>
    </EcranMarque>
  );
}
