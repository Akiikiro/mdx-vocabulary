import { useEffect, useRef } from 'react';

interface EntryContentProps {
  dictionaryId: string;
  headword: string;
  sanitizedHtml: string;
  expanded: boolean;
  onNavigateEntryReference: (target: string) => Promise<boolean>;
}

const MAX_ENTRY_TARGET_LENGTH = 4096;

function encodedResourcePath(logicalPath: string): string | null {
  if (!logicalPath || logicalPath.startsWith('/') || logicalPath.includes('\\') || /[\u0000-\u001f\u007f]/u.test(logicalPath)) return null;
  const segments = logicalPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.map(encodeURIComponent).join('/');
}

function pronunciationResourceUrl(dictionaryId: string, logicalPath: string): string | null {
  const resourcePath = encodedResourcePath(logicalPath);
  return resourcePath
    ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}/browser-audio/${resourcePath}`
    : null;
}

function imageResourceUrl(dictionaryId: string, logicalPath: string): string | null {
  const resourcePath = encodedResourcePath(logicalPath);
  return resourcePath
    ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}/resources/${resourcePath}`
    : null;
}

function edgeTtsUrl(word: string, voice: 'female' | 'male'): string {
  return `/api/experimental/edge-tts?word=${encodeURIComponent(word)}&voice=${voice}`;
}

