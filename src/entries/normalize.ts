export function normalizeHeadword(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
export function makeSortKey(value: string): string {
  return normalizeHeadword(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}
export function parseRedirect(rawEntry: string): string | null {
  return /^@@@LINK=(.+)$/m.exec(rawEntry.replaceAll('\0', ''))?.[1]?.trim() ?? null;
}
