'use client';

import { Input, Select } from '@teranga/ui';
import { COUNTRIES } from '../lib/countries';

/**
 * Saisie de téléphone : on choisit le pays, on tape le numéro local.
 *
 * L'indicatif est dit UNE fois, par la liste des pays. Le répéter en tête du
 * champ le rendait deux fois à l'écran et volait cinquante pixels de saisie —
 * ce qui, dans une fenêtre à deux colonnes, ne laissait plus la place de lire
 * son propre numéro. La valeur envoyée à l'API se compose avec
 * composePhone(country, local).
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
        className="w-36 shrink-0"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} (+{c.dial})
          </option>
        ))}
      </Select>
      <Input
        id={id}
        type="tel"
        autoComplete="tel-national"
        className="min-w-0 flex-1"
        placeholder={placeholder}
        value={local}
        onChange={(e) => onLocalChange(e.target.value)}
      />
    </div>
  );
}
