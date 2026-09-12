/**
 * Contenu de démonstration des textes de référence.
 *
 * Le RÈGLEMENT INTÉRIEUR est, par nature, le texte propre à une organisation :
 * celui-ci est une rédaction plausible pour l'APIX, destinée à montrer l'écran
 * de lecture. Il est à remplacer par le règlement réellement adopté.
 *
 * Le CODE DU TRAVAIL est une loi nationale : personne ne l'« adopte ». Ce qui
 * suit en reprend le plan et résume quelques dispositions bien établies, mais
 * ce n'est PAS le texte officiel — sa référence le dit, et le PDF déposé par
 * la RH reste le seul document qui fasse foi.
 */

export const REGLEMENT_INTERIEUR = {
  title: 'Règlement intérieur',
  reference: 'Adopté le 1er mars 2024 — exemple de démonstration',
  effectiveOn: '2024-03-01',
  published: true,
  chapters: [
    {
      number: 1,
      title: 'Dispositions générales',
      body: "Le présent règlement s'applique à l'ensemble du personnel de l'agence, quel que soit le lieu d'exécution du travail, ainsi qu'aux stagiaires et aux personnes mises à disposition.",
      sections: [],
      articles: [
        {
          number: 1,
          title: 'Objet',
          body: "Le présent règlement intérieur fixe les règles relatives à l'organisation du travail, à la discipline, à l'hygiène et à la sécurité au sein de l'agence.\n\nIl complète le Code du travail et la convention collective applicable, sans jamais y déroger dans un sens défavorable à l'employé.",
        },
        {
          number: 2,
          title: "Champ d'application",
          body: "Il s'impose à chaque membre du personnel dès son entrée en fonction. Nul ne peut s'en prévaloir de l'ignorance une fois qu'il lui a été porté à connaissance.",
        },
        {
          number: 3,
          title: 'Entrée en vigueur et modifications',
          body: "Toute modification fait l'objet d'une nouvelle publication et d'une information individuelle du personnel. Elle ne prend effet qu'à compter de cette information.",
        },
      ],
    },
    {
      number: 2,
      title: 'Organisation du travail',
      body: null,
      sections: [
        { number: 1, title: 'Horaires et présence', body: null },
        { number: 2, title: 'Absences et congés', body: null },
      ],
      articles: [
        {
          number: 4,
          sectionNumber: 1,
          title: 'Horaires de travail',
          body: "L'horaire collectif est affiché dans les locaux et communiqué à chaque employé. Toute modification durable est portée à la connaissance du personnel au moins sept jours à l'avance.",
        },
        {
          number: 5,
          sectionNumber: 1,
          title: 'Retards',
          body: 'Tout retard doit être justifié auprès du supérieur hiérarchique. Les retards répétés et non justifiés peuvent donner lieu à une sanction.',
        },
        {
          number: 6,
          sectionNumber: 2,
          title: 'Demande de congé',
          body: "Les congés sont demandés par le portail de l'agence et soumis au visa du supérieur hiérarchique puis de la Direction du Capital Humain.\n\nLa demande est déposée au moins quinze jours avant la date souhaitée, sauf urgence dûment justifiée.",
        },
        {
          number: 7,
          sectionNumber: 2,
          title: 'Absence imprévue',
          body: "L'employé empêché de se présenter à son poste prévient son supérieur dans les meilleurs délais et transmet, le cas échéant, le justificatif médical dans les quarante-huit heures.",
        },
      ],
    },
    {
      number: 3,
      title: 'Hygiène et sécurité',
      body: null,
      sections: [],
      articles: [
        {
          number: 8,
          title: 'Obligations générales',
          body: "Chacun veille à sa propre sécurité et à celle des personnes concernées par ses actes. Les consignes de sécurité affichées dans les locaux sont d'application obligatoire.",
        },
        {
          number: 9,
          title: 'Accident du travail',
          body: 'Tout accident, même bénin, est déclaré sans délai au supérieur hiérarchique et à la Direction du Capital Humain.',
        },
        {
          number: 10,
          title: 'Interdiction de fumer',
          body: "Il est interdit de fumer dans l'ensemble des locaux fermés de l'agence, conformément à la réglementation en vigueur.",
        },
      ],
    },
    {
      number: 4,
      title: 'Usage des moyens de travail',
      body: null,
      sections: [],
      articles: [
        {
          number: 11,
          title: 'Matériel et systèmes d’information',
          body: "Le matériel mis à disposition est destiné à un usage professionnel. Un usage personnel raisonnable est toléré dès lors qu'il ne nuit ni au service ni à la sécurité des systèmes.",
        },
        {
          number: 12,
          title: 'Confidentialité',
          body: "L'employé s'abstient de divulguer toute information dont il a connaissance à raison de ses fonctions, pendant l'exécution de son contrat comme après sa cessation.\n\nCette obligation s'étend notamment :\n\n- aux données à caractère personnel des agents et des usagers ;\n- aux dossiers d'investissement et aux échanges avec les partenaires ;\n- aux documents internes non publiés.",
        },
      ],
    },
    {
      number: 5,
      title: 'Discipline',
      body: 'Les sanctions énumérées ci-après sont les seules applicables. Aucune sanction pécuniaire ne peut être prononcée.',
      sections: [],
      articles: [
        {
          number: 13,
          title: 'Échelle des sanctions',
          body: "Selon la gravité des faits :\n\n- l'avertissement écrit ;\n- le blâme ;\n- la mise à pied disciplinaire, d'une durée maximale de huit jours ;\n- le licenciement.",
        },
        {
          number: 14,
          title: 'Droits de la défense',
          body: "Aucune sanction autre que l'avertissement ne peut être prononcée sans que l'employé ait été informé des faits qui lui sont reprochés et mis en mesure de présenter ses explications.",
        },
        {
          number: 15,
          title: 'Prescription',
          body: "Aucun fait fautif ne peut donner lieu à une sanction au-delà de deux mois à compter du jour où l'employeur en a eu connaissance.",
        },
      ],
    },
  ],
};

