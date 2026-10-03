'use client';

import Link from 'next/link';
import { useState } from 'react';
import { passwordDiffersFromEmail, passwordShortfall } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { BoutonMarque } from '../../components/bouton-marque';
import {
  BoutonOeil,
  ChampMarque,
  EcranMarque,
  ReglesMotDePasse,
  SaisieMarque,
} from '../../components/ecran-marque';
import { Icon } from '../../components/icons';

/* ————————————————————————————————————————————————————————————————
   Mot de passe oublié — l'écran, pas encore le service.

   Trois temps, comme partout : on donne son adresse, on recopie le code reçu
   par courriel, on choisit un nouveau mot de passe et on le confirme. La
   dernière carte annonce le changement et renvoie à la connexion.

   RIEN N'EST ENVOYÉ NI ENREGISTRÉ pour l'instant : l'API n'a pas de route de
   réinitialisation, et les schémas de saisie vivent donc ici plutôt qu'aux
   contrats — ils y monteront le jour où le serveur les revalidera, comme
   toutes les autres saisies du produit.

   Le passage d'une étape à l'autre se fait donc en local, pour que l'écran se
   parcoure en entier et se juge d'un bout à l'autre. Brancher le service ne
   demandera que de remplacer `avancer` par les trois appels correspondants :
   demande du code, vérification, enregistrement du mot de passe.
   ———————————————————————————————————————————————————————————————— */

const LONGUEUR_CODE = 6;

type Etape = 'adresse' | 'code' | 'motDePasse' | 'fait';

const ORDRE: Etape[] = ['adresse', 'code', 'motDePasse'];

