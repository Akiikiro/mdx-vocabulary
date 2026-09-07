const compatibilityOverrides: Readonly<Record<string, readonly string[]>> = {
  '/dictionaries/oxford8/O8C.css': ['/dictionaries/oxford8/overrides.css'],
};

export function dictionaryStylesheetUrls(stylesheetUrl: string | null): readonly string[] {
  if (!stylesheetUrl) return [];
  return [stylesheetUrl, ...(compatibilityOverrides[stylesheetUrl] ?? [])];
}
