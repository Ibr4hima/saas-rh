'use client';

import { Modal } from './modal';
import { ApercuDocument, type ViewableDoc } from './doc-viewer';

/**
 * La fenêtre d'aperçu du produit — la SEULE.
 *
 * Consulter une pièce se faisait auparavant dans une surcouche maison :
 * fond noir, en-tête à part, « Fermer ✕ » écrit à la main. Elle ne
 * ressemblait à aucune autre fenêtre de l'application, et le lecteur qu'elle
 * contenait affichait une seconde fois le nom du fichier déjà écrit au-dessus.
 *
 * C'est désormais la fenêtre commune qui l'entoure : mêmes marges, même
 * en-tête, même croix, même comportement au clavier. La coquille nomme le
 * document ; la barre du lecteur, elle, ne garde que le pilotage — pages et
 * zoom — au lieu de répéter ce titre.
 */
export function FenetreDocument({
  doc,
  onClose,
  sousTitre,
}: {
  doc: ViewableDoc | null;
  onClose: () => void;
  /** Le contexte de la pièce : de qui, de quand — quand l'appelant le sait. */
  sousTitre?: React.ReactNode;
}) {
  if (!doc) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={doc.titre ?? doc.filename}
      subtitle={sousTitre}
      maxWidth="max-w-4xl"
    >
      {/* Hauteur fixée : la fenêtre se dimensionne sur son contenu, et un
          enfant qui réclame « toute la hauteur » d'un parent sans hauteur
          propre se réduit à zéro. */}
      <div className="h-[min(72vh,720px)] overflow-hidden rounded-[12px] border border-card-line">
        <ApercuDocument doc={{ ...doc, titre: null }} />
      </div>
    </Modal>
  );
}
