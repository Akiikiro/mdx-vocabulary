const compatibilityOverrides: Readonly<Record<string, readonly string[]>> = {
  oxford8: ['/dictionaries/oxford8/overrides.css'],
};

export function dictionaryStylesheetUrls(
  stylesheetUrl: string | null,
  compatibilityProfile: string | null,
): readonly string[] {
  if (!stylesheetUrl) return [];
  return [stylesheetUrl, ...(compatibilityProfile ? compatibilityOverrides[compatibilityProfile] ?? [] : [])];
}
