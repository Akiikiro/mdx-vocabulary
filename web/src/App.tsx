import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  addVocabulary,
  getEntry,
  listDictionaries,
  listVocabulary,
  removeVocabulary,
  searchEntries,
  type Dictionary,
  type EntryDetail,
  type SearchEntry,
  type VocabularyItem,
} from './api';

const AUTOCOMPLETE_DELAY_MS = 250;

export function App() {
  const [dictionaries, setDictionaries] = useState<Dictionary[]>([]);
  const [dictionaryId, setDictionaryId] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchEntry[]>([]);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [loadingDictionaries, setLoadingDictionaries] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingVocabulary, setLoadingVocabulary] = useState(true);
  const [savingVocabulary, setSavingVocabulary] = useState(false);
  const [removingVocabularyId, setRemovingVocabularyId] = useState('');
  const [autocompleteCompleted, setAutocompleteCompleted] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState('');
  const autocompleteController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutocompleteValue = useRef<string | null>(null);

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

  useEffect(() => {
    let active = true;
    listVocabulary()
      .then((items) => { if (active) setVocabulary(items); })
      .catch((reason: unknown) => { if (active) setError(messageFrom(reason)); })
      .finally(() => { if (active) setLoadingVocabulary(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    autocompleteController.current?.abort();
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (skipAutocompleteValue.current === query) {
      skipAutocompleteValue.current = null;
      return;
    }
    skipAutocompleteValue.current = null;

    const trimmedQuery = query.trim();
    if (!dictionaryId || !trimmedQuery) {
      setSuggestions([]);
      setSearching(false);
      setAutocompleteCompleted(false);
      setDropdownOpen(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    autocompleteController.current = controller;
    setSuggestions([]);
    setAutocompleteCompleted(false);
    setSearching(false);
    setDropdownOpen(true);
    setActiveIndex(-1);

    debounceTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const items = await searchEntries(dictionaryId, trimmedQuery, 'prefix', {
          limit: 10,
          offset: 0,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const visibleSuggestions = prepareSuggestions(items);
        setSuggestions(visibleSuggestions);
        setActiveIndex(visibleSuggestions.length ? 0 : -1);
        setAutocompleteCompleted(true);
        setDropdownOpen(true);
      } catch (reason) {
        if (isAbortError(reason)) return;
        setSuggestions([]);
        setAutocompleteCompleted(true);
        setError(messageFrom(reason));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, AUTOCOMPLETE_DELAY_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      controller.abort();
    };
  }, [dictionaryId, query]);

  useEffect(() => () => {
    autocompleteController.current?.abort();
    detailController.current?.abort();
  }, []);

  async function selectEntry(entry: SearchEntry) {
    autocompleteController.current?.abort();
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    skipAutocompleteValue.current = entry.headword;
    setQuery(entry.headword);
    setSuggestions([]);
    setDropdownOpen(false);
    setAutocompleteCompleted(false);
    setActiveIndex(-1);
    setSearching(false);
    setError('');

    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setLoadingDetail(true);
    try {
      const selectedDetail = await getEntry(entry.id, controller.signal);
      if (!controller.signal.aborted) setDetail(selectedDetail);
    } catch (reason) {
      if (!isAbortError(reason)) {
        setDetail(null);
        setError(messageFrom(reason));
      }
    } finally {
      if (!controller.signal.aborted) setLoadingDetail(false);
    }
  }

  async function addCurrentEntry() {
    if (!detail) return;
    setSavingVocabulary(true);
    setError('');
    try {
      const item = await addVocabulary(detail.id);
      setVocabulary((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSavingVocabulary(false);
    }
  }

  async function removeItem(item: VocabularyItem) {
    setRemovingVocabularyId(item.id);
    setError('');
    try {
      await removeVocabulary(item.id);
      setVocabulary((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setRemovingVocabularyId('');
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      autocompleteController.current?.abort();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      setDropdownOpen(false);
      setSearching(false);
      return;
    }
    if (!dropdownOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      void selectEntry(suggestions[activeIndex]);
    }
  }

  const noDictionaries = !loadingDictionaries && dictionaries.length === 0;
  const showDropdown = dropdownOpen && Boolean(query.trim()) && (searching || autocompleteCompleted);
  const currentVocabularyItem = detail
    ? vocabulary.find((item) => item.entryId === detail.id)
    : undefined;

  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="eyebrow">MDX Vocabulary</p>
        <h1>Dictionary Search</h1>
        <p>Start typing a headword, then choose a suggestion to read the complete entry.</p>
      </header>

      <section className="search-panel" aria-labelledby="search-heading">
        <h2 id="search-heading">Search</h2>
        {loadingDictionaries && <p className="status">Loading dictionaries…</p>}
        {noDictionaries && <p className="empty-state">No ready dictionaries available.</p>}

        {!noDictionaries && (
          <div className="search-fields">
            <label className="field dictionary-field">
              <span>Dictionary</span>
              <select
                value={dictionaryId}
                onChange={(event) => setDictionaryId(event.target.value)}
                disabled={loadingDictionaries}
              >
                {dictionaries.map((dictionary) => (
                  <option key={dictionary.id} value={dictionary.id}>
                    {dictionary.name}{dictionary.entryCount ? ` · ${dictionary.entryCount.toLocaleString()} entries` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="autocomplete">
              <label className="field query-field" htmlFor="headword-search">
                <span>Headword</span>
              </label>
              <input
                id="headword-search"
                className="search-input"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showDropdown}
                aria-controls="autocomplete-results"
                aria-activedescendant={activeIndex >= 0 ? `suggestion-${suggestions[activeIndex]?.id}` : undefined}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setError('');
                }}
                onFocus={() => {
                  if (query.trim() && (suggestions.length || autocompleteCompleted)) setDropdownOpen(true);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Start typing, for example app"
                autoComplete="off"
                autoFocus
              />

              {showDropdown && (
                <div id="autocomplete-results" className="autocomplete-dropdown" role="listbox">
                  {searching && <p className="dropdown-status">Searching…</p>}
                  {!searching && autocompleteCompleted && suggestions.length === 0 && (
                    <p className="dropdown-status">No matching entries</p>
                  )}
                  {!searching && suggestions.map((entry, index) => (
                    <button
                      id={`suggestion-${entry.id}`}
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={index === activeIndex ? 'active' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void selectEntry(entry)}
                    >
                      <span className="suggestion-headword">{entry.headword}</span>
                      <span className="suggestion-preview">{entry.plainText || 'No text preview available.'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="detail-panel" aria-labelledby="detail-heading">
        <h2 id="detail-heading">Entry detail</h2>
        {loadingDetail && <p className="status">Loading entry…</p>}
        {!loadingDetail && !detail && <p className="placeholder">Choose a suggestion to read the full entry.</p>}
        {!loadingDetail && detail && (
          <article>
            <div className="detail-heading-row">
              <h3>{detail.headword}</h3>
              <button
                className="primary-button"
                type="button"
                disabled={Boolean(currentVocabularyItem) || savingVocabulary}
                onClick={() => void addCurrentEntry()}
              >
                {currentVocabularyItem ? 'Added to Vocabulary' : savingVocabulary ? 'Adding…' : 'Add to Vocabulary'}
              </button>
            </div>
            {detail.redirectTarget && <p className="redirect-detail">Redirected from this entry to {detail.redirectTarget}</p>}
            <div className="dictionary-entry" dangerouslySetInnerHTML={{ __html: detail.sanitizedHtml }} />
          </article>
        )}
      </section>

      <section className="vocabulary-panel" aria-labelledby="vocabulary-heading">
        <h2 id="vocabulary-heading">Vocabulary Book</h2>
        {loadingVocabulary && <p className="status">Loading vocabulary…</p>}
        {!loadingVocabulary && vocabulary.length === 0 && (
          <p className="placeholder">Words you add will appear here.</p>
        )}
        {vocabulary.length > 0 && (
          <ul className="vocabulary-list">
            {vocabulary.map((item) => (
              <li key={item.id}>
                <button className="vocabulary-headword" type="button" onClick={() => void selectEntry(item.entry)}>
                  {item.entry.headword}
                </button>
                <time dateTime={item.createdAt}>{formatAddedTime(item.createdAt)}</time>
                <button
                  className="remove-button"
                  type="button"
                  disabled={removingVocabularyId === item.id}
                  onClick={() => void removeItem(item)}
                >
                  {removingVocabularyId === item.id ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatAddedTime(value: string): string {
  return `Added ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))}`;
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError';
}

function prepareSuggestions(entries: SearchEntry[]): SearchEntry[] {
  const seenHeadwords = new Set<string>();
  return entries.filter((entry) => {
    if (/\bsb\b/i.test(entry.headword) || seenHeadwords.has(entry.headword)) return false;
    seenHeadwords.add(entry.headword);
    return true;
  });
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}
