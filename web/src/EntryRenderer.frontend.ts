import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addVocabulary, type HtmlEntryDetail, type StructuredDefinition, type StructuredEntryDetail, type StructuredSense } from './api';
import { EntryRenderer } from './EntryRenderer';
import { SearchResultContent } from './SearchResultContent';

const navigate = async () => true;
const common = {
  id: '11111111-1111-4111-8111-111111111111',
  dictionaryId: '22222222-2222-4222-8222-222222222222',
  kind: 'definition' as const,
  plainText: '',
  redirectTarget: null,
  sourceOrdinal: 0,
};

function definition(text: string, language: string, ordinal = 0): StructuredDefinition {
  return { text, language, source: language === 'ja' ? 'jpn-source' : 'lexical-source', provenance: { hidden: true }, ordinal };
}

function sense(ordinal: number, definitions: StructuredDefinition[], overrides: Partial<StructuredSense> = {}): StructuredSense {
  return {
    ordinal,
    sourceSenseOrdinal: ordinal,
    partOfSpeech: [],
    domains: [],
    tags: [],
    notes: null,
    definitions,
    ...overrides,
  };
}

describe('EntryRenderer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps HTML detail on the existing HTML renderer', () => {
    const detail: HtmlEntryDetail = {
      ...common, headword: 'apple', sourceRecordId: null, contentModel: 'html',
      sanitizedHtml: '<p class="legacy-oxford">existing Oxford HTML</p>',
    };
    const html = renderToStaticMarkup(createElement(EntryRenderer, { detail, expanded: true, onNavigateEntryReference: navigate }));
    expect(html).toContain('class="dictionary-entry"');
    expect(html).toContain('<p class="legacy-oxford">existing Oxford HTML</p>');
    expect(html).not.toContain('structured-entry');
  });

  it('renders 食べる alternate forms and multiple senses in source order', () => {
    const detail: StructuredEntryDetail = {
      ...common, headword: '食べる', sourceRecordId: '1358280', contentModel: 'structured',
      forms: [
        { text: '食べる', language: 'ja', kind: 'kanji', tags: [], priorityTags: [], restrictions: [], ordinal: 0 },
        { text: '喰べる', language: 'ja', kind: 'kanji', tags: [], priorityTags: [], restrictions: [], ordinal: 1 },
        { text: 'たべる', language: 'ja', kind: 'kana', tags: [], priorityTags: [], restrictions: [], ordinal: 2 },
      ],
      entryDefinitions: [],
      senses: [
        sense(0, [definition('to eat', 'en'), definition('吃', 'zh-CN')], { partOfSpeech: ['Ichidan verb'] }),
        sense(1, [definition('to live on', 'en'), definition('以…为生', 'zh-CN')]),
      ],
    };
    const html = renderStructured(detail);
    expect(html).toContain('structured-entry');
    expect(html).not.toContain('>食べる</li>');
    expect(html).toContain('lang="ja"><span>喰べる</span>');
    expect(html).toContain('lang="ja"><span>たべる</span>');
    expect(html.indexOf('to eat')).toBeLessThan(html.indexOf('to live on'));
    expect(html).toContain('lang="en">to eat');
    expect(html).toContain('lang="zh-CN">吃');
  });

  it('keeps 曖昧 Japanese entry definitions separate from sense translations', () => {
    const detail: StructuredEntryDetail = {
      ...common, headword: '曖昧', sourceRecordId: '1567920', contentModel: 'structured',
      forms: [{ text: '曖昧', language: 'ja', kind: 'kanji', tags: [], priorityTags: [], restrictions: [], ordinal: 0 }],
      entryDefinitions: [definition('はっきりしないこと。', 'ja')],
      senses: [
        sense(0, [definition('ambiguous', 'en'), definition('含糊', 'zh-CN')]),
        sense(1, [definition('suspicious', 'en'), definition('可疑', 'zh-CN')]),
        sense(2, [definition('indecent', 'en'), definition('不正当', 'zh-CN')]),
      ],
    };
    const html = renderStructured(detail);
    expect(html.indexOf('Entry definitions')).toBeLessThan(html.indexOf('Senses'));
    expect(html).toContain('lang="ja">はっきりしないこと。');
    expect(html.indexOf('含糊')).toBeLessThan(html.indexOf('可疑'));
    expect(html.indexOf('可疑')).toBeLessThan(html.indexOf('不正当'));
    expect(html).not.toContain('sourceSenseOrdinal');
    expect(html).not.toContain('hidden');
  });

  it('handles missing optional sections and one-sided sense languages without placeholders', () => {
    const detail: StructuredEntryDetail = {
      ...common, headword: '空', sourceRecordId: 'fixture-empty', contentModel: 'structured',
      forms: [{ text: '空', language: 'ja', kind: null, tags: [], priorityTags: [], restrictions: [], ordinal: 0 }],
      entryDefinitions: [],
      senses: [
        sense(0, [definition('empty sky', 'en')]),
        sense(1, [definition('天空', 'zh-CN')]),
        sense(2, []),
      ],
    };
    const html = renderStructured(detail);
    expect(html).not.toContain('Forms and readings');
    expect(html).not.toContain('Entry definitions');
    expect(html).not.toContain('Part of speech');
    expect(html).toContain('lang="en">empty sky');
    expect(html).toContain('lang="zh-CN">天空');
    expect(html).not.toContain('No definitions');
  });

  it('shows canonical 食べる and the matched たべる form in a search result', () => {
    const html = renderToStaticMarkup(createElement(SearchResultContent, { entry: {
      ...common, headword: '食べる', sourceRecordId: '1358280', contentModel: 'structured', matchedForm: 'たべる',
    } }));
    expect(html.indexOf('食べる')).toBeLessThan(html.indexOf('たべる'));
    expect(html).toContain('suggestion-matched-form');
  });

  it('adds a structured entry to vocabulary through its universal entry ID', async () => {
    const responseItem = { id: 'vocabulary-id', entryId: common.id, createdAt: new Date(0).toISOString(), entry: { ...common, headword: '食べる' } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responseItem), {
      status: 201, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(addVocabulary(common.id)).resolves.toEqual(responseItem);
    expect(fetchMock).toHaveBeenCalledWith('/api/vocabulary', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ entryId: common.id }),
    }));
  });
});

function renderStructured(detail: StructuredEntryDetail): string {
  return renderToStaticMarkup(createElement(EntryRenderer, { detail, expanded: true, onNavigateEntryReference: navigate }));
}
