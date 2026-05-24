import { Session } from 'electron';

/**
 * Apply user spellchecker settings to a given session.
 *
 * Electron uses Chromium's spellchecker. Setting languages causes the
 * runtime to download the relevant Hunspell dictionaries on demand
 * (silent, cached under the user-data dir). The empty-list case
 * effectively disables spell-check.
 *
 * Falls back gracefully if a requested language isn't one of
 * `session.availableSpellCheckerLanguages` — Chromium would otherwise
 * throw and break the whole call.
 */
export function applySpellcheckToSession(
  session: Session,
  languages: string[]
): void {
  const available = new Set(session.availableSpellCheckerLanguages);
  const filtered = languages.filter((l) => available.has(l));
  // setSpellCheckerLanguages accepts an empty array as "off".
  session.setSpellCheckerLanguages(filtered);
}
