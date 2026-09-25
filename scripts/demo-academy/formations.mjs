/**
 * Deux formations de démonstration pour APIX Academy.
 *
 * Elles servent à VOIR l'Academy remplie — catalogue, programme, lecteur,
 * supports — avant que la RH ait enregistré ses propres cours. Les vidéos qui
 * les accompagnent sont des cartes-titres (le nom de la leçon, sa formation,
 * une barre qui avance) : elles ont la durée d'une vraie leçon, pas son
 * contenu.
 *
 * Une seule source pour les deux scripts : `fabriquer-videos.mjs` en tire les
 * vidéos, `seed-academy.mjs` la structure. Un titre changé ici change les
 * deux.
 */

export const FORMATIONS = [
  {
    cle: 'powerpoint',
    title: 'Microsoft PowerPoint : des présentations qui convainquent',
    category: 'bureautique',
    summary:
      'Construire une présentation claire et professionnelle, du plan au diaporama. Structurer son message, soigner la mise en page avec le masque aux couleurs de l’APIX, animer avec sobriété et présenter avec aisance devant un comité ou un investisseur.',
    modules: [
      {
        title: 'Prendre en main PowerPoint',
        lessons: [
          { title: 'L’interface et les modes d’affichage', duree: 190 },
          { title: 'Partir d’un modèle ou d’une page blanche', duree: 260 },
        ],
      },
      {
        title: 'Concevoir des diapositives efficaces',
        lessons: [
          {
            title: 'Une idée par diapositive : structurer son message',
            duree: 300,
            support: {
              titre: 'Structurer son message',
              lignes: [
                'Avant d’ouvrir PowerPoint : écrire le message en une phrase.',
                'Une diapositive = une idée, énoncée dans son titre.',
                'Le titre est une affirmation, pas un sujet : « Les IDE ont progressé de 12 % » plutôt que « Les IDE ».',
                'Trois à cinq points au plus par diapositive.',
                'Le plan se lit dans les titres seuls : faites le test en mode Plan.',
                'Terminer par ce que l’on attend de l’auditoire : une décision, un accord, une date.',
              ],
            },
          },
          {
            title: 'Le masque des diapositives et la charte APIX',
            duree: 390,
            support: {
              titre: 'Le masque des diapositives',
              lignes: [
                'Affichage › Masque des diapositives : tout ce qui s’y trouve s’applique partout.',
                'Couleurs de la charte : bleu APIX #004F91 pour la structure, orange #CA631F avec parcimonie.',
                'Police : une seule famille, deux graisses (normal et gras).',
                'Logo et pied de page posés dans le masque, jamais copiés diapositive par diapositive.',
                'Des dispositions nommées : Titre, Titre et contenu, Deux contenus, Chiffre clé.',
                'Modifier le masque met à jour toute la présentation en une fois.',
              ],
            },
          },
          { title: 'Tableaux, graphiques et SmartArt', duree: 435 },
        ],
      },
      {
        title: 'Animer et présenter',
        lessons: [
          { title: 'Transitions et animations : l’art de la sobriété', duree: 285 },
          { title: 'Le mode Présentateur et les notes', duree: 230 },
          { title: 'Exporter en PDF et partager', duree: 170 },
        ],
      },
    ],
  },
  {
    cle: 'macroeconomie',
    title: 'Macroéconomie : comprendre l’économie sénégalaise',
    category: 'economie',
    summary:
      'Les notions essentielles pour lire une note de conjoncture et dialoguer avec un investisseur : le PIB et la croissance, l’inflation et la politique monétaire de la BCEAO, les finances publiques, la balance des paiements, et ce qui fait l’attractivité du Sénégal.',
    modules: [
      {
        title: 'Les grands agrégats',
        lessons: [
          {
            title: 'Le PIB et ses trois optiques',
            duree: 480,
            support: {
              titre: 'Le PIB et ses trois optiques',
              lignes: [
                'Le produit intérieur brut mesure la richesse créée sur le territoire en une année.',
                'Optique de la production : somme des valeurs ajoutées des secteurs.',
                'Optique de la demande : consommation + investissement + dépenses publiques + exportations − importations.',
                'Optique des revenus : rémunérations + excédent brut d’exploitation + impôts nets sur la production.',
                'Les trois optiques donnent, par construction, le même montant.',
                'Au Sénégal, les comptes nationaux sont publiés par l’ANSD.',
              ],
            },
          },
          { title: 'Croissance : PIB réel et PIB nominal', duree: 400 },
        ],
      },
      {
        title: 'Monnaie, prix et finances publiques',
        lessons: [
          { title: 'L’inflation : la mesurer, la comprendre', duree: 440 },
          {
            title: 'La BCEAO et la politique monétaire de l’UEMOA',
            duree: 570,
            support: {
              titre: 'La BCEAO et la politique monétaire',
              lignes: [
                'La BCEAO est la banque centrale commune aux huit États de l’UEMOA.',
                'Son objectif principal : la stabilité des prix, avec une cible d’inflation de 1 à 3 %.',
                'Ses instruments : les taux directeurs et les réserves obligatoires des banques.',
                'Le franc CFA est arrimé à l’euro à parité fixe : 1 € = 655,957 FCFA.',
                'Conséquence : la politique monétaire suit de près celle de la zone euro.',
                'À suivre : le communiqué du Comité de politique monétaire, chaque trimestre.',
              ],
            },
          },
          { title: 'Budget de l’État, déficit et dette publique', duree: 510 },
        ],
      },
      {
        title: 'Le Sénégal dans l’économie mondiale',
        lessons: [
          { title: 'La balance des paiements', duree: 470 },
          {
            title: 'Investissements directs étrangers et attractivité',
            duree: 615,
            support: {
              titre: 'Investissements directs étrangers',
              lignes: [
                'Un IDE est une prise de participation d’au moins 10 % dans une entreprise étrangère.',
                'Il se distingue de l’investissement de portefeuille par la volonté d’influer sur la gestion.',
                'Les flux d’IDE sont suivis par la CNUCED (rapport annuel sur l’investissement dans le monde).',
                'Facteurs d’attractivité : stabilité, infrastructures, main-d’œuvre, cadre juridique, fiscalité.',
                'Le rôle de l’APIX : accueillir, accompagner et suivre les investisseurs.',
                'Un indicateur à retenir : le stock d’IDE rapporté au PIB.',
              ],
            },
          },
          { title: 'Lire une note de conjoncture', duree: 330 },
        ],
      },
    ],
  },
];

/** Le nom du fichier vidéo d'une leçon : formation, module, leçon. */
export function fichierVideo(formation, m, l) {
  return `${formation.cle}-${m + 1}-${l + 1}.mp4`;
}
