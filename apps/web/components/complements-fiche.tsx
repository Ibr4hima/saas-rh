'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import {
  BANQUES,
  erreurDuTelephone,
  LIBELLES_LIEN_DE_PARENTE,
  LIBELLES_REGION,
  LIENS_DE_PARENTE,
  MAX_EPOUSES,
  NOMBRES_DE_PARTS,
  REGIONS,
  type EmployeeDetail,
  type EmployeeListItem,
  type EmployeeListPage,
  type RemunerationInput,
  type VueRemuneration,
} from '@teranga/contracts';
import { cn, Field, Input, Select } from '@teranga/ui';
import { api } from '../lib/api';
import { composePhone, splitPhone } from '../lib/countries';
import { champDuMontant } from '../lib/montant';
import { Icon } from './icons';
import { DEFILEMENT, MENU } from './liste-des-documents';
import { ModalGrid, ModalSection } from './modal';
import { PhoneInput } from './phone-input';

/* ────────────────────────────────────────────────────────────────
   Ce que la fiche reçoit du fichier de la DCH (ADR-0158), à la création
   comme à la modification : la naissance, la famille, l'adresse, le
   contact d'urgence, l'emploi, puis la rémunération, la banque et l'IPRES
   pour qui a l'accès aux données sensibles.

   Les deux formulaires tiennent ces champs dans un même objet : la création
   envoie ce qui est rempli, la modification ce qui a changé, un champ vidé
   devenant un effacement.
   ──────────────────────────────────────────────────────────────── */

export interface AgentChoisi {
  id: string;
  nom: string;
  matricule: string;
}

export interface Complements {
  lieuDeNaissance: string;
  ville: string;
  region: string;
  prenomDuPere: string;
  prenomDeLaMere: string;
  nomDeLaMere: string;
  /** Autant de noms que d'épouses déclarées ; un nom vide reste à saisir. */
  epouses: string[];
  nombreEnfants: string;
  emergencyContactName: string;
  /** Le numéro complet (« +221771234567 ») ; vide : aucun. */
  emergencyContactPhone: string;
  lienContactUrgence: string;
  lieuDeTravail: string;
  projet: string;
  categorie: string;
  responsableFonctionnel: AgentChoisi | null;
}

export const COMPLEMENTS_VIDES: Complements = {
  lieuDeNaissance: '',
  ville: '',
  region: '',
  prenomDuPere: '',
  prenomDeLaMere: '',
  nomDeLaMere: '',
  epouses: [],
  nombreEnfants: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  lienContactUrgence: '',
  lieuDeTravail: '',
  projet: '',
  categorie: '',
  responsableFonctionnel: null,
};

export function complementsDe(e: EmployeeDetail): Complements {
  const p = e.person;
  return {
    lieuDeNaissance: p.lieuDeNaissance ?? '',
    ville: p.ville ?? '',
    region: p.region ?? '',
    prenomDuPere: p.prenomDuPere ?? '',
    prenomDeLaMere: p.prenomDeLaMere ?? '',
    nomDeLaMere: p.nomDeLaMere ?? '',
    epouses: [...p.epouses],
    nombreEnfants: p.nombreEnfants === null ? '' : String(p.nombreEnfants),
    emergencyContactName: p.emergencyContactName ?? '',
    emergencyContactPhone: p.emergencyContactPhone ?? '',
    lienContactUrgence: p.lienContactUrgence ?? '',
    lieuDeTravail: e.lieuDeTravail ?? '',
    projet: e.projet ?? '',
    categorie: e.categorie ?? '',
    responsableFonctionnel: e.responsableFonctionnel,
  };
}

const DE_LA_PERSONNE = [
  'lieuDeNaissance',
  'ville',
  'region',
  'prenomDuPere',
  'prenomDeLaMere',
  'nomDeLaMere',
  'emergencyContactName',
  'emergencyContactPhone',
  'lienContactUrgence',
] as const;
const DE_L_EMPLOI = ['lieuDeTravail', 'projet', 'categorie'] as const;

