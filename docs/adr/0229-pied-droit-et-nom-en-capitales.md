# ADR-0229 : Le pied droit des écrans de la charte, et le nom de famille en capitales

**Statut** : acceptée · 2026-11-21 · révise les ADR [0187](0187-connexion-a-la-charte.md), [0188](0188-verification-a-la-charte.md), [0204](0204-connexion-par-code.md) et [0228](0228-bandeau-droit.md)

## Contexte

Au bas des écrans de connexion et de la vérification d'un certificat, la
scène de la charte posait une large bande bleue, courbe, soulignée d'orange
et parcourue d'ondulations, les droits écrits en blanc dessus (ADR-0187,
ADR-0188). L'APIX la trouve lourde et la veut droite, plus sobre.

Sur l'écran de connexion, le nom de famille se saisissait tel quel, et le
navigateur y proposait les noms déjà tapés sur le poste et ceux de ses
fiches (ADR-0204).

## Décision

**Le pied des écrans de la charte** devient droit et discret : un filet
gris en haut, les droits à gauche et la mention de droite (« Plateforme à
usage interne ») à droite, en gris, sur le fond de la page ; sur un
téléphone, l'une sous l'autre, au centre. Tout en bas, un liseré droit de
4 px, de l'orange au bleu, comme le dégradé de la couverture de la charte.
Les ondulations du coin restent.

**Le nom de famille** s'écrit en capitales, sans accents, au fil de la
frappe : « Sène » ou « SÈNE » donne SENE, « Touré » TOURE. Le curseur reste
où il était, et un accent tapé par touche morte n'est corrigé qu'une fois
la lettre composée. Le serveur comparait déjà les noms sans accents ni
casse : la reconnaissance du compte ne change pas.

**Le navigateur ne propose plus rien** dans ce champ : ni les noms déjà
saisis, ni ceux de ses fiches, ni ceux d'un gestionnaire de mots de passe.

## Conséquences

- Le pied change aussi sur les autres écrans d'avant le compte et sur la
  vérification d'un certificat : une seule scène les sert tous.
- Le bandeau de l'accueil de la campagne et l'écran de connexion n'ont plus
  de courbe ni l'un ni l'autre (ADR-0228). Le certificat d'APIX Academy et
  les courriels gardent la leur.
- Le champ de l'adresse professionnelle garde les propositions du
  navigateur.
