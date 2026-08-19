'use client';

import { Input, Select } from '@teranga/ui';
import { COUNTRIES, countryByCode } from '../lib/countries';

/**
 * Saisie de téléphone : pays → indicatif affiché dans le champ, numéro local.
 * La valeur envoyée à l'API se compose avec composePhone(country, local).
 */
export function PhoneInput({
  id,
  country,
  local,
  onCountryChange,
  onLocalChange,
  placeholder = '77 123 45 67',
}: {
  id: string;
  country: string;
  local: string;
  onCountryChange: (code: string) => void;
  onLocalChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex gap-2">
      <Select
        aria-label="Pays de l'indicatif"
        value={country}
        onChange={(e) => onCountryChange(e.target.value)}
        className="w-40 shrink-0"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} (+{c.dial})
          </option>
        ))}
      </Select>
      <div className="relative flex-1">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted">
          +{countryByCode(country)?.dial}
        </span>
        <Input
          id={id}
          type="tel"
          className="pl-14"
          placeholder={placeholder}
          value={local}
          onChange={(e) => onLocalChange(e.target.value)}
        />
      </div>
    </div>
  );
}
