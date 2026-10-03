'use client';

import { cn, Select } from '@teranga/ui';
import { COUNTRIES_BY_ISO3, countryByCode, examplePhone, formatAsYouType } from '../lib/countries';

/**
 * Saisie de téléphone : on choisit le pays, on tape le numéro local.
 *
 * DEUX CHAMPS, DEUX RÔLES. À gauche, le pays — et seulement son code alpha-3,
 * « SEN ». Le nom complet suivi de l'indicatif ne tenait pas dans la colonne
 * d'une fenêtre à deux colonnes : « Sénégal (+2… » était coupé au milieu de
 * son propre indicatif, c'est-à-dire à l'endroit exact où il fallait le lire.
 * Trois lettres tiennent toujours.
 *
 * À droite, l'indicatif est ÉCRIT devant le champ, en dur. Il n'est ni à
 * saisir ni à effacer : il découle du pays choisi. On le met là parce qu'un
 * numéro se lit en entier — « +221 77 123 45 67 » — et qu'un indicatif rangé
 * dans une liste, à gauche, ne se lit plus avec le numéro qu'il complète.
 *
 * LA MISE EN FORME SUIT LE PAYS. Le numéro s'espace, se parenthèse ou se
 * tirete au fil de la frappe selon le plan de numérotation : « 77 123 45 67 »
 * à Dakar, « (201) 555-0123 » à New York, « (11) 96123-4567 » à São Paulo.
 * Le placeholder est un vrai numéro d'exemple du pays — proposer un format
 * sénégalais à qui saisit un numéro brésilien lui dit de mal faire.
 */
export function PhoneInput({
  id,
  country,
  local,
  onCountryChange,
  onLocalChange,
  disabled,
}: {
  id: string;
  country: string;
  local: string;
  onCountryChange: (code: string) => void;
  onLocalChange: (value: string) => void;
  disabled?: boolean;
}) {
  const pays = countryByCode(country);
  return (
    <div className="flex gap-2">
      <Select
        aria-label="Pays de l'indicatif"
        value={country}
        onChange={(e) => onCountryChange(e.target.value)}
        disabled={disabled}
        className="w-[104px] shrink-0 px-3.5"
      >
        {COUNTRIES_BY_ISO3.map((c) => (
          // La liste dit « SEN · +221 », le bouton refermé dit « SEN ». C'est
          // exactement ce à quoi sert l'attribut `label` d'une `<option>`.
          <option key={c.code} value={c.code} label={c.iso3}>
            {c.iso3} · +{c.dial}
          </option>
        ))}
      </Select>

      {/* Le champ et son préfixe forment UN objet : la bordure et le halo de
          focus appartiennent à l'enveloppe, pas au champ qu'elle contient. */}
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center rounded-full border border-line bg-surface',
          'transition-colors duration-150 ease-out',
          'focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary/40',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          aria-hidden
          className="flex h-10 shrink-0 items-center pr-2.5 pl-4 text-sm font-medium text-ink-muted tabular-nums"
        >
          +{pays?.dial ?? ''}
        </span>
        <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          disabled={disabled}
          className="h-10 min-w-0 flex-1 rounded-r-full bg-transparent pr-4 pl-3 text-sm text-ink tabular-nums placeholder:text-ink-muted/70 focus:outline-none disabled:cursor-not-allowed"
          placeholder={examplePhone(country)}
          value={local}
          onChange={(e) => onLocalChange(formatAsYouType(country, e.target.value))}
        />
      </div>
    </div>
  );
}
