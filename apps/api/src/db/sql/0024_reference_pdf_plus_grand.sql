-- Le fichier officiel d'un code n'est pas une pièce jointe de dossier.
--
-- Le plafond de quinze mégaoctets était calqué sur les justificatifs
-- d'absence. Un Journal officiel numérisé — trois cents pages d'images — en
-- fait quatre fois plus, et c'est le SEUL exemplaire qui fasse foi : le
-- rogner reviendrait à déposer autre chose que le texte.
--
-- Quatre-vingts mégaoctets, donc, et pas davantage : au-delà, le fichier ne
-- rend plus service à qui le télécharge depuis Dakar.
SET lock_timeout = '5s';

ALTER TABLE reference_texts DROP CONSTRAINT IF EXISTS reference_texts_pdf_size_check;
ALTER TABLE reference_texts
  ADD CONSTRAINT reference_texts_pdf_size_check
  CHECK (pdf_size IS NULL OR (pdf_size > 0 AND pdf_size <= 83886080));
