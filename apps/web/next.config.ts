import type { NextConfig } from 'next';

/**
 * Le serveur de développement et la compilation de production n'écrivent PAS
 * dans le même dossier.
 *
 * Par défaut, les deux utilisent `.next`. Lancer `pnpm build` puis `pnpm dev`
 * — l'enchaînement naturel après un `git pull` — laisse donc le serveur de
 * développement au milieu d'artefacts de production. Il sert alors un
 * `.next/server/pages/_document.js` qui réclame un morceau de code que la
 * compilation suivante a remplacé :
 *
 *     Error: Cannot find module './267.js'
 *
 * Les conséquences ne ressemblent en rien à leur cause : `main-app.js` répond
 * 404, la page ne s'HYDRATE JAMAIS — plus un seul bouton ne réagit — et selon
 * la route la feuille de style manque aussi, ce qui donne une page de texte
 * brut et une « erreur d'exécution [object Event] » qui ne dit rien.
 *
 * On peut demander à chacun de penser à effacer `.next`. Il vaut mieux que la
 * collision n'existe pas.
 *
 * Contrepartie, réglée dans tsconfig.json : Next inscrit d'office les types de
 * routes de CHAQUE dossier de sortie dans `include`. La compilation de
 * production se mettait donc à vérifier ceux du serveur de développement, qui
 * sont périmés dès qu'il ne tourne pas — supprimer une page faisait échouer la
 * compilation sur un fichier qui ne la concerne pas. `.next-dev` est donc
 * exclu du contrôle de types : `next build` régénère les siens dans la foulée,
 * ceux du développement n'ont personne pour les rafraîchir.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  reactStrictMode: true,
  transpilePackages: ['@teranga/ui'],
  // L'indicateur de développement de Next (le rond « N ») se posait en bas à
  // gauche, sur la carte du compte — et, la colonne repliée, sur le bouton du
  // menu du compte lui-même. Il n'existe qu'en développement ; en bas à
  // droite, il ne cache plus rien d'utile.
  devIndicators: { position: 'bottom-right' },
  // Les courriels chargent Google Sans depuis le site. Une police venue d'un
  // autre domaine ne s'applique qu'avec la permission du site qui la sert.
  async headers() {
    return [
      {
        // Ce que chaque réponse dit au navigateur, en plus de la politique
        // du contenu (cf. middleware.ts). Aucun référent : l'adresse d'un
        // lien d'invitation ou de réinitialisation porte un jeton, elle ne
        // part vers aucun autre site.
        source: '/:chemin*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
      {
        source: '/fonts/:fichier*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ];
  },
  // Le serveur ne dit pas ce qu'il est.
  poweredByHeader: false,
};

export default nextConfig;
