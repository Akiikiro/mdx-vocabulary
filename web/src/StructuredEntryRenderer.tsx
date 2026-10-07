import { useEffect, useRef, useState } from 'react';
import { generateTtsAudio, type StructuredDefinition, type StructuredEntryDetail, type StructuredForm } from './api';

interface StructuredEntryRendererProps { detail: StructuredEntryDetail; expanded: boolean; }

const metadataLabels: Readonly<Record<string, string>> = {
  'adverb (fukushi)': '副詞',
  'noun (common) (futsuumeishi)': '名詞',
  'adjectival nouns or quasi-adjectives (keiyodoshi)': '形容動詞',
  'Ichidan verb': '一段動詞',
  'transitive verb': '他動詞',
  'intransitive verb': '自動詞',
  yojijukugo: '四字熟語',
  'yojijukugo (four character compound)': '四字熟語',
  "nouns which may take the genitive case particle 'no'": 'ノ形容詞',
};

export function StructuredEntryRenderer({ detail, expanded }: StructuredEntryRendererProps) {
  const readings = applicableReadings(detail.headword, detail.forms);
  const readingTexts = new Set(readings.map((form) => form.text));
  const alternateForms = detail.forms.filter((form) => form.text !== detail.headword && !readingTexts.has(form.text));
  const multipleSenses = detail.senses.length > 1;
  return (
    <div id="dictionary-entry-content" className={`dictionary-entry structured-entry${expanded ? '' : ' collapsed'}`}>
      {readings.length > 0 && <div className="structured-readings" aria-label="Readings">
        {readings.map((reading) => <span className="structured-reading" key={`${reading.ordinal}:${reading.text}`}>
          <span lang="ja">{reading.text}</span><JapanesePronunciationButton text={reading.text} />
        </span>)}
      </div>}
      {alternateForms.length > 0 && <div className="structured-alternate-forms" aria-label="Alternate forms">
        {alternateForms.map((form, index) => <span key={`${form.ordinal}:${form.text}`} lang={form.language}>
          {index > 0 && <span aria-hidden="true">・</span>}{form.text}
          {form.restrictions.length > 0 && form.kind === 'kana' && <small>（{form.restrictions.join('・')}）</small>}
        </span>)}
      </div>}
      <section className="structured-meanings" aria-labelledby="structured-meanings-heading">
        <h4 id="structured-meanings-heading">释义</h4>
        {detail.entryDefinitions.length > 0 && <div className="entry-level-definitions" data-definition-scope="entry">
          <DefinitionRows definitions={detail.entryDefinitions} />
        </div>}
        {detail.senses.length > 0 && <ol className={multipleSenses ? 'numbered-senses' : 'single-sense'}>
          {detail.senses.map((sense) => {
            const metadata = displayMetadata([...sense.partOfSpeech, ...sense.domains, ...sense.tags]);
            return <li key={sense.ordinal} data-definition-scope="sense">
              {metadata.length > 0 && <p className="learner-metadata">{metadata.join('・')}</p>}
              {sense.notes && <p className="sense-note">{sense.notes}</p>}
              {sense.definitions.length > 0 && <DefinitionRows definitions={sense.definitions} />}
            </li>;
          })}
        </ol>}
      </section>
    </div>
  );
}

export function applicableReadings(headword: string, forms: StructuredForm[]): StructuredForm[] {
  return forms
    .filter((form) => form.kind === 'kana' && (form.restrictions.length === 0 || form.restrictions.includes(headword)))
    .sort((left, right) => left.ordinal - right.ordinal);
}

export function displayMetadata(values: string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    const label = metadataLabels[value] ?? value;
    if (!seen.has(label)) { seen.add(label); labels.push(label); }
  }
  return labels;
}

function JapanesePronunciationButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const dispose = () => {
    controller.current?.abort(); controller.current = null;
    if (audio.current) { audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); audio.current = null; }
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
  };
  useEffect(() => dispose, []);
  async function play() {
    dispose(); setStatus('loading');
    const nextController = new AbortController(); controller.current = nextController;
    try {
      const blob = await generateTtsAudio(text, 'female', 1, nextController.signal, 'ja');
      if (nextController.signal.aborted) return;
      const url = URL.createObjectURL(blob); objectUrl.current = url;
      const nextAudio = new Audio(url); audio.current = nextAudio;
      nextAudio.onplaying = () => setStatus('playing');
      nextAudio.onended = () => setStatus('idle');
      nextAudio.onerror = () => setStatus('error');
      await nextAudio.play();
    } catch { if (!nextController.signal.aborted) setStatus('error'); }
    finally { if (controller.current === nextController) controller.current = null; }
  }
  return <button className={`structured-pronunciation-button ${status}`} type="button" onClick={() => void play()}
    disabled={status === 'loading'} aria-label={`${status === 'playing' ? 'Replay' : 'Play'} application TTS for ${text}`}
    title="Play with application Japanese TTS">{status === 'loading' ? '…' : status === 'error' ? '🔇' : '🔊'}</button>;
}

function DefinitionRows({ definitions }: { definitions: StructuredDefinition[] }) {
  return <div className="definition-rows">{groupByLanguage(definitions).map(([language, items]) =>
    <div className="definition-row" key={language}>
      <span className="definition-language" aria-label={languageLabel(language)}>{shortLanguageLabel(language)}</span>
      <ul>{items.map((definition) => <li key={`${definition.source}:${definition.ordinal}`} lang={definition.language}>{definition.text}</li>)}</ul>
    </div>)}</div>;
}

function groupByLanguage(definitions: StructuredDefinition[]): Array<[string, StructuredDefinition[]]> {
  const groups = new Map<string, StructuredDefinition[]>();
  for (const definition of definitions) { const group = groups.get(definition.language); if (group) group.push(definition); else groups.set(definition.language, [definition]); }
  return [...groups.entries()];
}

function shortLanguageLabel(language: string): string {
  if (language === 'ja') return '日'; if (language === 'en') return '英'; if (language === 'zh-CN') return '中'; return language;
}
function languageLabel(language: string): string {
  if (language === 'ja') return 'Japanese'; if (language === 'en') return 'English'; if (language === 'zh-CN') return 'Chinese (Simplified)'; return language;
}