export function EntryContent({
  dictionaryId,
  headword,
  sanitizedHtml,
  expanded,
  onNavigateEntryReference,
}: EntryContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigateEntryReferenceRef = useRef(onNavigateEntryReference);
  navigateEntryReferenceRef.current = onNavigateEntryReference;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let currentAudio: HTMLAudioElement | null = null;
    let currentButton: HTMLButtonElement | null = null;
    let disposed = false;

    const entryTarget = (marker: HTMLElement): string | null => {
      const target = marker.dataset.mdictEntryTarget?.trim().normalize('NFC') ?? '';
      return target && target.length <= MAX_ENTRY_TARGET_LENGTH && !/[\u0000-\u001f\u007f]/u.test(target)
        ? target
        : null;
    };

    for (const marker of container.querySelectorAll<HTMLElement>('span[data-mdict-kind="entry"][data-mdict-entry-target]')) {
      const target = entryTarget(marker);
      if (!target) continue;
      marker.classList.add('mdict-entry-reference');
      marker.setAttribute('role', 'link');
      marker.tabIndex = 0;
      marker.setAttribute('aria-label', `Open dictionary entry ${target}`);
    }

    const activateEntryReference = async (marker: HTMLElement) => {
      const target = entryTarget(marker);
      if (!target || marker.classList.contains('loading')) return;
      container.querySelector('.mdict-entry-reference-error')?.remove();
      marker.classList.remove('failed');
      marker.classList.add('loading');
      marker.setAttribute('aria-disabled', 'true');
      const navigated = await navigateEntryReferenceRef.current(target);
      if (disposed || navigated) return;
      marker.classList.remove('loading');
      marker.classList.add('failed');
      marker.removeAttribute('aria-disabled');
      const failure = document.createElement('span');
      failure.className = 'mdict-entry-reference-error';
      failure.setAttribute('role', 'status');
      failure.textContent = 'Reference not found';
      marker.insertAdjacentElement('afterend', failure);
    };

    const resetButton = (button: HTMLButtonElement) => {
      button.classList.remove('loading', 'playing', 'failed');
      button.textContent = button.dataset.label ?? '🔊';
      const description = button.dataset.description ?? 'pronunciation';
      button.setAttribute('aria-label', `Play ${description}`);
      button.title = `Play ${description}`;
      button.disabled = false;
    };

    const stopCurrent = () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.removeAttribute('src');
        currentAudio.load();
      }
      if (currentButton) resetButton(currentButton);
      currentAudio = null;
      currentButton = null;
    };

    const play = async (button: HTMLButtonElement) => {
      const url = button.dataset.audioUrl ?? '';
      if (!url) return;

      stopCurrent();
      if (disposed) return;

      const audio = new Audio(url);
      currentAudio = audio;
      currentButton = button;
      button.classList.add('loading');
      button.textContent = '…';
      button.setAttribute('aria-label', 'Loading pronunciation');

      audio.onplaying = () => {
        if (disposed || currentAudio !== audio) return;
        button.classList.remove('loading');
        button.classList.add('playing');
        button.textContent = button.dataset.label ?? '🔊';
        button.setAttribute('aria-label', `Replay ${button.dataset.description ?? 'pronunciation'}`);
      };
      audio.onended = () => {
        if (currentAudio === audio) stopCurrent();
      };
      audio.onerror = () => {
        if (disposed || currentAudio !== audio) return;
        stopCurrent();
        button.classList.add('failed');
        button.textContent = '🔇';
        button.setAttribute('aria-label', 'Pronunciation failed to load');
        button.title = 'Pronunciation failed to load';
      };

      try {
        await audio.play();
      } catch {
        if (disposed || currentAudio !== audio) return;
        stopCurrent();
        button.classList.add('failed');
        button.textContent = '🔇';
        button.setAttribute('aria-label', 'Pronunciation playback failed');
        button.title = 'Pronunciation playback failed';
      }
    };

    for (const marker of container.querySelectorAll<HTMLElement>('span[data-mdict-kind="image"][data-mdict-resource]')) {
      const logicalPath = marker.dataset.mdictResource ?? '';
      const url = imageResourceUrl(dictionaryId, logicalPath);
      if (!url) {
        marker.remove();
        continue;
      }

      const image = document.createElement('img');
      image.className = 'dictionary-resource-image';
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove(), { once: true });
      marker.replaceWith(image);
    }

    for (const marker of container.querySelectorAll<HTMLElement>('span[data-mdict-kind="sound"][data-mdict-resource]')) {
      const logicalPath = marker.dataset.mdictResource ?? '';
      const url = pronunciationResourceUrl(dictionaryId, logicalPath);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pronunciation-button';
      button.dataset.mdictResource = logicalPath;
      button.dataset.audioUrl = url ?? '';
      const firstSegment = logicalPath.split('/')[0]?.toLowerCase();
      const accent = firstSegment === 'uk' || firstSegment === 'us' ? firstSegment : null;

      if (accent === 'uk') {
        marker.remove();
        continue;
      }

      if (accent === 'us') {
        button.classList.add('labeled-pronunciation-button');
        button.dataset.label = 'Oxford US';
      }
      button.dataset.description = accent ? `Oxford ${accent.toUpperCase()} pronunciation` : 'Oxford pronunciation';
      resetButton(button);

      if (!url) {
        button.classList.add('failed');
        button.disabled = true;
        button.textContent = '🔇';
        button.setAttribute('aria-label', 'Pronunciation unavailable');
        button.title = 'Pronunciation unavailable';
      }

      if (accent === 'us') {
        const controls = document.createElement('span');
        controls.className = 'pronunciation-controls';
        controls.append(button);

        for (const voice of ['female', 'male'] as const) {
          const edgeButton = document.createElement('button');
          edgeButton.type = 'button';
          edgeButton.className = 'pronunciation-button edge-tts-button';
          edgeButton.dataset.audioUrl = edgeTtsUrl(headword, voice);
          edgeButton.dataset.label = voice === 'female' ? 'Female' : 'Male';
          edgeButton.dataset.description = `experimental Edge TTS ${voice} pronunciation`;
          resetButton(edgeButton);
          controls.append(edgeButton);
        }
        marker.replaceWith(controls);
      } else {
        marker.replaceWith(button);
      }
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const entryReference = target.closest<HTMLElement>('.mdict-entry-reference');
      if (entryReference && container.contains(entryReference)) {
        void activateEntryReference(entryReference);
        return;
      }
      const button = target.closest<HTMLButtonElement>('.pronunciation-button');
      if (button && container.contains(button) && !button.disabled) void play(button);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const entryReference = target.closest<HTMLElement>('.mdict-entry-reference');
      if (!entryReference || !container.contains(entryReference)) return;
      event.preventDefault();
      void activateEntryReference(entryReference);
    };
    container.addEventListener('click', handleClick);
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      disposed = true;
      container.removeEventListener('click', handleClick);
      container.removeEventListener('keydown', handleKeyDown);
      stopCurrent();
    };
  }, [dictionaryId, headword, sanitizedHtml]);

  return (
    <div
      ref={containerRef}
      id="dictionary-entry-content"
      className={`dictionary-entry${expanded ? '' : ' collapsed'}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
