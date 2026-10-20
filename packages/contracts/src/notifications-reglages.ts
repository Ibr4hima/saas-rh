import { z } from 'zod';
import { CAPACITES_DOCUMENTS, CAPACITES_PIECES, peut, type Capacite } from './acces';
import type { SessionUser } from './core';

/* Les notifications, réglées par chacun.

   Une notification parle d'un SUJET : « mes congés », « les congés de mon
   équipe », « les demandes de congé à traiter ». Chacun règle ses sujets,
   pas des types techniques : la même décision sur un congé (approuvé,
   refusé, annulé, écourté) est un seul sujet pour l'agent.

   Un sujet n'est proposé qu'à qui peut le recevoir : un N+1 voit les
   congés de son équipe, un membre de la DCH les demandes que ses
   délégations lui confient, l'administrateur ce qui reste sans
   responsable. Le catalogue est ici, une fois, pour l'API qui envoie et
   pour l'écran qui règle.

   Deux canaux : la plateforme et le courriel, cochés tous deux sans
   réglage (ADR-0074). */

export const CANAUX = ['plateforme', 'courriel'] as const;
export type Canal = (typeof CANAUX)[number];

export const LIBELLES_CANAL: Record<Canal, string> = {
  plateforme: 'Plateforme',
  courriel: 'Courriel',
};

/** Où le sujet se range à l'écran : ce qui me concerne, mon équipe, ce que je traite. */
export type GroupeDeSujets = 'moi' | 'equipe' | 'gestion';

export const LIBELLES_GROUPE: Record<GroupeDeSujets, string> = {
  moi: 'Mon espace',
  equipe: 'Mon équipe',
  gestion: 'Gestion RH',
};

/** Ce qu'il faut savoir d'une personne pour lui proposer un sujet. */
export interface ProfilDeNotification extends Pick<
  SessionUser,
  'role' | 'capacites' | 'estAgent' | 'estDG' | 'dirigeLaDCH'
> {
  /** Des agents lui rendent compte. */
  aUneEquipe: boolean;
}

interface DefinitionDeSujet {
  groupe: GroupeDeSujets;
  libelle: string;
  /** L'icône du sujet, celle de la page où il mène. */
  icone: string;
  pour: (p: ProfilDeNotification) => boolean;
}

const agent = (p: ProfilDeNotification) => p.estAgent;
const agentEvalue = (p: ProfilDeNotification) => p.estAgent && !p.estDG;
const auMoinsUne = (p: ProfilDeNotification, capacites: readonly Capacite[]) =>
  capacites.some((c) => peut(p, c));

