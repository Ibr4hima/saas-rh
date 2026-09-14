import {
  AsYouType,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import EXEMPLES from 'libphonenumber-js/examples.mobile.json';

/**
 * Pays du monde : codes ISO 3166-1 alpha-2 et alpha-3 + indicatifs E.164.
 * Les noms français sont générés par Intl.DisplayNames — pas de liste de
 * libellés à maintenir. Le pays de naissance est stocké par son NOM français
 * (lisible partout : fiche, attestation) ; le téléphone par « +indicatif numéro ».
 */

/** [alpha-2, alpha-3, indicatif] — indicatif sans le « + ». */
const DATA: Array<[string, string, string]> = [
  ['AF', 'AFG', '93'],
  ['ZA', 'ZAF', '27'],
  ['AL', 'ALB', '355'],
  ['DZ', 'DZA', '213'],
  ['DE', 'DEU', '49'],
  ['AD', 'AND', '376'],
  ['AO', 'AGO', '244'],
  ['AG', 'ATG', '1268'],
  ['SA', 'SAU', '966'],
  ['AR', 'ARG', '54'],
  ['AM', 'ARM', '374'],
  ['AU', 'AUS', '61'],
  ['AT', 'AUT', '43'],
  ['AZ', 'AZE', '994'],
  ['BS', 'BHS', '1242'],
  ['BH', 'BHR', '973'],
  ['BD', 'BGD', '880'],
  ['BB', 'BRB', '1246'],
  ['BE', 'BEL', '32'],
  ['BZ', 'BLZ', '501'],
  ['BJ', 'BEN', '229'],
  ['BT', 'BTN', '975'],
  ['BY', 'BLR', '375'],
  ['BO', 'BOL', '591'],
  ['BA', 'BIH', '387'],
  ['BW', 'BWA', '267'],
  ['BR', 'BRA', '55'],
  ['BN', 'BRN', '673'],
  ['BG', 'BGR', '359'],
  ['BF', 'BFA', '226'],
  ['BI', 'BDI', '257'],
  ['KH', 'KHM', '855'],
  ['CM', 'CMR', '237'],
  ['CA', 'CAN', '1'],
  ['CV', 'CPV', '238'],
  ['CL', 'CHL', '56'],
  ['CN', 'CHN', '86'],
  ['CY', 'CYP', '357'],
  ['CO', 'COL', '57'],
  ['KM', 'COM', '269'],
  ['CG', 'COG', '242'],
  ['CD', 'COD', '243'],
  ['KR', 'KOR', '82'],
  ['KP', 'PRK', '850'],
  ['CR', 'CRI', '506'],
  ['CI', 'CIV', '225'],
  ['HR', 'HRV', '385'],
  ['CU', 'CUB', '53'],
  ['DK', 'DNK', '45'],
  ['DJ', 'DJI', '253'],
  ['DM', 'DMA', '1767'],
  ['EG', 'EGY', '20'],
  ['AE', 'ARE', '971'],
  ['EC', 'ECU', '593'],
  ['ER', 'ERI', '291'],
  ['ES', 'ESP', '34'],
  ['EE', 'EST', '372'],
  ['SZ', 'SWZ', '268'],
  ['US', 'USA', '1'],
  ['ET', 'ETH', '251'],
  ['FJ', 'FJI', '679'],
  ['FI', 'FIN', '358'],
  ['FR', 'FRA', '33'],
  ['GA', 'GAB', '241'],
  ['GM', 'GMB', '220'],
  ['GE', 'GEO', '995'],
  ['GH', 'GHA', '233'],
  ['GR', 'GRC', '30'],
  ['GD', 'GRD', '1473'],
  ['GT', 'GTM', '502'],
  ['GN', 'GIN', '224'],
  ['GW', 'GNB', '245'],
  ['GQ', 'GNQ', '240'],
  ['GY', 'GUY', '592'],
  ['HT', 'HTI', '509'],
  ['HN', 'HND', '504'],
  ['HU', 'HUN', '36'],
  ['IN', 'IND', '91'],
  ['ID', 'IDN', '62'],
  ['IQ', 'IRQ', '964'],
  ['IR', 'IRN', '98'],
  ['IE', 'IRL', '353'],
  ['IS', 'ISL', '354'],
  ['IL', 'ISR', '972'],
  ['IT', 'ITA', '39'],
  ['JM', 'JAM', '1876'],
  ['JP', 'JPN', '81'],
  ['JO', 'JOR', '962'],
  ['KZ', 'KAZ', '7'],
  ['KE', 'KEN', '254'],
  ['KG', 'KGZ', '996'],
  ['KI', 'KIR', '686'],
  ['KW', 'KWT', '965'],
  ['LA', 'LAO', '856'],
  ['LS', 'LSO', '266'],
  ['LV', 'LVA', '371'],
  ['LB', 'LBN', '961'],
  ['LR', 'LBR', '231'],
  ['LY', 'LBY', '218'],
  ['LI', 'LIE', '423'],
  ['LT', 'LTU', '370'],
  ['LU', 'LUX', '352'],
  ['MK', 'MKD', '389'],
  ['MG', 'MDG', '261'],
  ['MY', 'MYS', '60'],
  ['MW', 'MWI', '265'],
  ['MV', 'MDV', '960'],
  ['ML', 'MLI', '223'],
  ['MT', 'MLT', '356'],
  ['MA', 'MAR', '212'],
  ['MH', 'MHL', '692'],
  ['MU', 'MUS', '230'],
  ['MR', 'MRT', '222'],
  ['MX', 'MEX', '52'],
  ['FM', 'FSM', '691'],
  ['MD', 'MDA', '373'],
  ['MC', 'MCO', '377'],
  ['MN', 'MNG', '976'],
  ['ME', 'MNE', '382'],
  ['MZ', 'MOZ', '258'],
  ['MM', 'MMR', '95'],
  ['NA', 'NAM', '264'],
  ['NR', 'NRU', '674'],
  ['NP', 'NPL', '977'],
  ['NI', 'NIC', '505'],
  ['NE', 'NER', '227'],
  ['NG', 'NGA', '234'],
  ['NO', 'NOR', '47'],
  ['NZ', 'NZL', '64'],
  ['OM', 'OMN', '968'],
  ['UG', 'UGA', '256'],
  ['UZ', 'UZB', '998'],
  ['PK', 'PAK', '92'],
  ['PW', 'PLW', '680'],
  ['PS', 'PSE', '970'],
  ['PA', 'PAN', '507'],
  ['PG', 'PNG', '675'],
  ['PY', 'PRY', '595'],
  ['NL', 'NLD', '31'],
  ['PE', 'PER', '51'],
  ['PH', 'PHL', '63'],
  ['PL', 'POL', '48'],
  ['PT', 'PRT', '351'],
  ['QA', 'QAT', '974'],
  ['CF', 'CAF', '236'],
  ['DO', 'DOM', '1809'],
  ['CZ', 'CZE', '420'],
  ['RO', 'ROU', '40'],
  ['GB', 'GBR', '44'],
  ['RU', 'RUS', '7'],
  ['RW', 'RWA', '250'],
  ['KN', 'KNA', '1869'],
  ['SM', 'SMR', '378'],
  ['VC', 'VCT', '1784'],
  ['LC', 'LCA', '1758'],
  ['SB', 'SLB', '677'],
  ['WS', 'WSM', '685'],
  ['ST', 'STP', '239'],
  ['SN', 'SEN', '221'],
  ['RS', 'SRB', '381'],
  ['SC', 'SYC', '248'],
  ['SL', 'SLE', '232'],
  ['SG', 'SGP', '65'],
  ['SK', 'SVK', '421'],
  ['SI', 'SVN', '386'],
  ['SO', 'SOM', '252'],
  ['SD', 'SDN', '249'],
  ['SS', 'SSD', '211'],
  ['LK', 'LKA', '94'],
  ['SE', 'SWE', '46'],
  ['CH', 'CHE', '41'],
  ['SR', 'SUR', '597'],
  ['SY', 'SYR', '963'],
  ['TJ', 'TJK', '992'],
  ['TZ', 'TZA', '255'],
  ['TD', 'TCD', '235'],
  ['TH', 'THA', '66'],
  ['TL', 'TLS', '670'],
  ['TG', 'TGO', '228'],
  ['TO', 'TON', '676'],
  ['TT', 'TTO', '1868'],
  ['TN', 'TUN', '216'],
  ['TM', 'TKM', '993'],
  ['TR', 'TUR', '90'],
  ['TV', 'TUV', '688'],
  ['UA', 'UKR', '380'],
  ['UY', 'URY', '598'],
  ['VU', 'VUT', '678'],
  ['VE', 'VEN', '58'],
  ['VN', 'VNM', '84'],
  ['YE', 'YEM', '967'],
  ['ZM', 'ZMB', '260'],
  ['ZW', 'ZWE', '263'],
];

const displayNames = new Intl.DisplayNames(['fr'], { type: 'region' });
const collator = new Intl.Collator('fr');

export interface Country {
  /** ISO 3166-1 alpha-2 — la clé de stockage, et celle de libphonenumber. */
  code: string;
  /** ISO 3166-1 alpha-3 — ce qu'affiche le sélecteur d'indicatif : « SEN ». */
  iso3: string;
  name: string;
  dial: string;
}

/** Tous les pays, triés par nom français. */
export const COUNTRIES: Country[] = DATA.map(([code, iso3, dial]) => ({
  code,
  iso3,
  name: displayNames.of(code) ?? code,
  dial,
})).sort((a, b) => collator.compare(a.name, b.name));

/**
 * Les mêmes, rangés par code alpha-3.
 *
 * Le sélecteur d'indicatif n'affiche pas les noms de pays mais « SEN · +221 » :
 * une liste de codes rangée par nom FRANÇAIS paraîtrait mélangée au hasard.
 * Rangée par code, elle se parcourt comme un index — et la frappe au vol de la
 * liste de choix, qui cherche dans le libellé, mène droit à « SEN ».
 */
export const COUNTRIES_BY_ISO3: Country[] = [...COUNTRIES].sort((a, b) =>
  a.iso3.localeCompare(b.iso3),
);

export const DEFAULT_COUNTRY = 'SN';

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/**
 * Compose un numéro complet « +221771234567 » à partir du pays et du numéro
 * tel qu'on le compose SUR PLACE.
 *
 * On délègue la conversion à libphonenumber plutôt que de coller l'indicatif
 * devant les chiffres : le zéro de tête est un préfixe interurbain qui se
 * retire en France (06 12… → +33 6 12…) mais se GARDE en Italie
 * (06 6982… → +39 06 6982…). La règle est par pays, et elle est déjà écrite.
 *
 * Un numéro incomplet — on enregistre parfois une fiche à moitié saisie —
 * n'est pas reconnu : on retombe alors sur la composition naïve, qui vaut
 * mieux que perdre ce qui a été tapé.
 */
export function composePhone(countryCode: string, local: string): string | undefined {
  const digits = local.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const analyse = parsePhoneNumberFromString(local, countryCode as CountryCode);
  if (analyse) return analyse.number;
  const dial = countryByCode(countryCode)?.dial ?? '';
  return `+${dial}${digits.replace(/^0+/, '')}`;
}

/**
 * Décompose un numéro stocké en (pays, numéro local).
 *
 * Le numéro local revient MIS EN FORME, dans la convention du pays — « 06 12
 * 34 56 78 » et non « 612345678 » : c'est ce que le champ doit afficher, et
 * c'est aussi ce que la frappe au vol reproduira si on le retape.
 */
export function splitPhone(stored: string | null | undefined): { country: string; local: string } {
  if (!stored) return { country: DEFAULT_COUNTRY, local: '' };
  const analyse = stored.startsWith('+') ? parsePhoneNumberFromString(stored) : undefined;
  if (analyse?.country) return { country: analyse.country, local: analyse.formatNational() };
  if (!stored.startsWith('+')) return { country: DEFAULT_COUNTRY, local: stored };
  // Indicatif reconnu mais pays indécidable (+1 en couvre vingt) : on prend le
  // plus long indicatif qui corresponde.
  const raw = stored.slice(1);
  let best: Country | undefined;
  for (const c of COUNTRIES) {
    if (raw.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  if (!best) return { country: DEFAULT_COUNTRY, local: stored };
  return { country: best.code, local: raw.slice(best.dial.length) };
}

/**
 * Un numéro d'exemple pour le pays, dans sa forme nationale : « 70 123 45 67 »
 * au Sénégal, « (201) 555-0123 » aux États-Unis. C'est le seul placeholder
 * honnête — un format sénégalais proposé à qui saisit un numéro brésilien lui
 * dit de mal faire.
 */
export function examplePhone(countryCode: string): string {
  try {
    return getExampleNumber(countryCode as CountryCode, EXEMPLES)?.formatNational() ?? '';
  } catch {
    return '';
  }
}

/** Met en forme au fil de la frappe, selon le plan de numérotation du pays. */
export function formatAsYouType(countryCode: string, saisie: string): string {
  const f = new AsYouType(countryCode as CountryCode);
  return f.input(saisie);
}
