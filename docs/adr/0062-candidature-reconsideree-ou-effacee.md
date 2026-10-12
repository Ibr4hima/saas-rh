# ADR-0062 : Une candidature non retenue se reconsidère, ou s'efface définitivement

**Statut** : acceptée · 2026-10-12

## Contexte

Depuis 0029, une candidature rejetée ne se rouvrait plus, et la page
« Candidatures non retenues » (0030) n'offrait que « Consulter ». Un rejet
fait par erreur ne se rattrapait pas, et un dossier dont on n'a plus l'usage
ne s'effaçait pas : seule une route de l'API, que le site n'appelait pas,
supprimait une candidature, à n'importe quelle étape, sans emporter ses
courriels.

## Décision

**Les non retenues se cochent**, comme les offres : la sélection porte sur
la page affichée. Deux gestes : « Reconsidérer » et « Supprimer ». Des
lignes cochées, la barre de sélection prend la place de la recherche, qui
revient telle quelle : les deux sur la ligne du titre débordaient à
1280 px.

**Reconsidérer rend la candidature à son offre**, à l'étape où elle était
avant le rejet. Le journal la garde (0079 conserve l'étape) ; à défaut, elle
revient « reçue ». Le refus qui n'est pas encore parti est annulé. Pas de
confirmation : le geste se défait en rejetant de nouveau.

**Une seule réponse, toujours.** Reconsidérée après le départ du refus puis
rejetée de nouveau, la candidature ne vaut pas un second courriel de refus,
et la fenêtre « Rejeter » le dit (« … a déjà reçu un courriel de refus :
aucun autre ne partira »). Un refus annulé avant son départ ne compte pas :
le nouveau rejet en met un en file.

**Supprimer efface partout**, après une confirmation qui nomme les dossiers :
la candidature, ses pièces, les courriels qui en parlaient (accusé de
réception, refus) et le contenu que le journal d'audit en gardait
(`erase_audit_payload`, pour la candidature et chacune de ses pièces). Le
journal garde la trace des gestes. L'adresse se libère : la même personne
peut postuler de nouveau à l'offre. Le journal des consultations
(`application_access_log`) demeure : il ne porte que des identifiants et des
horodatages, rien de la personne, et il est en ajout seul.

**Seules les non retenues** se reconsidèrent ou s'effacent. Une candidature
reconsidérée entre-temps par quelqu'un d'autre est laissée telle quelle,
sans faire échouer le lot. `POST /applications/reconsider` et
`POST /applications/delete` prennent un lot, même d'une seule ; la route
unitaire `DELETE /applications/:id` disparaît. Comme la liste, ils
demandent l'habilitation « Dossiers de candidature ».

**L'étape d'une candidature rejetée** ne change toujours pas par
`PATCH /applications/:id` (409) : elle se reconsidère.

## Conséquences

- Précise ADR-0029 : « ne se rouvre plus » devient « se reconsidère » ; une
  seule réponse demeure.
- Reconsidérer n'écrit rien : un refus déjà parti reste reçu, et c'est à la
  RH de reprendre contact si elle le souhaite.
- Supprimer est sans retour : il n'y a pas de corbeille.
- Vidée par un geste, la page garde son entrée au menu tant qu'on y reste ;
  la page quittée, l'entrée disparaît, comme le veut 0030.
