'use client';

import { use } from 'react';
import { LecteurReference } from '../../../../components/lecteur-reference';
import { Page } from '../../../../components/gabarit';

/**
 * Un écran pour TOUS les textes de référence.
 *
 * Le code du travail et le règlement intérieur avaient chacun leur page de
 * prose figée dans le produit. Ils ont la même forme — des chapitres, des
 * articles, un fichier officiel — et se lisent donc au même endroit ; ce qui
 * les distingue est leur contenu, qui vient désormais de la base.
 */
export default function TexteDeReferencePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <Page>
      <LecteurReference slug={slug} />
    </Page>
  );
}
