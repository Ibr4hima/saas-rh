import {
  capaciteDeLaPiece,
  capaciteDuDocument,
  DOCUMENT_CATEGORY_LABELS,
  REQUESTABLE_DOC_LABELS,
  requestableDocSchema,
  type Capacite,
  type PieceAVerifier,
  type RequestableDoc,
} from '@teranga/contracts';

/* ————————————————————————————————————————————————————————————————
   Ce qui se délègue type par type, sur « Déléguer des tâches » : les
   demandes de documents, et la vérification des documents officiels. Un
   type de document par ligne, et pour chacun les membres de la DCH qui
   peuvent le traiter.

   Les documents officiels se délèguent par familles, qui se vérifient
   ensemble : la CNI et le passeport, les diplômes et les certifications,
   les attestations de travail et de stage, le CV. Côté demandes, les
   attestations de travail et de stage vont aussi ensemble.

   Déléguer autorise, sans rien retirer : le directeur traite toujours tout.
   Décocher retire la délégation. Les documents qui ne se demandent plus n'y
   figurent pas : ils restent à qui dirige la DCH (ADR-0084).
   ———————————————————————————————————————————————————————————————— */

/** Ce qui se délègue d'un bloc : son libellé, ses habilitations. */
export interface TypeDelegable {
  libelle: string;
  capacites: readonly Capacite[];
}

/** Les documents qu'un agent demande : la liste de la DCH. */
export const DOCUMENTS_DELEGABLES = requestableDocSchema.options;

/** Les documents officiels qu'un agent dépose, par familles. */
const FAMILLES_DE_PIECES: readonly { libelle: string; types: readonly PieceAVerifier[] }[] = [
  { libelle: 'CNI et passeport', types: ['cni', 'passeport'] },
  { libelle: 'Diplômes et certifications', types: ['diplome', 'certification'] },
  {
    libelle: 'Attestations de travail et de stage',
    types: ['attestation_travail', 'attestation_stage'],
  },
  { libelle: DOCUMENT_CATEGORY_LABELS.cv, types: ['cv'] },
];

/**
 * Les mêmes, par familles, dans l'ordre de la liste : les attestations de
 * travail et de stage vont ensemble, à la place de la première.
 */
const FAMILLES_DE_DOCUMENTS: readonly { libelle: string; types: readonly RequestableDoc[] }[] =
  DOCUMENTS_DELEGABLES.filter((d) => d !== 'attestation_stage').map((d) =>
    d === 'attestation_travail'
      ? {
          libelle: 'Attestations de travail et de stage',
          types: ['attestation_travail', 'attestation_stage'],
        }
      : { libelle: REQUESTABLE_DOC_LABELS[d], types: [d] },
  );

export const TYPES_DOCUMENTS: readonly TypeDelegable[] = FAMILLES_DE_DOCUMENTS.map((f) => ({
  libelle: f.libelle,
  capacites: f.types.map(capaciteDuDocument),
}));

export const TYPES_PIECES: readonly TypeDelegable[] = FAMILLES_DE_PIECES.map((f) => ({
  libelle: f.libelle,
  capacites: f.types.map(capaciteDeLaPiece),
}));