const noms = (epouses: string[]) => epouses.map((n) => n.trim()).filter(Boolean);

/** Une épouse déclarée sans son nom : le formulaire attend avant d'enregistrer. */
export const epousesIncompletes = (c: Complements) => c.epouses.some((n) => !n.trim());

/** À la création : ce qui est rempli. */
export function complementsACreer(c: Complements) {
  const person: Record<string, unknown> = {};
  for (const k of DE_LA_PERSONNE) if (c[k].trim()) person[k] = c[k].trim();
  if (noms(c.epouses).length > 0) person.epouses = noms(c.epouses);
  if (c.nombreEnfants !== '') person.nombreEnfants = Number(c.nombreEnfants);
  const employee: Record<string, unknown> = {};
  for (const k of DE_L_EMPLOI) if (c[k].trim()) employee[k] = c[k].trim();
  if (c.responsableFonctionnel) employee.responsableFonctionnelId = c.responsableFonctionnel.id;
  return { person, employee };
}

/** En modification : ce qui a changé ; un champ vidé s'efface. */
export function complementsModifies(avant: Complements, apres: Complements) {
  const person: Record<string, unknown> = {};
  for (const k of DE_LA_PERSONNE) {
    if (avant[k].trim() !== apres[k].trim()) person[k] = apres[k].trim() || null;
  }
  if (noms(avant.epouses).join('\n') !== noms(apres.epouses).join('\n')) {
    person.epouses = noms(apres.epouses);
  }
  if (avant.nombreEnfants !== apres.nombreEnfants) {
    person.nombreEnfants = apres.nombreEnfants === '' ? null : Number(apres.nombreEnfants);
  }
  const employee: Record<string, unknown> = {};
  for (const k of DE_L_EMPLOI) {
    if (avant[k].trim() !== apres[k].trim()) employee[k] = apres[k].trim() || null;
  }
  if ((avant.responsableFonctionnel?.id ?? null) !== (apres.responsableFonctionnel?.id ?? null)) {
    employee.responsableFonctionnelId = apres.responsableFonctionnel?.id ?? null;
  }
  return { person, employee };
}

/* ───────────────── La rémunération ───────────────── */

export const MONTANTS = [
  ['salaireDeBase', 'Salaire de base'],
  ['sursalaire', 'Sursalaire'],
  ['primeAnciennete', 'Prime d’ancienneté'],
  ['brutSocial', 'Brut social'],
  ['primeTransport', 'Prime de transport'],
  ['salaireBrut', 'Salaire brut'],
  ['carburant', 'Carburant'],
  ['forfaitTelephone', 'Forfait téléphone'],
  ['indemniteSujetion', 'Indemnité de sujétion'],
] as const;
type Montant = (typeof MONTANTS)[number][0];
const TEXTES = ['autresAvantages', 'banque', 'rib', 'domiciliation', 'numeroIpres'] as const;

export type RemunerationSaisie = Record<Montant, number | null> & {
  autresAvantages: string;
  nombreDeParts: string;
  banque: string;
  rib: string;
  domiciliation: string;
  numeroIpres: string;
};

export function remunerationDe(v: VueRemuneration | null): RemunerationSaisie {
  const montants = Object.fromEntries(MONTANTS.map(([k]) => [k, v?.[k] ?? null])) as Record<
    Montant,
    number | null
  >;
  return {
    ...montants,
    autresAvantages: v?.autresAvantages ?? '',
    nombreDeParts: v?.nombreDeParts == null ? '' : String(v.nombreDeParts),
    banque: v?.banque ?? '',
    rib: v?.rib ?? '',
    domiciliation: v?.domiciliation ?? '',
    numeroIpres: v?.numeroIpres ?? '',
  };
}

export const REMUNERATION_VIDE: RemunerationSaisie = remunerationDe(null);

