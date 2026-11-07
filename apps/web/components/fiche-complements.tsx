'use client';

import Link from 'next/link';
import {
  banqueDe,
  enChiffres,
  LIBELLES_LIEN_DE_PARENTE,
  LIBELLES_REGION,
  ribGroupe,
  type EmployeeDetail,
} from '@teranga/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@teranga/ui';
import { formatDate } from '../lib/hooks';
import { maritalLabels } from '../lib/person';
import { aujourdhui } from '../lib/temps';
import { MONTANTS } from './complements-fiche';
import { Donnee, Groupe } from './fiche';
import { Telephone } from './telephone';

/* ────────────────────────────────────────────────────────────────
   Ce que la fiche montre du fichier de la DCH (ADR-0158) : la famille, le
   contact d'urgence, l'emploi, et la rémunération pour qui a l'accès aux
   données sensibles.
   ──────────────────────────────────────────────────────────────── */

/** L'âge en années pleines, le jour dit. */
export function age(naissance: string, jour = aujourdhui()): number {
  const [a, m, j] = naissance.split('-').map(Number) as [number, number, number];
  const [A, M, J] = jour.split('-').map(Number) as [number, number, number];
  return A - a - (M < m || (M === m && J < j) ? 1 : 0);
}

/**
 * La date d'entrée telle qu'on la connaît : au jour près, ou au mois quand
 * le fichier ne donnait que l'ancienneté (« sept. 2021 »).
 */
export function dateDEntree(e: Pick<EmployeeDetail, 'entreeAuMois' | 'hiredOn'>, iso: string) {
  if (!(e.entreeAuMois && iso === e.hiredOn)) return formatDate(iso);
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', {
    month: 'short',
    year: 'numeric',
  });
}

export function GroupeFamille({ e }: { e: EmployeeDetail }) {
  const p = e.person;
  const mere = [p.prenomDeLaMere, p.nomDeLaMere].filter(Boolean).join(' ');
  return (
    <Groupe titre="Famille">
      <Donnee label="Situation matrimoniale">
        {p.maritalStatus ? maritalLabels(p.gender)[p.maritalStatus] : null}
      </Donnee>
      <Donnee label="Nombre d’enfants">
        {p.nombreEnfants === null ? null : String(p.nombreEnfants)}
      </Donnee>
      {p.epouses.length > 0 ? (
        <Donnee label={p.epouses.length === 1 ? 'Épouse' : `Épouses (${p.epouses.length})`} large>
          {p.epouses.join(', ')}
        </Donnee>
      ) : null}
      <Donnee label="Prénom du père">{p.prenomDuPere}</Donnee>
      <Donnee label="Mère">{mere || null}</Donnee>
    </Groupe>
  );
}

export function GroupeContactDUrgence({ e }: { e: EmployeeDetail }) {
  const p = e.person;
  return (
    <Groupe titre="Personne à contacter en cas d’urgence">
      <Donnee label="Nom">{p.emergencyContactName}</Donnee>
      <Donnee label="Lien de parenté">
        {p.lienContactUrgence ? LIBELLES_LIEN_DE_PARENTE[p.lienContactUrgence] : null}
      </Donnee>
      <Donnee label="Téléphone">
        {p.emergencyContactPhone ? <Telephone valeur={p.emergencyContactPhone} /> : null}
      </Donnee>
    </Groupe>
  );
}

/** La ville et la région, après l'adresse. */
export function DonneesDeLAdresse({ e }: { e: EmployeeDetail }) {
  return (
    <>
      <Donnee label="Ville">{e.person.ville}</Donnee>
      <Donnee label="Région">{e.person.region ? LIBELLES_REGION[e.person.region] : null}</Donnee>
    </>
  );
}

export function CarteEmploi({ e }: { e: EmployeeDetail }) {
  const f = e.responsableFonctionnel;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Emploi</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <dl className="grid grid-cols-1 gap-x-10 gap-y-[18px] sm:grid-cols-2">
          <Donnee label="Lieu de travail">{e.lieuDeTravail}</Donnee>
          <Donnee label="Projet">{e.projet}</Donnee>
          <Donnee label="Catégorie socio-professionnelle">{e.categorie}</Donnee>
          <Donnee label="Responsable fonctionnel">
            {f ? (
              <Link
                href={`/employees/${f.id}`}
                className="transition-colors hover:text-primary hover:underline"
              >
                {f.nom}
                <span className="ml-1.5 font-mono text-[12px] font-medium text-ink-muted">
                  {f.matricule}
                </span>
              </Link>
            ) : null}
          </Donnee>
        </dl>
      </CardContent>
    </Card>
  );
}

const enFrancs = (montant: number | null) =>
  montant === null ? null : `${enChiffres(montant)} FCFA`;

/** La rémunération, la banque et l'IPRES : `remuneration` est null sans l'accès. */
export function CarteRemuneration({ e }: { e: EmployeeDetail }) {
  const r = e.remuneration;
  if (!r) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rémunération</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-7 pt-2">
        <Groupe titre="Montants">
          {MONTANTS.map(([cle, libelle]) => (
            <Donnee key={cle} label={libelle}>
              {enFrancs(r[cle])}
            </Donnee>
          ))}
          <Donnee label="Autres avantages">{r.autresAvantages}</Donnee>
          <Donnee label="Nombre de parts">
            {r.nombreDeParts === null ? null : r.nombreDeParts.toLocaleString('fr-FR')}
          </Donnee>
        </Groupe>
        <Groupe titre="Banque et IPRES">
          <Donnee label="Banque">{r.banque ? banqueDe(r.banque).nom : null}</Donnee>
          <Donnee label="RIB">
            {r.rib ? <span className="font-mono">{ribGroupe(r.rib)}</span> : null}
          </Donnee>
          <Donnee label="Domiciliation">{r.domiciliation}</Donnee>
          <Donnee label="Numéro IPRES">{r.numeroIpres}</Donnee>
        </Groupe>
      </CardContent>
    </Card>
  );
}

/** La date de naissance, et l'âge qu'elle donne aujourd'hui. */
export function DonneesDeNaissance({ e }: { e: EmployeeDetail }) {
  const p = e.person;
  return (
    <>
      <Donnee label="Date de naissance">{p.birthDate ? formatDate(p.birthDate) : null}</Donnee>
      <Donnee label="Âge">{p.birthDate ? `${age(p.birthDate)} ans` : null}</Donnee>
      <Donnee label="Pays de naissance">{p.birthPlace}</Donnee>
      <Donnee label="Lieu de naissance">{p.lieuDeNaissance}</Donnee>
    </>
  );
}
