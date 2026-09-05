import { type FormEvent, useEffect, useState } from 'react';
import {
  getEntry,
  listDictionaries,
  searchEntries,
  type Dictionary,
  type EntryDetail,
  type SearchEntry,
} from './api';

type SearchMode = 'exact' | 'prefix';

export function App() {
  const [dictionaries, setDictionaries] = useState<Dictionary[]>([]);
  const [dictionaryId, setDictionaryId] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('exact');
  const [results, setResults] = useState<SearchEntry[]>([]);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [loadingDictionaries, setLoadingDictionaries] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    listDictionaries()
      .then((items) => {
        if (!active) return;
        setDictionaries(items);
        setDictionaryId(items[0]?.id ?? '');
      })
      .catch((reason: unknown) => {
        if (active) setError(messageFrom(reason));
      })
      .finally(() => {
        if (active) setLoadingDictionaries(false);
      });
    return () => { active = false; };
  }, []);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!dictionaryId || !trimmedQuery) return;

    setSearching(true);
    setSearchCompleted(false);
    setError('');
    setDetail(null);
    try {
      const items = await searchEntries(dictionaryId, trimmedQuery, mode);
      setResults(items);
      setSearchCompleted(true);
    } catch (reason) {
      setResults([]);
      setError(messageFrom(reason));
    } finally {
      setSearching(false);
    }
  }

  async function selectEntry(entryId: string) {
    setLoadingDetail(true);
    setError('');
    try {
      setDetail(await getEntry(entryId));
    } catch (reason) {
      setDetail(null);
      setError(messageFrom(reason));
    } finally {
      setLoadingDetail(false);
    }
  }

  const noDictionaries = !loadingDictionaries && dictionaries.length === 0;

  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="eyebrow">MDX Vocabulary</p>
        <h1>Dictionary Search</h1>
        <p>Search your imported dictionaries and read the complete entry.</p>
      </header>

      <section className="search-panel" aria-labelledby="search-heading">
        <h2 id="search-heading">Search</h2>
        {loadingDictionaries && <p className="status">Loading dictionaries…</p>}
        {noDictionaries && <p className="empty-state">No ready dictionaries available.</p>}

        {!noDictionaries && (
          <form onSubmit={submitSearch}>
            <label className="field dictionary-field">
              <span>Dictionary</span>
              <select
                value={dictionaryId}
                onChange={(event) => setDictionaryId(event.target.value)}
                disabled={loadingDictionaries || searching}
              >
                {dictionaries.map((dictionary) => (
                  <option key={dictionary.id} value={dictionary.id}>
                    {dictionary.name}{dictionary.entryCount ? ` · ${dictionary.entryCount.toLocaleString()} entries` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="search-row">
              <label className="field query-field">
                <span>Headword</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Try apple or app"
                  autoComplete="off"
                  autoFocus
                />
              </label>
              <fieldset className="mode-field">
                <legend>Search mode</legend>
                <label><input type="radio" name="mode" checked={mode === 'exact'} onChange={() => setMode('exact')} /> Exact</label>
                <label><input type="radio" name="mode" checked={mode === 'prefix'} onChange={() => setMode('prefix')} /> Prefix</label>
              </fieldset>
              <button className="search-button" type="submit" disabled={!dictionaryId || !query.trim() || searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <div className="content-grid">
        <section className="results-panel" aria-labelledby="results-heading">
          <div className="section-heading">
            <h2 id="results-heading">Results</h2>
            {searchCompleted && <span>{results.length} found</span>}
          </div>
          {searchCompleted && results.length === 0 && <p className="empty-state">No entries found.</p>}
          {!searchCompleted && !searching && <p className="placeholder">Search for a headword to begin.</p>}
          <ul className="result-list">
            {results.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => void selectEntry(entry.id)} className={detail?.id === entry.id ? 'selected' : ''}>
                  <span className="result-title">{entry.headword}</span>
                  {entry.redirectTarget && <span className="redirect">Redirect: {entry.redirectTarget}</span>}
                  <span className="preview">{entry.plainText || 'No text preview available.'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="detail-panel" aria-labelledby="detail-heading">
          <h2 id="detail-heading">Entry detail</h2>
          {loadingDetail && <p className="status">Loading entry…</p>}
          {!loadingDetail && !detail && <p className="placeholder">Select a result to read the full entry.</p>}
          {!loadingDetail && detail && (
            <article>
              <h3>{detail.headword}</h3>
              {detail.redirectTarget && <p className="redirect-detail">Redirected from this entry to {detail.redirectTarget}</p>}
              <div className="dictionary-entry" dangerouslySetInnerHTML={{ __html: detail.sanitizedHtml }} />
            </article>
          )}
        </section>
      </div>
    </main>
  );
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}
