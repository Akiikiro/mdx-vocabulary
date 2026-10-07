import { type ReactNode, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { dictionaryStylesheetUrls } from './dictionary-stylesheets';

interface IsolatedHtmlEntryRendererProps {
  stylesheetUrl: string;
  compatibilityProfile: string | null;
  children: ReactNode;
}

const entryChromeStyles = `
  :host { display: block; color: #26342e; }
  *, *::before, *::after { box-sizing: border-box; }
  .dictionary-entry { overflow-wrap: anywhere; font-family: Georgia, "Times New Roman", serif; font-size: 1.02rem; line-height: 1.75; }
  .dictionary-entry.collapsed { position: relative; max-height: 220px; overflow: hidden; }
  .dictionary-entry.collapsed::after { position: absolute; inset: auto 0 0; height: 72px; background: linear-gradient(to bottom, rgb(255 255 255 / 0%), #fff); content: ""; pointer-events: none; }
  .dictionary-entry .chn { color: #275d49; }
  .dictionary-entry .x-g, .dictionary-entry .def-g { display: block; margin: 7px 0; }
  .dictionary-entry .pos { color: #8d3b2e; font-style: italic; }
  .dictionary-entry a { color: #176448; }
  .dictionary-resource-image { max-width: 100%; height: auto; vertical-align: middle; }
  .mdict-entry-reference { color: #176448; text-decoration: underline dotted; text-underline-offset: .15em; cursor: pointer; }
  .mdict-entry-reference:hover, .mdict-entry-reference:focus-visible { color: #0d4933; text-decoration-style: solid; outline: none; }
  .mdict-entry-reference:focus-visible { border-radius: 2px; box-shadow: 0 0 0 3px rgb(23 100 72 / 18%); }
  .mdict-entry-reference.loading { cursor: progress; opacity: .7; }
  .mdict-entry-reference.failed { color: #8d3b2e; }
  .mdict-entry-reference-error { margin-left: .3em; color: #8d3b2e; font-family: system-ui, sans-serif; font-size: .75em; }
  .pronunciation-button { display: inline-flex; align-items: center; justify-content: center; min-width: 1.75rem; min-height: 1.75rem; margin: 0 .16rem; padding: .12rem .3rem; border: 1px solid #b7c9c0; border-radius: 999px; background: #edf6f1; color: #176448; line-height: 1; vertical-align: middle; cursor: pointer; }
  .pronunciation-button:hover, .pronunciation-button:focus-visible { border-color: #176448; background: #dfeee7; }
  .pronunciation-button.playing { border-color: #176448; box-shadow: 0 0 0 3px rgb(23 100 72 / 13%); }
  .pronunciation-button.loading { cursor: progress; }
  .pronunciation-button.failed { border-color: #d4c9c6; background: #f4f1ef; color: #8d5f57; cursor: not-allowed; }
  .pronunciation-controls { display: inline-flex; align-items: center; gap: .25rem; }
  .edge-tts-button, .labeled-pronunciation-button { width: auto; min-width: 3.8rem; padding: .2rem .4rem; font-size: .68rem; }
`;

const oxfordDocumentStyles = `
  :host { color: #555; background: #fafafa; }
  .dictionary-entry { color: #555; background: #fafafa; font-family: "Nimbus Sans L", Helvetica, Arial, "Lucida Grande", "Lucida Sans Unicode", sans-serif; line-height: 1.3em; }
`;

export function IsolatedHtmlEntryRenderer({
  stylesheetUrl, compatibilityProfile, children,
}: IsolatedHtmlEntryRendererProps) {
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const mount = useCallback((host: HTMLDivElement | null) => {
    if (!host) return;
    setShadowRoot(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
  }, []);
  const urls = dictionaryStylesheetUrls(stylesheetUrl, compatibilityProfile);

  return (
    <div className="isolated-dictionary-entry" ref={mount}>
      {shadowRoot && createPortal(<>
        <style>{entryChromeStyles}{compatibilityProfile === 'oxford8' ? oxfordDocumentStyles : ''}</style>
        {urls.map((url) => <link key={url} rel="stylesheet" href={url} data-dictionary-stylesheet="" />)}
        {children}
      </>, shadowRoot)}
    </div>
  );
}
