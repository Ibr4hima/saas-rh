'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ImportReport } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';

const TEMPLATE = `matricule;prenom;nom;date_embauche;email_pro;telephone;poste;type_contrat;date_debut_contrat
EMP-001;Awa;Diop;2024-01-15;a.diop@exemple.sn;771234567;Chargée d'études;cdi;2024-01-15
EMP-002;Moussa;Ndiaye;2023-06-01;m.ndiaye@exemple.sn;779876543;Comptable;cdd;2023-06-01`;

export default function ImportPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api<ImportReport>('/employees/import', { method: 'POST', body: { content, dryRun } }),
    onSuccess: (r) => {
      setReport(r);
      setServerError(null);
      if (!r.dryRun && r.importedRows > 0) {
        void queryClient.invalidateQueries({ queryKey: ['employees'] });
      }
    },
    onError: (err) => setServerError(err instanceof ApiError ? err.message : 'Import impossible.'),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setContent(await file.text());
    setReport(null);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-xl font-bold text-ink-strong">Importer des employés</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Fichier CSV (séparateur ; ou ,). Colonnes obligatoires : matricule, prenom, nom,
        date_embauche (AAAA-MM-JJ). La vérification ne modifie rien : vous validez avant
        d&apos;importer.
      </p>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>1 · Choisir le fichier</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              Sélectionner un CSV…
            </Button>
            {fileName ? <span className="text-sm text-ink">{fileName}</span> : null}
            <button
              type="button"
              className="ml-auto text-sm text-primary hover:underline"
              onClick={() => {
                const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'gabarit-import-employes.csv';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Télécharger le gabarit
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Vérifier puis importer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex gap-3">
              <Button
                variant="secondary"
                disabled={!content}
                loading={run.isPending && run.variables === true}
                onClick={() => run.mutate(true)}
              >
                Vérifier (sans importer)
              </Button>
              <Button
                disabled={!content || !report || report.dryRun === false || report.validRows === 0}
                loading={run.isPending && run.variables === false}
                onClick={() => run.mutate(false)}
              >
                Importer{' '}
                {report?.dryRun
                  ? `${report.validRows} ligne${report.validRows > 1 ? 's' : ''}`
                  : ''}
              </Button>
            </div>

            {serverError ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {serverError}
              </p>
            ) : null}

            {report ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">{report.totalRows} lignes lues</Badge>
                  <Badge tone={report.validRows > 0 ? 'success' : 'neutral'}>
                    {report.validRows} valides
                  </Badge>
                  <Badge tone={report.errors.length > 0 ? 'danger' : 'success'}>
                    {report.errors.length} erreur{report.errors.length > 1 ? 's' : ''}
                  </Badge>
                  {!report.dryRun ? (
                    <Badge tone="primary">{report.importedRows} importées ✓</Badge>
                  ) : null}
                </div>

                {report.errors.length > 0 ? (
                  <Table>
                    <THead>
                      <tr>
                        <Th className="w-20">Ligne</Th>
                        <Th className="w-40">Champ</Th>
                        <Th>Problème</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {report.errors.map((err, i) => (
                        <Tr key={i}>
                          <Td className="font-mono text-xs">{err.line}</Td>
                          <Td className="font-mono text-xs">{err.field}</Td>
                          <Td>{err.message}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
