/**
 * Deux formations de démonstration pour APIX Academy.
 *
 * Elles servent à VOIR l'Academy remplie — catalogue, programme, lecteur,
 * supports — avant que la RH ait enregistré ses propres cours. Les vidéos qui
 * les accompagnent sont des cartes-titres (le nom de la leçon, sa formation,
 * une barre qui avance) : elles ont la durée d'une vraie leçon, pas son
 * contenu.
 *
 * Chacune porte sa banque de questions pour l'évaluation finale : huit
 * questions, cinq tirées à chaque tentative.
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
    evaluation: {
      questionCount: 5,
      questions: [
        {
          prompt:
            'Quel mode d’affichage permet de réorganiser rapidement l’ordre des diapositives ?',
          kind: 'unique',
          options: [
            ['La trieuse de diapositives', true],
            ['Le mode Lecture', false],
            ['La page de commentaires', false],
            ['Le mode Présentateur', false],
          ],
        },
        {
          prompt:
            'Où modifier une fois pour toutes la police et les couleurs de toutes les diapositives ?',
          kind: 'unique',
          options: [
            ['Dans le masque des diapositives', true],
            ['Dans l’onglet Transitions', false],
            ['Dans le volet Animation', false],
            ['Dans le mode Plan', false],
          ],
        },
        {
          prompt: 'Que doit dire le titre d’une diapositive efficace ?',
          kind: 'unique',
          options: [
            ['Le message que la diapositive démontre', true],
            ['Le sujet général de la présentation', false],
            ['Le numéro de la section', false],
            ['Le nom du service qui présente', false],
          ],
        },
        {
          prompt: 'Lesquelles de ces pratiques rendent une diapositive plus lisible ?',
          kind: 'multiple',
          options: [
            ['Une seule idée par diapositive', true],
            ['Trois à cinq points au plus', true],
            ['Des paragraphes complets', false],
            ['Plusieurs polices pour varier', false],
          ],
        },
        {
          prompt:
            'Quel mode vous montre vos notes et la diapositive suivante, pendant que le public ne voit que la diapositive en cours ?',
          kind: 'unique',
          options: [
            ['Le mode Présentateur', true],
            ['Le mode Lecture', false],
            ['La trieuse de diapositives', false],
            ['Le mode Normal', false],
          ],
        },
        {
          prompt:
            'Pour envoyer une présentation qui ne doit pas être modifiée, quel format choisir ?',
          kind: 'unique',
          options: [
            ['PDF', true],
            ['PPTX', false],
            ['Le modèle .potx', false],
            ['Texte brut', false],
          ],
        },
        {
          prompt: 'Selon la charte de l’APIX, quels usages des couleurs sont justes ?',
          kind: 'multiple',
          options: [
            ['Le bleu APIX pour la structure', true],
            ['L’orange avec parcimonie', true],
            ['Une couleur différente par diapositive', false],
            ['Le rouge pour tous les titres', false],
          ],
        },
        {
          prompt: 'Combien d’animations faut-il viser par diapositive, en règle générale ?',
          kind: 'unique',
          options: [
            ['Aucune ou une seule, au service du propos', true],
            ['Une par ligne de texte', false],
            ['Le plus possible, pour capter l’attention', false],
            ['Toujours trois', false],
          ],
        },
      ],
    },
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
    evaluation: {
      questionCount: 5,
      questions: [
        {
          prompt: 'Que mesure le produit intérieur brut ?',
          kind: 'unique',
          options: [
            ['La richesse créée sur le territoire en une année', true],
            ['Le patrimoine total des ménages', false],
            ['Les recettes fiscales de l’État', false],
            ['La valeur des seules exportations', false],
          ],
        },
        {
          prompt: 'Quelles sont les trois optiques du PIB ?',
          kind: 'multiple',
          options: [
            ['La production', true],
            ['La demande', true],
            ['Les revenus', true],
            ['La dette publique', false],
          ],
        },
        {
          prompt: 'Le PIB réel se distingue du PIB nominal parce qu’il…',
          kind: 'unique',
          options: [
            ['est corrigé de l’évolution des prix', true],
            ['inclut l’économie informelle', false],
            ['est exprimé en dollars', false],
            ['ne compte que les exportations', false],
          ],
        },
        {
          prompt: 'Quelle est la cible d’inflation de la BCEAO ?',
          kind: 'unique',
          options: [
            ['Entre 1 et 3 %', true],
            ['0 %', false],
            ['Entre 5 et 7 %', false],
            ['Au moins 10 %', false],
          ],
        },
        {
          prompt: 'À quelle monnaie le franc CFA de l’UEMOA est-il arrimé à parité fixe ?',
          kind: 'unique',
          options: [
            ['L’euro', true],
            ['Le dollar américain', false],
            ['Le yuan', false],
            ['Le franc suisse', false],
          ],
        },
        {
          prompt: 'Combien d’États membres compte l’UEMOA ?',
          kind: 'unique',
          options: [
            ['Huit', true],
            ['Six', false],
            ['Dix', false],
            ['Quinze', false],
          ],
        },
        {
          prompt:
            'À partir de quelle part du capital parle-t-on d’investissement direct étranger ?',
          kind: 'unique',
          options: [
            ['10 %', true],
            ['50 %', false],
            ['1 %', false],
            ['100 %', false],
          ],
        },
        {
          prompt:
            'Parmi ces facteurs, lesquels renforcent l’attractivité d’un pays pour les investisseurs ?',
          kind: 'multiple',
          options: [
            ['La stabilité politique et juridique', true],
            ['La qualité des infrastructures', true],
            ['Une main-d’œuvre qualifiée', true],
            ['Des délais administratifs imprévisibles', false],
          ],
        },
      ],
    },
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