export const SUJETS = {
  conges: {
    groupe: 'moi',
    libelle: 'Mes congés et absences',
    icone: 'event_available',
    pour: agent,
  },
  documents: {
    groupe: 'moi',
    libelle: 'Mes demandes de documents',
    icone: 'description',
    pour: agent,
  },
  pieces: {
    groupe: 'moi',
    libelle: 'Mes pièces déposées',
    icone: 'upload_file',
    pour: agent,
  },
  'pieces.expiration': {
    groupe: 'moi',
    libelle: 'Expiration de ma pièce d’identité',
    icone: 'badge',
    pour: agent,
  },
  informations: {
    groupe: 'moi',
    libelle: 'Mes changements d’informations',
    icone: 'how_to_reg',
    pour: agent,
  },
  objectifs: {
    groupe: 'moi',
    libelle: 'Mes objectifs et mon évaluation',
    icone: 'flag',
    pour: agentEvalue,
  },
  'objectifs.apix': {
    groupe: 'moi',
    libelle: 'Objectifs de ma direction et orientations de l’APIX',
    icone: 'trending_up',
    pour: agentEvalue,
  },
  academy: {
    groupe: 'moi',
    libelle: 'Mes formations et certificats',
    icone: 'school',
    pour: agent,
  },
  feries: {
    groupe: 'moi',
    libelle: 'Jours fériés à venir',
    icone: 'calendar_month',
    pour: () => true,
  },
  'equipe.conges': {
    groupe: 'equipe',
    libelle: 'Congés de mon équipe',
    icone: 'groups',
    pour: (p) => p.aUneEquipe,
  },
  'equipe.objectifs': {
    groupe: 'equipe',
    libelle: 'Objectifs et auto-évaluations de mon équipe',
    icone: 'rate_review',
    pour: (p) => p.aUneEquipe,
  },
  'dch.conges': {
    groupe: 'gestion',
    libelle: 'Demandes de congé à traiter',
    icone: 'free_cancellation',
    pour: (p) => peut(p, 'demandes.conges'),
  },
  'dch.documents': {
    groupe: 'gestion',
    libelle: 'Demandes de documents à traiter',
    icone: 'folder_managed',
    pour: (p) => auMoinsUne(p, CAPACITES_DOCUMENTS),
  },
  'dch.informations': {
    groupe: 'gestion',
    libelle: 'Changements d’informations à traiter',
    icone: 'how_to_reg',
    pour: (p) => peut(p, 'demandes.informations'),
  },
  'dch.pieces': {
    groupe: 'gestion',
    libelle: 'Pièces déposées à vérifier',
    icone: 'verified_user',
    pour: (p) => auMoinsUne(p, CAPACITES_PIECES),
  },
  'dch.contrats': {
    groupe: 'gestion',
    libelle: 'Fins de contrat',
    icone: 'work_history',
    pour: (p) => peut(p, 'personnel.gerer'),
  },
  'dch.rattachements': {
    groupe: 'gestion',
    libelle: 'N+1 à revoir',
    icone: 'account_tree',
    pour: (p) => peut(p, 'personnel.gerer'),
  },
  'dch.delegations': {
    groupe: 'gestion',
    libelle: 'Délégations de la DCH',
    icone: 'account_tree',
    pour: (p) => p.dirigeLaDCH,
  },
  'admin.dch': {
    groupe: 'gestion',
    libelle: 'Demandes sans responsable',
    icone: 'warning',
    pour: (p) => p.role === 'admin',
  },
} as const satisfies Record<string, DefinitionDeSujet>;

export type SujetNotification = keyof typeof SUJETS;
export const CLES_SUJETS = Object.keys(SUJETS) as SujetNotification[];

export const sujetSchema = z.enum(CLES_SUJETS as [SujetNotification, ...SujetNotification[]]);

/** Les sujets qu'une personne peut recevoir, dans l'ordre de l'écran. */
export function sujetsDe(p: ProfilDeNotification): SujetNotification[] {
  return CLES_SUJETS.filter((c) => (SUJETS[c] as DefinitionDeSujet).pour(p));
}

/** Sans réglage : la plateforme et le courriel. */
export const CANAUX_PAR_DEFAUT: Record<Canal, boolean> = {
  plateforme: true,
  courriel: true,
};

// ---------- Ce que l'écran lit et écrit ----------

export interface ReglageDeSujet {
  sujet: SujetNotification;
  groupe: GroupeDeSujets;
  libelle: string;
  icone: string;
  plateforme: boolean;
  courriel: boolean;
}

export interface ReglagesNotifications {
  sujets: ReglageDeSujet[];
  /** Proposée à qui prend des congés : l'agent. */
  pauseConges: boolean | null;
}

export const changerSujetsSchema = z.object({
  sujets: z
    .array(
      z.object({
        sujet: sujetSchema,
        plateforme: z.boolean(),
        courriel: z.boolean(),
      }),
    )
    .min(1)
    .max(CLES_SUJETS.length),
});
export type ChangerSujetsInput = z.infer<typeof changerSujetsSchema>;

export const changerReglagesSchema = z.object({
  pauseConges: z.boolean(),
});
export type ChangerReglagesInput = z.infer<typeof changerReglagesSchema>;
