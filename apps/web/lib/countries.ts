/**
 * Pays du monde : codes ISO 3166-1 alpha-2 + indicatifs téléphoniques E.164.
 * Les noms français sont générés par Intl.DisplayNames — pas de liste de
 * libellés à maintenir. Le pays de naissance est stocké par son NOM français
 * (lisible partout : fiche, attestation) ; le téléphone par « +indicatif numéro ».
 */

/** [code ISO, indicatif] — indicatif sans le « + ». */
const DATA: Array<[string, string]> = [
  ['AF', '93'],
  ['ZA', '27'],
  ['AL', '355'],
  ['DZ', '213'],
  ['DE', '49'],
  ['AD', '376'],
  ['AO', '244'],
  ['AG', '1268'],
  ['SA', '966'],
  ['AR', '54'],
  ['AM', '374'],
  ['AU', '61'],
  ['AT', '43'],
  ['AZ', '994'],
  ['BS', '1242'],
  ['BH', '973'],
  ['BD', '880'],
  ['BB', '1246'],
  ['BE', '32'],
  ['BZ', '501'],
  ['BJ', '229'],
  ['BT', '975'],
  ['BY', '375'],
  ['BO', '591'],
  ['BA', '387'],
  ['BW', '267'],
  ['BR', '55'],
  ['BN', '673'],
  ['BG', '359'],
  ['BF', '226'],
  ['BI', '257'],
  ['KH', '855'],
  ['CM', '237'],
  ['CA', '1'],
  ['CV', '238'],
  ['CL', '56'],
  ['CN', '86'],
  ['CY', '357'],
  ['CO', '57'],
  ['KM', '269'],
  ['CG', '242'],
  ['CD', '243'],
  ['KR', '82'],
  ['KP', '850'],
  ['CR', '506'],
  ['CI', '225'],
  ['HR', '385'],
  ['CU', '53'],
  ['DK', '45'],
  ['DJ', '253'],
  ['DM', '1767'],
  ['EG', '20'],
  ['AE', '971'],
  ['EC', '593'],
  ['ER', '291'],
  ['ES', '34'],
  ['EE', '372'],
  ['SZ', '268'],
  ['US', '1'],
  ['ET', '251'],
  ['FJ', '679'],
  ['FI', '358'],
  ['FR', '33'],
  ['GA', '241'],
  ['GM', '220'],
  ['GE', '995'],
  ['GH', '233'],
  ['GR', '30'],
  ['GD', '1473'],
  ['GT', '502'],
  ['GN', '224'],
  ['GW', '245'],
  ['GQ', '240'],
  ['GY', '592'],
  ['HT', '509'],
  ['HN', '504'],
  ['HU', '36'],
  ['IN', '91'],
  ['ID', '62'],
  ['IQ', '964'],
  ['IR', '98'],
  ['IE', '353'],
  ['IS', '354'],
  ['IL', '972'],
  ['IT', '39'],
  ['JM', '1876'],
  ['JP', '81'],
  ['JO', '962'],
  ['KZ', '7'],
  ['KE', '254'],
  ['KG', '996'],
  ['KI', '686'],
  ['KW', '965'],
  ['LA', '856'],
  ['LS', '266'],
  ['LV', '371'],
  ['LB', '961'],
  ['LR', '231'],
  ['LY', '218'],
  ['LI', '423'],
  ['LT', '370'],
  ['LU', '352'],
  ['MK', '389'],
  ['MG', '261'],
  ['MY', '60'],
  ['MW', '265'],
  ['MV', '960'],
  ['ML', '223'],
  ['MT', '356'],
  ['MA', '212'],
  ['MH', '692'],
  ['MU', '230'],
  ['MR', '222'],
  ['MX', '52'],
  ['FM', '691'],
  ['MD', '373'],
  ['MC', '377'],
  ['MN', '976'],
  ['ME', '382'],
  ['MZ', '258'],
  ['MM', '95'],
  ['NA', '264'],
  ['NR', '674'],
  ['NP', '977'],
  ['NI', '505'],
  ['NE', '227'],
  ['NG', '234'],
  ['NO', '47'],
  ['NZ', '64'],
  ['OM', '968'],
  ['UG', '256'],
  ['UZ', '998'],
  ['PK', '92'],
  ['PW', '680'],
  ['PS', '970'],
  ['PA', '507'],
  ['PG', '675'],
  ['PY', '595'],
  ['NL', '31'],
  ['PE', '51'],
  ['PH', '63'],
  ['PL', '48'],
  ['PT', '351'],
  ['QA', '974'],
  ['CF', '236'],
  ['DO', '1809'],
  ['CZ', '420'],
  ['RO', '40'],
  ['GB', '44'],
  ['RU', '7'],
  ['RW', '250'],
  ['KN', '1869'],
  ['SM', '378'],
  ['VC', '1784'],
  ['LC', '1758'],
  ['SB', '677'],
  ['WS', '685'],
  ['ST', '239'],
  ['SN', '221'],
  ['RS', '381'],
  ['SC', '248'],
  ['SL', '232'],
  ['SG', '65'],
  ['SK', '421'],
  ['SI', '386'],
  ['SO', '252'],
  ['SD', '249'],
  ['SS', '211'],
  ['LK', '94'],
  ['SE', '46'],
  ['CH', '41'],
  ['SR', '597'],
  ['SY', '963'],
  ['TJ', '992'],
  ['TZ', '255'],
  ['TD', '235'],
  ['TH', '66'],
  ['TL', '670'],
  ['TG', '228'],
  ['TO', '676'],
  ['TT', '1868'],
  ['TN', '216'],
  ['TM', '993'],
  ['TR', '90'],
  ['TV', '688'],
  ['UA', '380'],
  ['UY', '598'],
  ['VU', '678'],
  ['VE', '58'],
  ['VN', '84'],
  ['YE', '967'],
  ['ZM', '260'],
  ['ZW', '263'],
];

const displayNames = new Intl.DisplayNames(['fr'], { type: 'region' });
const collator = new Intl.Collator('fr');

export interface Country {
  code: string;
  name: string;
  dial: string;
}

/** Tous les pays, triés par nom français. */
export const COUNTRIES: Country[] = DATA.map(([code, dial]) => ({
  code,
  name: displayNames.of(code) ?? code,
  dial,
})).sort((a, b) => collator.compare(a.name, b.name));

export const DEFAULT_COUNTRY = 'SN';

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/** Compose un numéro complet « +221771234567 » à partir du pays + numéro local. */
export function composePhone(countryCode: string, local: string): string | undefined {
  const digits = local.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!digits) return undefined;
  const dial = countryByCode(countryCode)?.dial ?? '';
  return `+${dial}${digits}`;
}

/** Décompose un numéro stocké en (pays, numéro local) — meilleure correspondance. */
export function splitPhone(stored: string | null | undefined): { country: string; local: string } {
  if (!stored) return { country: DEFAULT_COUNTRY, local: '' };
  if (!stored.startsWith('+')) return { country: DEFAULT_COUNTRY, local: stored };
  const raw = stored.slice(1);
  let best: Country | undefined;
  for (const c of COUNTRIES) {
    if (raw.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  if (!best) return { country: DEFAULT_COUNTRY, local: stored };
  return { country: best.code, local: raw.slice(best.dial.length) };
}