export const CODE_DU_TRAVAIL = {
  title: 'Code du travail',
  reference:
    'Loi n° 97-17 du 1er décembre 1997 — extrait de démonstration, à remplacer par le texte officiel',
  effectiveOn: '1997-12-01',
  published: true,
  chapters: [
    {
      number: 1,
      title: 'Le contrat de travail',
      body: "Le contrat de travail est la convention par laquelle une personne s'engage à mettre son activité professionnelle sous l'autorité et la direction d'une autre personne, moyennant rémunération.",
      sections: [
        { number: 1, title: 'Formation du contrat', body: null },
        { number: 2, title: 'Rupture du contrat', body: null },
      ],
      articles: [
        {
          number: 1,
          sectionNumber: 1,
          title: 'Liberté de la forme',
          body: "Le contrat de travail est passé dans les formes qu'il convient aux parties d'adopter. Le contrat à durée déterminée, lui, est constaté par écrit.",
        },
        {
          number: 2,
          sectionNumber: 1,
          title: "Période d'essai",
          body: "La période d'essai doit être stipulée par écrit. Elle permet à chacune des parties de rompre le contrat sans préavis ni indemnité.",
        },
        {
          number: 3,
          sectionNumber: 2,
          title: 'Préavis',
          body: "La rupture d'un contrat à durée indéterminée est subordonnée à un préavis, dont la durée varie selon la catégorie professionnelle et l'ancienneté de l'employé.",
        },
        {
          number: 4,
          sectionNumber: 2,
          title: 'Certificat de travail',
          body: "À l'expiration du contrat, l'employeur délivre à l'employé un certificat mentionnant exclusivement la date d'entrée, celle de sortie et la nature des emplois occupés.",
        },
      ],
    },
    {
      number: 2,
      title: 'Durée du travail',
      body: null,
      sections: [],
      articles: [
        {
          number: 5,
          title: 'Durée légale',
          body: 'Dans les établissements non agricoles, la durée légale du travail des employés est de quarante heures par semaine.',
        },
        {
          number: 6,
          title: 'Heures supplémentaires',
          body: 'Les heures effectuées au-delà de la durée légale ouvrent droit à une majoration de salaire, dans les conditions fixées par voie réglementaire.',
        },
        {
          number: 7,
          title: 'Repos hebdomadaire',
          body: "Le repos hebdomadaire est obligatoire. Il est d'au moins vingt-quatre heures consécutives par semaine.",
        },
      ],
    },
    {
      number: 3,
      title: 'Congés et jours fériés',
      body: null,
      sections: [],
      articles: [
        {
          number: 8,
          title: 'Droit au congé payé',
          body: "L'employé acquiert un droit au congé payé à la charge de l'employeur, à raison de deux jours ouvrables par mois de service effectif.",
        },
        {
          number: 9,
          title: 'Jours fériés',
          body: "Les jours fériés sont fixés par la réglementation. Les fêtes religieuses mobiles sont arrêtées chaque année par l'autorité compétente.",
        },
        {
          number: 10,
          title: 'Congé de maternité',
          body: 'La femme salariée a droit à un congé de maternité, pendant lequel le contrat de travail est suspendu et ne peut être rompu du fait de cet état.',
        },
      ],
    },
    {
      number: 4,
      title: 'Hygiène, sécurité et santé au travail',
      body: null,
      sections: [],
      articles: [
        {
          number: 11,
          title: 'Obligation de l’employeur',
          body: "L'employeur prend toutes les mesures utiles pour assurer la sécurité et protéger la santé physique et mentale des employés.",
        },
        {
          number: 12,
          title: 'Accident du travail',
          body: "Est considéré comme accident du travail l'accident survenu par le fait ou à l'occasion du travail, quelle qu'en soit la cause.",
        },
      ],
    },
  ],
};