/** Ce qui change de `avant` à `apres` ; `avant` vide : ce qui est rempli. */
export function remunerationModifiee(
  avant: RemunerationSaisie,
  apres: RemunerationSaisie,
): RemunerationInput | undefined {
  const r: Record<string, unknown> = {};
  for (const [k] of MONTANTS) if (avant[k] !== apres[k]) r[k] = apres[k];
  for (const k of TEXTES) if (avant[k].trim() !== apres[k].trim()) r[k] = apres[k].trim() || null;
  if (avant.nombreDeParts !== apres.nombreDeParts) {
    r.nombreDeParts = apres.nombreDeParts === '' ? null : Number(apres.nombreDeParts);
  }
  return Object.keys(r).length > 0 ? (r as RemunerationInput) : undefined;
}

/** Un RIB : SN puis 22 chiffres, les espaces ne comptent pas. null : il convient. */
export function erreurDuRib(rib: string): string | null {
  const c = rib.replace(/\s/g, '').toUpperCase();
  return c === '' || /^SN\d{22}$/.test(c) ? null : 'Le RIB compte 24 caractères, SN compris';
}

/* ───────────────── Les champs ───────────────── */

/**
 * Un téléphone saisi par pays et numéro local, gardé en chaîne complète
 * (« +221771234567 ») : c'est elle qui part, et c'est sur elle qu'on compare.
 */
export function ChampTelephone({
  id,
  stocke,
  onChange,
}: {
  id: string;
  stocke: string | null;
  onChange: (valeur: string) => void;
}) {
  const depart = splitPhone(stocke);
  const [pays, setPays] = useState(depart.country);
  const [local, setLocal] = useState(depart.local);
  return (
    <PhoneInput
      id={id}
      country={pays}
      local={local}
      onCountryChange={(c) => {
        setPays(c);
        onChange(composePhone(c, local) ?? '');
      }}
      onLocalChange={(v) => {
        setLocal(v);
        onChange(composePhone(pays, v) ?? '');
      }}
    />
  );
}

/** Le message d'un téléphone sénégalais mal formé, sous son champ. */
export const erreurDuNumero = (numero: string) => (numero ? erreurDuTelephone(numero) : null);

function ChampMontant({
  id,
  libelle,
  montant,
  onSaisir,
}: {
  id: string;
  libelle: string;
  montant: number | null;
  onSaisir: (montant: number | null) => void;
}) {
  const champ = champDuMontant(montant, onSaisir, { zeroPermis: true });
  return (
    <Field label={libelle} htmlFor={id}>
      <div className="relative">
        <Input {...champ} id={id} className="pr-14 tabular-nums" />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11.5px] font-semibold text-ink-muted"
        >
          FCFA
        </span>
      </div>
    </Field>
  );
}

/** Le lieu de naissance, la ville : il prend place à côté du pays de naissance. */
export function ChampsDeLaNaissance({
  valeur,
  onChange,
}: {
  valeur: Complements;
  onChange: (c: Complements) => void;
}) {
  return (
    <Field label="Lieu de naissance" htmlFor="lieuDeNaissance">
      <Input
        id="lieuDeNaissance"
        value={valeur.lieuDeNaissance}
        onChange={(e) => onChange({ ...valeur, lieuDeNaissance: e.target.value })}
      />
    </Field>
  );
}

