import Link from 'next/link';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@teranga/ui';

export default function ReglementationsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Déjà appliqué dans le produit</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-ink">
            <p>
              <strong className="text-ink-strong">Protection des données</strong> — loi sénégalaise
              n°2008-12 (CDP) et RGPD : journal d&apos;audit immuable de toutes les modifications,
              chiffrement des pièces d&apos;identité au stockage, cloisonnement strict des données
              par organisation.
            </p>
            <p>
              <strong className="text-ink-strong">Jours fériés</strong> — calendrier par
              organisation, éditable en cours d&apos;année (Korité, Tabaski…), exclu du décompte des
              congés.{' '}
              <Link href="/absences/parametres" className="text-primary hover:underline">
                Gérer les jours fériés
              </Link>
            </p>
            <p>
              <strong className="text-ink-strong">Circuits de validation</strong> — chaîne de visas
              à plusieurs niveaux, chaque décision tracée (qui, quand, commentaire).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>À venir</CardTitle>
            <Badge tone="primary">Roadmap</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-ink-muted">
            <p>
              <strong className="text-ink-strong">Convention collective (CCNI)</strong> — droits à
              congés selon l&apos;ancienneté, préavis, indemnités : intégrés avec le moteur de paie,
              validés par un expert-comptable sénégalais.
            </p>
            <p>
              <strong className="text-ink-strong">Déclarations sociales et fiscales</strong> —
              IPRES, CSS, DGID : générées par le module paie (phase 2 de la feuille de route).
            </p>
            <p>
              <strong className="text-ink-strong">Alertes réglementaires</strong> — fins de CDD,
              périodes d&apos;essai, visites médicales : notifications automatiques à venir.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
