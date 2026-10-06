import type { SearchEntry } from './api';

export function SearchResultContent({ entry }: { entry: SearchEntry }) {
  return (
    <>
      <span className="suggestion-headword">{entry.headword}</span>
      {entry.contentModel === 'structured' && entry.matchedForm && entry.matchedForm !== entry.headword && (
        <span className="suggestion-matched-form">{entry.matchedForm}</span>
      )}
      <span className="suggestion-preview">{entry.plainText || 'No text preview available.'}</span>
    </>
  );
}
