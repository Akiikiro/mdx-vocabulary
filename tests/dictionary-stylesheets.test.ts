import { describe, expect, it } from 'vitest';
import { dictionaryStylesheetUrls, entryStylesheetUrls } from '../web/src/dictionary-stylesheets.js';

describe('dictionary stylesheet compatibility', () => {
  it('loads the Oxford override after any stylesheet URL carrying the Oxford profile', () => {
    const first = dictionaryStylesheetUrls('/api/dictionaries/11111111-1111-4111-8111-111111111111/assets/styles/O8C.css', 'oxford8');
    const second = dictionaryStylesheetUrls('/api/dictionaries/22222222-2222-4222-8222-222222222222/assets/styles/renamed.css', 'oxford8');
    expect(first).toEqual([first[0], '/dictionaries/oxford8/overrides.css']);
    expect(second).toEqual([second[0], '/dictionaries/oxford8/overrides.css']);
  });

  it('keeps unrelated dictionary stylesheets isolated', () => {
    expect(dictionaryStylesheetUrls('/api/dictionaries/example/assets/styles/theme.css', null))
      .toEqual(['/api/dictionaries/example/assets/styles/theme.css']);
    expect(dictionaryStylesheetUrls('/api/dictionaries/example/assets/styles/theme.css', 'unknown'))
      .toEqual(['/api/dictionaries/example/assets/styles/theme.css']);
  });

  it('never mounts an MDX stylesheet for structured detail', () => {
    expect(entryStylesheetUrls('structured', '/api/dictionaries/example/assets/styles/theme.css', 'oxford8')).toEqual([]);
    expect(entryStylesheetUrls('html', '/api/dictionaries/example/assets/styles/theme.css', 'oxford8'))
      .toEqual(['/api/dictionaries/example/assets/styles/theme.css', '/dictionaries/oxford8/overrides.css']);
  });
});
