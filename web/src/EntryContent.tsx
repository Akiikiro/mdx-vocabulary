import { useEffect, useRef } from 'react';

interface EntryContentProps {
  dictionaryId: string;
  sanitizedHtml: string;
  expanded: boolean;
}

function resourceUrl(dictionaryId: string, logicalPath: string): string | null {
  if (!logicalPath || logicalPath.startsWith('/') || logicalPath.includes('\\') || /[\u0000-\u001f\u007f]/u.test(logicalPath)) return null;
  const segments = logicalPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return `/api/dictionaries/${encodeURIComponent(dictionaryId)}/resources/${segments.map(encodeURIComponent).join('/')}`;
}

export function EntryContent({ dictionaryId, sanitizedHtml, expanded }: EntryContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let currentAudio: HTMLAudioElement | null = null;
    let currentButton: HTMLButtonElement | null = null;
    let disposed = false;

    const resetButton = (button: HTMLButtonElement) => {
      button.classList.remove('loading', 'playing', 'failed');
      button.textContent = '🔊';
      button.setAttribute('aria-label', 'Play pronunciation');
      button.title = 'Play pronunciation';
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
      const logicalPath = button.dataset.mdictResource ?? '';
      const url = resourceUrl(dictionaryId, logicalPath);
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
        button.textContent = '🔊';
        button.setAttribute('aria-label', 'Replay pronunciation');
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

    for (const marker of container.querySelectorAll<HTMLElement>('span[data-mdict-kind="sound"][data-mdict-resource]')) {
      const logicalPath = marker.dataset.mdictResource ?? '';
      const url = resourceUrl(dictionaryId, logicalPath);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pronunciation-button';
      button.dataset.mdictResource = logicalPath;
      resetButton(button);

      if (!url) {
        button.classList.add('failed');
        button.disabled = true;
        button.textContent = '🔇';
        button.setAttribute('aria-label', 'Pronunciation unavailable');
        button.title = 'Pronunciation unavailable';
      }

      marker.replaceWith(button);
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
  }, [dictionaryId, sanitizedHtml]);

  return (
    <div
      ref={containerRef}
      id="dictionary-entry-content"
      className={`dictionary-entry${expanded ? '' : ' collapsed'}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
