-- Les commentaires du N+2 sur la fiche d'entretien (ADR-0218) : ce que le
-- N+2 écrit dans la partie réservée à la hiérarchie, une fois la fiche
-- validée par l'agent ; qui les a écrits, et le moment de leur transmission
-- au N+1. Transmis sans un mot, le texte reste vide.
SET lock_timeout = '5s';

ALTER TABLE fiches_entretien
  ADD COLUMN commentaires_n2 text,
  ADD COLUMN commentaires_n2_par uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD COLUMN commentaires_n2_transmis_le timestamptz;
