/**
 * Les banques que la DCH propose pour une domiciliation bancaire (ADR-0102),
 * dans l'ordre où elle les a données. Une lettre les nomme selon l'usage :
 * avec l'article (« la CBAO », « de la BNDE »), sans article (« Ecobank »,
 * « d'Orabank »), ou l'article pris dans le nom (« La Banque Agricole »).
 */
export const BANQUES = [
  { code: 'afrika_banque', nom: 'Afrika Banque Sénégal', article: '' },
  { code: 'bci', nom: 'BCI Sénégal', article: 'la ' },
  { code: 'bgfibank', nom: 'BGFIBank Sénégal', article: '' },
  { code: 'bimao', nom: 'BIMAO', article: 'la ' },
  { code: 'bnde', nom: 'BNDE', article: 'la ' },
  { code: 'boa', nom: 'BOA', article: 'la ' },
  { code: 'bsic', nom: 'BSIC', article: 'la ' },
  { code: 'banque_atlantique', nom: 'Banque Atlantique', article: 'la ' },
  { code: 'banque_islamique', nom: 'Banque Islamique du Sénégal', article: 'la ' },
  { code: 'banque_habitat', nom: 'Banque de l’Habitat du Sénégal', article: 'la ' },
  { code: 'bridge_bank', nom: 'Bridge Bank', article: '' },
  { code: 'cbao', nom: 'CBAO', article: 'la ' },
  { code: 'coris_bank', nom: 'Coris Bank', article: '' },
  { code: 'ecobank', nom: 'Ecobank', article: '' },
  { code: 'fbnbank', nom: 'FBNBank', article: '' },
  { code: 'banque_agricole', nom: 'La Banque Agricole', article: '' },
  { code: 'banque_outarde', nom: 'La Banque Outarde', article: '' },
  { code: 'orabank', nom: 'Orabank', article: '' },
  { code: 'sunu_bank', nom: 'SUNU Bank', article: '' },
  { code: 'uba', nom: 'UBA', article: '' },
] as const;

export type Banque = (typeof BANQUES)[number];
export type CodeDeBanque = Banque['code'];

export const CODES_DES_BANQUES = BANQUES.map((b) => b.code) as [CodeDeBanque, ...CodeDeBanque[]];

/** La banque d'un code de la liste. */
export const banqueDe = (code: CodeDeBanque): Banque => BANQUES.find((b) => b.code === code)!;
