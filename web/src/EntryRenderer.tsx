import type { EntryDetail, HtmlEntryDetail } from './api';
import { EntryContent } from './EntryContent';
import { StructuredEntryRenderer } from './StructuredEntryRenderer';
import { IsolatedHtmlEntryRenderer } from './IsolatedHtmlEntryRenderer';

interface EntryRendererProps {
  detail: EntryDetail;
  expanded: boolean;
  onNavigateEntryReference: (target: string) => Promise<boolean>;
  stylesheetUrl?: string | null;
  stylesheetCompatibilityProfile?: string | null;
}

export function EntryRenderer({
  detail, expanded, onNavigateEntryReference, stylesheetUrl = null, stylesheetCompatibilityProfile = null,
}: EntryRendererProps) {
  if (detail.contentModel === 'structured') {
    return <StructuredEntryRenderer detail={detail} expanded={expanded} />;
  }
  const content = (
    <HtmlEntryRenderer
      detail={detail}
      expanded={expanded}
      onNavigateEntryReference={onNavigateEntryReference}
    />
  );
  return stylesheetUrl ? (
    <IsolatedHtmlEntryRenderer
      stylesheetUrl={stylesheetUrl}
      compatibilityProfile={stylesheetCompatibilityProfile}
    >
      {content}
    </IsolatedHtmlEntryRenderer>
  ) : content;
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
