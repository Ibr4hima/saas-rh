import { crc32 } from 'node:zlib';

/* ————————————————————————————————————————————————————————————————
   Fabrique de classeurs .xlsx, pour les tests.

   Un .xlsx est une archive zip : on la construit ici octet par octet plutôt
   que de joindre un fichier au dépôt. Un fichier joint ne dirait plus rien le
   jour où quelqu'un le régénère avec un autre tableur ; en le fabriquant, on
   CHOISIT ce qu'on éprouve — une chaîne en ligne, une date au format
   personnalisé, une cellule absente au milieu d'une ligne, une cible de
   relation absolue.

   Partagée entre les tests du lecteur et de la traduction
   (`import-employes.spec.ts`) et ceux du service qui écrit en base
   (`import-service.spec.ts`).
   ———————————————————————————————————————————————————————————————— */

/** Une entrée d'archive, en STORED : le test n'éprouve pas la compression. */
export function entreeZip(nom: string, contenu: string) {
  const data = Buffer.from(contenu, 'utf8');
  const nomBuf = Buffer.from(nom, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nomBuf.length, 26);
  return { nom: nomBuf, data, crc, entete: Buffer.concat([local, nomBuf, data]) };
}

export function fabriquerXlsx(pieces: Record<string, string>): Buffer {
  const morceaux: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [nom, contenu] of Object.entries(pieces)) {
    const e = entreeZip(nom, contenu);
    morceaux.push(e.entete);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(e.data.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(e.nom.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, e.nom]));
    offset += e.entete.length;
  }
  const repertoire = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(repertoire.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...morceaux, repertoire, eocd]);
}

export const WORKBOOK = `<workbook xmlns:r="x"><sheets><sheet name="Employés" sheetId="1" r:id="rId1"/></sheets></workbook>`;
/** Cible ABSOLUE, comme l'écrivent certains générateurs — et comme le
    classeur réel de la RH, sur lequel exceljs échouait. */
export const RELS = `<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>`;
export const STYLES = `<styleSheet><numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="165"/><xf numFmtId="14"/></cellXfs></styleSheet>`;

export function classeur(feuille: string, pieces: Record<string, string> = {}): Buffer {
  return fabriquerXlsx({
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': `<worksheet>${feuille}</worksheet>`,
    ...pieces,
  });
}