export default function MotDePasseOubliePage() {
  const [etape, setEtape] = useState<Etape>('adresse');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  /** Le temps d'attente qu'aura le vrai appel : sans lui, l'écran saute d'une
      étape à l'autre et l'on ne voit jamais l'état « en cours ». */
  const avancer = async (suivante: Etape) => {
    setErreur(null);
    setEnCours(true);
    await new Promise((r) => setTimeout(r, 450));
    setEnCours(false);
    setEtape(suivante);
  };

  const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const manqueAuMotDePasse = passwordShortfall(password);
  const repriseDeLAdresse = password.length > 0 && !passwordDiffersFromEmail(password, email);
  const discordance = confirm.length > 0 && password !== confirm;

  const soumettre = (e: React.FormEvent) => {
    e.preventDefault();
    if (etape === 'adresse') {
      if (!emailValide) return setErreur('Indiquez une adresse email valide.');
      return void avancer('code');
    }
    if (etape === 'code') {
      if (code.trim().length !== LONGUEUR_CODE) {
        return setErreur(`Le code compte ${LONGUEUR_CODE} caractères.`);
      }
      return void avancer('motDePasse');
    }
    if (manqueAuMotDePasse) return setErreur(manqueAuMotDePasse);
    if (repriseDeLAdresse) {
      return setErreur('Le mot de passe ne doit pas reprendre votre adresse email.');
    }
    if (password !== confirm) return setErreur('Les deux mots de passe ne correspondent pas.');
    void avancer('fait');
  };

  if (etape === 'fait') {
    return (
      <EcranMarque
        titre="Mot de passe modifié"
        sousTitre="Vous pouvez désormais vous connecter avec votre nouveau mot de passe."
      >
        <div className="mt-7 flex flex-col items-center gap-5">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <Icon name="check_circle" size={30} />
          </span>
          <Link href="/login" className="w-full">
            <span className="group inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-primary text-[14.5px] font-bold text-primary-ink shadow-[0_4px_18px_rgb(0_79_145/0.35)] transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-primary-hover">
              Aller à la connexion
              <Icon
                name="arrow_forward"
                size={16}
                className="transition-transform duration-150 group-hover:translate-x-1"
              />
            </span>
          </Link>
        </div>
      </EcranMarque>
    );
  }

  return (
    <EcranMarque
      titre={
        etape === 'adresse'
          ? 'Mot de passe oublié'
          : etape === 'code'
            ? 'Vérification'
            : 'Nouveau mot de passe'
      }
      sousTitre={
        etape === 'adresse' ? (
          <>
            Indiquez l&apos;adresse de votre compte{' '}
            <span className="font-semibold text-ink">@apix.sn</span> : un code à six caractères vous
            y sera envoyé.
          </>
        ) : etape === 'code' ? (
          <>
            Saisissez le code envoyé à{' '}
            <span className="font-semibold text-ink">{email.trim()}</span>.
          </>
        ) : (
          'Choisissez un mot de passe que vous n’utilisez nulle part ailleurs.'
        )
      }
      pied={
        <>
          Vous vous en souvenez ?{' '}
          <Link href="/login" className="font-bold text-primary underline-offset-4 hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <Progression etape={etape} />

      <form onSubmit={soumettre} className="mt-6 flex flex-col gap-4" noValidate>
        {etape === 'adresse' ? (
          <ChampMarque id="email" label="Adresse email" icone="mail">
            <SaisieMarque
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="Entrez votre adresse email"
              value={email}
              onChange={(e) => {
                setErreur(null);
                setEmail(e.target.value);
              }}
            />
          </ChampMarque>
        ) : null}

        {etape === 'code' ? (
          <ChampMarque
            id="code"
            label="Code de vérification"
            icone="lock"
            indication="Six chiffres et lettres, reçus par courriel."
          >
            {/* Un champ unique plutôt que six cases : on colle le code d'un
                seul geste depuis sa boîte, ce qu'une suite de cases refuse. La
                casse est remontée à la frappe — un code se lit en capitales,
                et personne ne doit échouer pour l'avoir tapé en minuscules. */}
            <SaisieMarque
              id="code"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              maxLength={LONGUEUR_CODE}
              placeholder="A1B2C3"
              // Rembourrage SYMÉTRIQUE : l'icône vaut 40 px à gauche, et un
              // texte centré dans une boîte dont un seul côté est rembourré
              // se pose visiblement de travers.
              className="pr-10 text-center text-[18px] font-bold tracking-[0.5em] uppercase"
              value={code}
              onChange={(e) => {
                setErreur(null);
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
            />
          </ChampMarque>
        ) : null}

        {etape === 'motDePasse' ? (
          <>
            <div>
              <ChampMarque id="password" label="Nouveau mot de passe" icone="lock">
                <SaisieMarque
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoFocus
                  placeholder="12 caractères minimum"
                  className="pr-11"
                  value={password}
                  onChange={(e) => {
                    setErreur(null);
                    setPassword(e.target.value);
                  }}
                />
                <BoutonOeil visible={showPwd} onToggle={() => setShowPwd((v) => !v)} />
              </ChampMarque>
              <ReglesMotDePasse password={password} email={email} />
            </div>

            <ChampMarque
              id="confirm"
              label="Confirmer le mot de passe"
              icone="check_circle"
              erreur={discordance ? 'Les deux mots de passe ne correspondent pas.' : undefined}
            >
              <SaisieMarque
                id="confirm"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                className="pr-11"
                value={confirm}
                onChange={(e) => {
                  setErreur(null);
                  setConfirm(e.target.value);
                }}
                aria-invalid={discordance ? true : undefined}
                aria-describedby={discordance ? 'confirm-erreur' : undefined}
              />
              <BoutonOeil visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
            </ChampMarque>
          </>
        ) : null}

        {erreur ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
          >
            {erreur}
          </p>
        ) : null}

        <BoutonMarque
          enCours={enCours}
          libelleEnCours={etape === 'adresse' ? 'Envoi…' : 'Vérification…'}
          disabled={
            etape === 'adresse'
              ? email.trim().length === 0
              : etape === 'code'
                ? code.length !== LONGUEUR_CODE
                : password.length === 0 || confirm.length === 0 || discordance
          }
        >
          {etape === 'adresse'
            ? 'Recevoir le code'
            : etape === 'code'
              ? 'Vérifier le code'
              : 'Enregistrer le mot de passe'}
        </BoutonMarque>

        {/* Revenir sur l'adresse est le seul retour en arrière qui ait un
            sens : le code appartient à l'adresse, et changer l'une invalide
            l'autre. Depuis le mot de passe, on ne remonte pas — le code est
            déjà consommé. */}
        {etape === 'code' ? (
          <button
            type="button"
            onClick={() => {
              setErreur(null);
              setCode('');
              setEtape('adresse');
            }}
            className="mx-auto text-[12.5px] font-semibold text-ink-muted underline-offset-4 transition-colors hover:text-primary hover:underline"
          >
            Changer d&apos;adresse
          </button>
        ) : null}
      </form>
    </EcranMarque>
  );
}

/**
 * Où l'on en est, sans compter.
 *
 * Trois segments plutôt que « Étape 2 sur 3 » : la barre dit la progression
 * d'un regard, et le décompte reste écrit pour les lecteurs d'écran, qui ne
 * voient pas la barre.
 */
function Progression({ etape }: { etape: Etape }) {
  const rang = ORDRE.indexOf(etape);
  return (
    <>
      <p className="sr-only">
        Étape {rang + 1} sur {ORDRE.length}
      </p>
      <div aria-hidden className="mt-5 flex items-center gap-1.5">
        {ORDRE.map((e, i) => (
          <span
            key={e}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              i <= rang ? 'bg-primary' : 'bg-line-soft',
            )}
          />
        ))}
      </div>
    </>
  );
}
