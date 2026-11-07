-- Les documents se confient type par type.
--
-- Décision APIX : le directeur du Capital Humain confie les attestations de
-- travail à l'un, les bulletins de salaire à l'autre. Une demande qui
-- regroupait plusieurs documents ne pourrait aller à personne : chaque
-- document demandé devient donc une demande à part, qui va à qui traite ce
-- type-là.

-- ——— Les demandes encore ouvertes qui regroupaient plusieurs documents se
-- séparent : le premier document garde la demande, les suivants en
-- reçoivent une chacun, à l'identique. Les demandes closes restent telles
-- qu'elles ont été traitées.
INSERT INTO document_requests (
  id, tenant_id, employee_id, doc_types, note, status, requested_by_user_id,
  handled_by_user_id, pickup_contact, hr_message, processing_at, ready_at, delivered_at,
  created_at, updated_at, confiee_a_employee_id
)
SELECT gen_random_uuid(), r.tenant_id, r.employee_id, ARRAY[d.doc], r.note, r.status,
       r.requested_by_user_id, r.handled_by_user_id, r.pickup_contact, r.hr_message,
       r.processing_at, r.ready_at, r.delivered_at, r.created_at, r.updated_at,
       r.confiee_a_employee_id
  FROM document_requests r
 CROSS JOIN LATERAL unnest(r.doc_types) WITH ORDINALITY AS d(doc, rang)
 WHERE r.status IN ('received', 'processing')
   AND cardinality(r.doc_types) > 1
   AND d.rang > 1;

UPDATE document_requests SET doc_types = ARRAY[doc_types[1]]
 WHERE status IN ('received', 'processing') AND cardinality(doc_types) > 1;

-- ——— Qui traitait « les documents » traite désormais chaque type de
-- document : rien ne change pour lui, et le directeur affine s'il le veut.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id, created_at)
SELECT gen_random_uuid(), h.tenant_id, 'demandes.documents.' || d.doc, h.employee_id,
       h.accordee_par_employee_id, h.created_at
  FROM habilitations h
 CROSS JOIN unnest(ARRAY['contrat_travail', 'bulletin_salaire', 'attestation_salaire',
                         'certificat_travail', 'autre']) AS d(doc)
 WHERE h.capacite = 'demandes.documents' AND h.fin_at IS NULL;

UPDATE habilitations SET capacite = 'demandes.documents.attestation_travail'
 WHERE capacite = 'demandes.documents' AND fin_at IS NULL;
