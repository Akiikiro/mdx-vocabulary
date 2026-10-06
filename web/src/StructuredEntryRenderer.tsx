import type { StructuredDefinition, StructuredEntryDetail } from './api';

interface StructuredEntryRendererProps {
  detail: StructuredEntryDetail;
  expanded: boolean;
}

export function StructuredEntryRenderer({ detail, expanded }: StructuredEntryRendererProps) {
  const alternateForms = detail.forms.filter((form) => form.text !== detail.headword);

  return (
    <div
      id="dictionary-entry-content"
      className={`dictionary-entry structured-entry${expanded ? '' : ' collapsed'}`}
    >
      {alternateForms.length > 0 && (
        <section className="structured-section structured-forms" aria-labelledby="structured-forms-heading">
          <h4 id="structured-forms-heading">Forms and readings</h4>
          <ul>
            {alternateForms.map((form) => (
              <li key={`${form.ordinal}:${form.text}`} lang={form.language}>
                <span>{form.text}</span>
                {form.kind && <span className="form-kind">{form.kind}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.entryDefinitions.length > 0 && (
        <section className="structured-section entry-definitions" aria-labelledby="entry-definitions-heading">
          <h4 id="entry-definitions-heading">Entry definitions</h4>
          <DefinitionGroups definitions={detail.entryDefinitions} />
        </section>
      )}

      {detail.senses.length > 0 && (
        <section className="structured-section structured-senses" aria-labelledby="structured-senses-heading">
          <h4 id="structured-senses-heading">Senses</h4>
          <ol>
            {detail.senses.map((sense) => (
              <li key={sense.ordinal}>
                {(sense.partOfSpeech.length > 0 || sense.domains.length > 0 || sense.tags.length > 0) && (
                  <dl className="sense-metadata">
                    {sense.partOfSpeech.length > 0 && <Metadata label="Part of speech" values={sense.partOfSpeech} />}
                    {sense.domains.length > 0 && <Metadata label="Domain" values={sense.domains} />}
                    {sense.tags.length > 0 && <Metadata label="Tags" values={sense.tags} />}
                  </dl>
                )}
                {sense.notes && <p className="sense-note">{sense.notes}</p>}
                {sense.definitions.length > 0 && <DefinitionGroups definitions={sense.definitions} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Metadata({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{values.join(' · ')}</dd>
    </div>
  );
}

function DefinitionGroups({ definitions }: { definitions: StructuredDefinition[] }) {
  const groups = groupByLanguage(definitions);
  return (
    <div className="definition-groups">
      {groups.map(([language, items]) => (
        <section className="definition-language-group" key={language} aria-label={`${languageLabel(language)} definitions`}>
          <h5>{languageLabel(language)}</h5>
          <ul>
            {items.map((definition) => (
              <li key={`${definition.source}:${definition.ordinal}`} lang={definition.language}>{definition.text}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupByLanguage(definitions: StructuredDefinition[]): Array<[string, StructuredDefinition[]]> {
  const groups = new Map<string, StructuredDefinition[]>();
  for (const definition of definitions) {
    const group = groups.get(definition.language);
    if (group) group.push(definition);
    else groups.set(definition.language, [definition]);
  }
  return [...groups.entries()];
}

function languageLabel(language: string): string {
  if (language === 'ja') return 'Japanese';
  if (language === 'en') return 'English';
  if (language === 'zh-CN') return 'Chinese (Simplified)';
  return language;
}