export function ChampsDeLAdresse({
  valeur,
  onChange,
}: {
  valeur: Complements;
  onChange: (c: Complements) => void;
}) {
  return (
    <>
      <Field label="Ville" htmlFor="ville">
        <Input
          id="ville"
          value={valeur.ville}
          onChange={(e) => onChange({ ...valeur, ville: e.target.value })}
        />
      </Field>
      <Field label="Région" htmlFor="region">
        <Select
          id="region"
          value={valeur.region}
          onChange={(e) => onChange({ ...valeur, region: e.target.value })}
        >
          <option value="">Choisir une région</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {LIBELLES_REGION[r]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * La famille. Les épouses se déclarent pour un homme marié seulement, autant
 * de noms que d'épouses ; la filiation dit « Fils de » ou « Fille de ».
 */
export function SectionFamille({
  valeur,
  onChange,
  epousesPossibles,
}: {
  valeur: Complements;
  onChange: (c: Complements) => void;
  /** Un homme marié : le nombre d'épouses et leurs noms se saisissent. */
  epousesPossibles: boolean;
}) {
  const texte = (champ: 'prenomDuPere' | 'prenomDeLaMere' | 'nomDeLaMere', libelle: string) => (
    <Field label={libelle} htmlFor={champ}>
      <Input
        id={champ}
        value={valeur[champ]}
        onChange={(e) => onChange({ ...valeur, [champ]: e.target.value })}
      />
    </Field>
  );
  const n = valeur.epouses.length;
  return (
    <ModalSection title="Famille">
      <ModalGrid>
        {epousesPossibles ? (
          <Field label="Nombre d’épouses" htmlFor="nombreEpouses">
            <Select
              id="nombreEpouses"
              value={n === 0 ? '' : String(n)}
              onChange={(e) => {
                const nombre = Number(e.target.value) || 0;
                onChange({
                  ...valeur,
                  epouses: Array.from({ length: nombre }, (_, i) => valeur.epouses[i] ?? ''),
                });
              }}
            >
              <option value="">Aucune</option>
              {Array.from({ length: MAX_EPOUSES }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Nombre d’enfants" htmlFor="nombreEnfants">
          <Input
            id="nombreEnfants"
            inputMode="numeric"
            value={valeur.nombreEnfants}
            onChange={(e) =>
              onChange({ ...valeur, nombreEnfants: e.target.value.replace(/\D/g, '').slice(0, 2) })
            }
          />
        </Field>
        {epousesPossibles
          ? valeur.epouses.map((nom, i) => (
              <Field
                key={i}
                label={n === 1 ? 'Nom de l’épouse' : `Nom de l’épouse ${i + 1}`}
                htmlFor={`epouse-${i}`}
                required
              >
                <Input
                  id={`epouse-${i}`}
                  value={nom}
                  onChange={(e) =>
                    onChange({
                      ...valeur,
                      epouses: valeur.epouses.map((x, j) => (j === i ? e.target.value : x)),
                    })
                  }
                />
              </Field>
            ))
          : null}
        {texte('prenomDuPere', 'Prénom du père')}
        {texte('prenomDeLaMere', 'Prénom de la mère')}
        {texte('nomDeLaMere', 'Nom de la mère')}
      </ModalGrid>
    </ModalSection>
  );
}

export function SectionContactDUrgence({
  valeur,
  onChange,
}: {
  valeur: Complements;
  onChange: (c: Complements) => void;
}) {
  return (
    <ModalSection title="Personne à contacter en cas d’urgence">
      <ModalGrid>
        <Field label="Nom" htmlFor="urgenceNom">
          <Input
            id="urgenceNom"
            value={valeur.emergencyContactName}
            onChange={(e) => onChange({ ...valeur, emergencyContactName: e.target.value })}
          />
        </Field>
        <Field label="Lien de parenté" htmlFor="urgenceLien">
          <Select
            id="urgenceLien"
            value={valeur.lienContactUrgence}
            onChange={(e) => onChange({ ...valeur, lienContactUrgence: e.target.value })}
          >
            <option value="">Choisir un lien</option>
            {LIENS_DE_PARENTE.map((l) => (
              <option key={l} value={l}>
                {LIBELLES_LIEN_DE_PARENTE[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Téléphone"
          htmlFor="urgenceTelephone"
          error={erreurDuNumero(valeur.emergencyContactPhone) ?? undefined}
        >
          <ChampTelephone
            id="urgenceTelephone"
            stocke={valeur.emergencyContactPhone || null}
            onChange={(v) => onChange({ ...valeur, emergencyContactPhone: v })}
          />
        </Field>
      </ModalGrid>
    </ModalSection>
  );
}

/** Ce que l'emploi reçoit en plus, dans la section « Emploi ». */
export function ChampsDeLEmploi({
  valeur,
  onChange,
  exclure,
}: {
  valeur: Complements;
  onChange: (c: Complements) => void;
  /** L'agent de la fiche : on n'est pas son propre responsable fonctionnel. */
  exclure?: string;
}) {
  const texte = (champ: 'lieuDeTravail' | 'projet' | 'categorie', libelle: string) => (
    <Field label={libelle} htmlFor={champ}>
      <Input
        id={champ}
        value={valeur[champ]}
        onChange={(e) => onChange({ ...valeur, [champ]: e.target.value })}
      />
    </Field>
  );
  return (
    <>
      {texte('lieuDeTravail', 'Lieu de travail')}
      {texte('projet', 'Projet')}
      {texte('categorie', 'Catégorie socio-professionnelle')}
      <Field label="Responsable fonctionnel" htmlFor="responsableFonctionnel">
        <ChoixDUnAgent
          id="responsableFonctionnel"
          agent={valeur.responsableFonctionnel}
          exclure={exclure}
          onChoisir={(a) => onChange({ ...valeur, responsableFonctionnel: a })}
        />
      </Field>
    </>
  );
}

/** La rémunération, la banque et l'IPRES : pour qui a l'accès aux données sensibles. */
export function SectionRemuneration({
  valeur,
  onChange,
}: {
  valeur: RemunerationSaisie;
  onChange: (r: RemunerationSaisie) => void;
}) {
  const texte = (champ: 'autresAvantages' | 'domiciliation' | 'numeroIpres', libelle: string) => (
    <Field label={libelle} htmlFor={champ}>
      <Input
        id={champ}
        value={valeur[champ]}
        onChange={(e) => onChange({ ...valeur, [champ]: e.target.value })}
      />
    </Field>
  );
  return (
    <>
      <ModalSection title="Rémunération">
        <ModalGrid>
          {MONTANTS.map(([cle, libelle]) => (
            <ChampMontant
              key={cle}
              id={cle}
              libelle={libelle}
              montant={valeur[cle]}
              onSaisir={(m) => onChange({ ...valeur, [cle]: m })}
            />
          ))}
          {texte('autresAvantages', 'Autres avantages')}
          <Field label="Nombre de parts" htmlFor="nombreDeParts">
            <Select
              id="nombreDeParts"
              value={valeur.nombreDeParts}
              onChange={(e) => onChange({ ...valeur, nombreDeParts: e.target.value })}
            >
              <option value="">Choisir un nombre</option>
              {NOMBRES_DE_PARTS.map((p) => (
                <option key={p} value={String(p)}>
                  {p.toLocaleString('fr-FR')}
                </option>
              ))}
            </Select>
          </Field>
        </ModalGrid>
      </ModalSection>
      <ModalSection title="Banque et IPRES">
        <ModalGrid>
          <Field label="Banque" htmlFor="banque">
            <Select
              id="banque"
              value={valeur.banque}
              onChange={(e) => onChange({ ...valeur, banque: e.target.value })}
            >
              <option value="">Choisir une banque</option>
              {BANQUES.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.nom}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="RIB" htmlFor="rib" error={erreurDuRib(valeur.rib) ?? undefined}>
            <Input
              id="rib"
              className="font-mono uppercase"
              value={valeur.rib}
              onChange={(e) => onChange({ ...valeur, rib: e.target.value })}
            />
          </Field>
          {texte('domiciliation', 'Domiciliation')}
          {texte('numeroIpres', 'Numéro IPRES')}
        </ModalGrid>
      </ModalSection>
    </>
  );
}

/* ───────────────── Le choix d'un agent ───────────────── */

const nomDe = (a: Pick<EmployeeListItem, 'givenName' | 'familyName'>) =>
  `${a.givenName} ${a.familyName}`;

/**
 * Un agent en activité, cherché par son nom ou son matricule dans tout
 * l'effectif. Le champ montre le nom retenu ; y écrire en cherche un autre,
 * le quitter sans choisir garde le premier, et la croix le retire.
 */
export function ChoixDUnAgent({
  id: idDuChamp,
  agent,
  exclure,
  onChoisir,
}: {
  id: string;
  agent: AgentChoisi | null;
  exclure?: string;
  onChoisir: (a: AgentChoisi | null) => void;
}) {
  const id = useId();
  const [texte, setTexte] = useState(agent?.nom ?? '');
  const [cherche, setCherche] = useState('');
  const [ouverte, setOuverte] = useState(false);
  const [courant, setCourant] = useState(0);

  useEffect(() => {
    const saisi = agent && texte === agent.nom ? '' : texte.trim();
    const t = setTimeout(() => setCherche(saisi), 200);
    return () => clearTimeout(t);
  }, [texte, agent]);
  useEffect(() => setCourant(0), [cherche]);

  const resultats = useQuery({
    queryKey: ['employees', 'choix', cherche],
    queryFn: ({ signal }) =>
      api<EmployeeListPage>(
        `/employees?status=active&sort=name&dir=asc&limit=20&q=${encodeURIComponent(cherche)}`,
        { signal },
      ),
    enabled: ouverte,
  });
  const agents = (resultats.data?.items ?? []).filter((a) => a.id !== exclure);

  const remettre = () => setTexte(agent?.nom ?? '');
  const choisir = (a: EmployeeListItem | undefined) => {
    if (!a) return;
    setOuverte(false);
    setTexte(nomDe(a));
    onChoisir({ id: a.id, nom: nomDe(a), matricule: a.employeeNumber });
  };

  return (
    <div className="relative">
      <Icon
        name="search"
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted/70"
      />
      <Input
        id={idDuChamp}
        role="combobox"
        aria-expanded={ouverte}
        aria-controls={`${id}-liste`}
        aria-autocomplete="list"
        aria-activedescendant={ouverte && agents[courant] ? `${id}-${courant}` : undefined}
        autoComplete="off"
        placeholder="Nom ou matricule…"
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          setOuverte(true);
        }}
        onFocus={(e) => {
          e.target.select();
          setOuverte(true);
        }}
        onBlur={() => {
          setOuverte(false);
          remettre();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOuverte(true);
            setCourant((c) => Math.min(c + 1, Math.max(agents.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCourant((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter' && ouverte) {
            e.preventDefault();
            choisir(agents[courant]);
          } else if (e.key === 'Escape') {
            setOuverte(false);
            remettre();
          }
        }}
        className={cn('pl-8', agent ? 'pr-9' : 'pr-3')}
      />
      {agent ? (
        <button
          type="button"
          aria-label="Retirer"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setTexte('');
            onChoisir(null);
          }}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink-strong"
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
      {ouverte ? (
        <div className={MENU}>
          <ul
            id={`${id}-liste`}
            role="listbox"
            aria-label="Agents"
            className={cn(DEFILEMENT, 'max-h-[min(18rem,calc(100dvh_-_12rem))]')}
          >
            {agents.length === 0 ? (
              <li className="px-2.5 py-2 text-[12.5px] text-ink-muted">
                {resultats.isFetching ? 'Recherche…' : 'Aucun résultat'}
              </li>
            ) : (
              agents.map((a, i) => (
                <li
                  key={a.id}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={a.id === agent?.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setCourant(i)}
                  onClick={() => choisir(a)}
                  className={cn(
                    'cursor-pointer rounded-controle-sm px-2.5 py-2 transition-colors duration-150',
                    a.id === agent?.id ? 'bg-primary/[0.06]' : i === courant ? 'bg-hover' : null,
                  )}
                >
                  <span className="block truncate text-[13px] font-medium text-ink-strong">
                    {nomDe(a)}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    <span className="font-mono">{a.employeeNumber}</span>
                    {a.positionTitle ? ` · ${a.positionTitle}` : null}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
