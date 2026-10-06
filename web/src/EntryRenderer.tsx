import type { EntryDetail, HtmlEntryDetail } from './api';
import { EntryContent } from './EntryContent';
import { StructuredEntryRenderer } from './StructuredEntryRenderer';

interface EntryRendererProps {
  detail: EntryDetail;
  expanded: boolean;
  onNavigateEntryReference: (target: string) => Promise<boolean>;
}

export function EntryRenderer({ detail, expanded, onNavigateEntryReference }: EntryRendererProps) {
  if (detail.contentModel === 'structured') {
    return <StructuredEntryRenderer detail={detail} expanded={expanded} />;
  }
  return (
    <HtmlEntryRenderer
      detail={detail}
      expanded={expanded}
      onNavigateEntryReference={onNavigateEntryReference}
    />
  );
}

interface HtmlEntryRendererProps {
  detail: HtmlEntryDetail;
  expanded: boolean;
  onNavigateEntryReference: (target: string) => Promise<boolean>;
}

export function HtmlEntryRenderer({ detail, expanded, onNavigateEntryReference }: HtmlEntryRendererProps) {
  return (
    <EntryContent
      dictionaryId={detail.dictionaryId}
      headword={detail.headword}
      sanitizedHtml={detail.sanitizedHtml}
      expanded={expanded}
      onNavigateEntryReference={onNavigateEntryReference}
    />
  );
}
