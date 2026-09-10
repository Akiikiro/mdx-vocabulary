import { useEffect, useRef } from 'react';

interface EntryContentProps {
  dictionaryId: string;
  headword: string;
  sanitizedHtml: string;
  expanded: boolean;
}

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

export function EntryContent({ dictionaryId, headword, sanitizedHtml, expanded }: EntryContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let currentAudio: HTMLAudioElement | null = null;
    let currentButton: HTMLButtonElement | null = null;
    let disposed = false;

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
      const button = target.closest<HTMLButtonElement>('.pronunciation-button');
      if (button && container.contains(button) && !button.disabled) void play(button);
    };
    container.addEventListener('click', handleClick);

    return () => {
      disposed = true;
      container.removeEventListener('click', handleClick);
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
