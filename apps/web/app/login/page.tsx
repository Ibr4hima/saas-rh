'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DOMAINE_COURRIEL_PRO, type AttenteDuCode } from '@teranga/contracts';
import { BoutonMarque } from '../../components/bouton-marque';
import { ChampMarque, EcranMarque, SaisieMarque } from '../../components/ecran-marque';
import { api, ApiError } from '../../lib/api';
import { memoire, useEcranDeConnexion } from './connexion';

/* ────────────────────────────────────────────────────────────────
   Connexion par code (ADR-0204), comme celle du vote électronique.

   Le nom de famille et l'adresse professionnelle ; si elles correspondent à
   un compte, un code part à cette adresse, et l'écran suivant le demande.
   L'écran suivant dit la même chose que le couple soit juste ou non : le
   serveur ne le dit pas non plus.
   ──────────────────────────────────────────────────────────────── */

const DOMAINE = `@${DOMAINE_COURRIEL_PRO}`;

/**
 * Seule la partie avant « @ » se saisit, le domaine étant posé dans le
 * champ : une adresse complète de l'APIX, collée ou proposée par le
 * navigateur, y perd son domaine. Celle d'un autre domaine reste telle
 * quelle, et le serveur la refuse.
 */
function partieLocale(saisie: string): string {
  const arobase = saisie.indexOf('@');
  if (arobase === -1) return saisie;
  return saisie.slice(arobase).toLowerCase() === DOMAINE ? saisie.slice(0, arobase) : saisie;
}

export default function ConnexionPage() {
  const router = useRouter();
  const ecran = useEcranDeConnexion();
  const [nom, setNom] = useState(memoire.nom);
  const [email, setEmail] = useState(memoire.email);
  const [erreur, setErreur] = useState<string | null>(memoire.erreur);
  const [envoi, setEnvoi] = useState(false);

  // L'erreur rapportée de l'écran du code ne se montre qu'une fois.
  useEffect(() => {
    memoire.erreur = null;
  }, []);

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
      router.push(ecran('/login/code'));
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Envoi impossible, réessayez.');
      setEnvoi(false);
    }
  };

  return (
    <EcranMarque
      titre="Connexion"
      sousTitre={
        <>
          Accédez à votre espace avec votre compte{' '}
          <span className="font-semibold text-ink">{DOMAINE}</span>
        </>
      }
      pied="Contactez la DCH en cas de soucis."
    >
      {/* En POST : envoyé avant que la page ne soit prête, le formulaire
          n'écrit ni le nom ni l'adresse dans l'URL. */}
      <form method="post" onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <ChampMarque id="nom" label="Nom de famille" icone="person">
          <SaisieMarque
            id="nom"
            type="text"
            autoComplete="family-name"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={80}
            autoFocus={!nom}
            placeholder="Votre nom de famille"
            value={nom}
            onChange={(e) => {
              setErreur(null);
              setNom(e.target.value);
            }}
          />
        </ChampMarque>

        <ChampMarque id="email" label="Email professionnel" icone="mail">
          <SaisieMarque
            id="email"
            type="text"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
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

        {erreur ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
          >
            {erreur}
          </p>
        ) : null}

        <BoutonMarque enCours={envoi} libelleEnCours="Envoi du code…">
          Recevoir mon code
        </BoutonMarque>

        <Link
          href={ecran('/login/mot-de-passe')}
          className="mx-auto -mt-1 text-[13px] font-semibold text-ink-muted underline-offset-4 hover:text-primary hover:underline"
        >
          Se connecter avec un mot de passe
        </Link>
      </form>
    </EcranMarque>
  );
}
