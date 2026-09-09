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
 */
const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  reactStrictMode: true,
  transpilePackages: ['@teranga/ui'],
};

export default nextConfig;
