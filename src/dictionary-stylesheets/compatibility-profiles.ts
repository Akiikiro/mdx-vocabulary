import crypto from 'node:crypto';
import fs from 'node:fs';

export const OXFORD8_STYLESHEET_PROFILE = 'oxford8';

const stylesheetProfilesBySha256: Readonly<Record<string, string>> = {
  '68e9a92bb60ddda9dc730b33b17b7d9513e32917de4d36d005322e1b46071cc6': OXFORD8_STYLESHEET_PROFILE,
};

export function detectStylesheetCompatibilityProfile(sha256: string): string | null {
  return stylesheetProfilesBySha256[sha256.toLowerCase()] ?? null;
}

export async function detectStylesheetCompatibilityProfileFromFile(filePath: string): Promise<string | null> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return detectStylesheetCompatibilityProfile(hash.digest('hex'));
}
