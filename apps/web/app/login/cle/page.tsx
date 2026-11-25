'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OptionsDeCreation } from '@teranga/contracts';
import { BoutonMarque } from '../../../components/bouton-marque';
import { EcranMarque } from '../../../components/ecran-marque';
import { api, ApiError } from '../../../lib/api';
import {
  cleDejaSurLAppareil,
  clesPossibles,
  creerUneCle,
  gesteAnnule,
  retenirLAppareil,
} from '../../../lib/cles-d-acces';
import { pageDeRetour, versLEcran } from '../connexion';

/* ────────────────────────────────────────────────────────────────
   Après le premier code (ADR-0247) : la clé d'accès de cet appareil. Un
   geste, et le système demande Face ID, l'empreinte ou le code de
   l'appareil ; les fois suivantes, la clé ouvre la session sans code.
   « Plus tard » laisse passer : la prochaine connexion par code la
   proposera de nouveau.
   ──────────────────────────────────────────────────────────────── */

export default function CleDAccesPage() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const continuer = () => router.replace(pageDeRetour());

  // Un navigateur sans clés d'accès n'a rien à proposer ici.
  useEffect(() => {
    if (!clesPossibles()) router.replace(pageDeRetour());
  }, [router]);

  const creer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const options = await api<OptionsDeCreation>('/auth/cles/creation/options', {
        method: 'POST',
      });
      const reponse = await creerUneCle(options);
      await api('/auth/cles/creation', { method: 'POST', body: reponse });
      retenirLAppareil(true);
      continuer();
    } catch (err) {
      // L'appareil garde déjà une clé de ce compte : rien à créer.
      if (cleDejaSurLAppareil(err)) {
        retenirLAppareil(true);
        return continuer();
      }
      if (err instanceof ApiError && err.problem.status === 401) {
        return router.replace(versLEcran('/login'));
      }
      setErreur(
        gesteAnnule(err)
          ? 'La clé d’accès n’a pas été créée. Réessayez, ou continuez plus tard.'
          : err instanceof ApiError
            ? err.message
            : 'Création impossible, réessayez.',
      );
      setEnCours(false);
    }
  };

  return (
    <EcranMarque
      titre="Créez votre clé d’accès"
      // « Face ID » ne se coupe pas en bout de ligne.
      sousTitre={
        'Connectez-vous avec Face\u00a0ID, votre empreinte ou le code de votre appareil lors de vos prochaines connexions.'
      }
      pied="Contactez la DCH en cas de soucis."
    >
      <form method="post" onSubmit={creer} className="mt-6 flex flex-col gap-4" noValidate>
        {erreur ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
          >
            {erreur}
          </p>
        ) : null}

        <BoutonMarque enCours={enCours} libelleEnCours="Création de la clé…">
          Créer ma clé d’accès
        </BoutonMarque>

        <button
          type="button"
          onClick={continuer}
          disabled={enCours}
          className="mx-auto -mt-1 text-[13px] font-semibold text-ink-muted underline-offset-4 hover:text-primary hover:underline disabled:opacity-60"
        >
          Plus tard
        </button>
      </form>
    </EcranMarque>
  );
}
