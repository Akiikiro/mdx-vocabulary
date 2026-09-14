const CARD_ID = 'mdx-vocabulary-extension-card';
const ENGLISH_WORD = /^[A-Za-z](?:[A-Za-z'-]{0,62}[A-Za-z])?$/;
const CARD_STYLES = `
  :host { all: initial; position: absolute; z-index: 2147483647; color: #263238; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  *, *::before, *::after { box-sizing: border-box; }
  button, input { font: inherit; }
  .card { display: flex; flex-direction: column; width: min(440px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 24px)); overflow: hidden; background: #fff; border: 1px solid #d9e0de; border-radius: 12px; box-shadow: 0 12px 34px rgb(29 44 41 / 28%); }
  .toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 12px; background: #f5f8f7; border-bottom: 1px solid #e0e7e5; }
  .search { min-width: 0; flex: 1; height: 36px; padding: 6px 11px; color: #17201e; background: #fff; border: 1px solid #bdc9c6; border-radius: 8px; outline: none; }
  .search:focus { border-color: #357b6d; box-shadow: 0 0 0 2px rgb(53 123 109 / 15%); }
  .icon-button { flex: 0 0 auto; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; color: #53615e; background: transparent; border: 0; border-radius: 50%; cursor: pointer; }
  .icon-button:hover { background: #e5ecea; }
  .close { font-size: 24px; line-height: 1; }
  .suggestions { flex: 0 0 auto; max-height: 184px; overflow: auto; margin: 0; padding: 4px; list-style: none; background: #fff; border-bottom: 1px solid #e0e7e5; }
  .suggestions[hidden] { display: none; }
  .suggestion { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 7px 9px; color: #263238; text-align: left; background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
  .suggestion:hover, .suggestion.active { background: #edf4f2; }
  .suggestion-dictionary { overflow: hidden; color: #788481; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .scroll { flex: 1 1 auto; min-height: 90px; overflow: auto; overscroll-behavior: contain; }
  .status { padding: 22px 16px; color: #697572; text-align: center; }
  .entry-header { display: flex; align-items: center; gap: 7px; padding: 14px 16px 10px; }
  .headword { min-width: 0; margin-right: auto; font-size: 22px; font-weight: 680; overflow-wrap: anywhere; }
  .speak { padding: 5px 8px; color: #356d62; background: #eef6f4; border: 1px solid #cee0dc; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .speak:hover { background: #e1efeb; }
  details { border-top: 1px solid #e3e9e7; }
  summary { padding: 9px 16px; color: #43524f; background: #fafcfb; font-weight: 600; cursor: pointer; user-select: none; }
  .definition { display: block; padding: 14px 16px 18px; color: #202826; overflow-wrap: anywhere; }
  .actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: 10px 16px; background: linear-gradient(rgb(255 255 255 / 88%), #fff 35%); }
  .add { padding: 7px 12px; color: #fff; background: #357b6d; border: 0; border-radius: 7px; cursor: pointer; }
  .add:hover { background: #28685c; }
  .add:disabled { cursor: default; opacity: .72; }
`;

let requestSequence = 0;
let suggestionTimer;
let anchorRect = null;

function cardHost() { return document.getElementById(CARD_ID); }

function removeCard() {
  requestSequence += 1;
  clearTimeout(suggestionTimer);
  speechSynthesis.cancel();
  cardHost()?.remove();
}

function selectedWord() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const word = selection.toString().trim();
  if (!ENGLISH_WORD.test(word)) return null;
  return { word, rect: selection.getRangeAt(0).getBoundingClientRect() };
}

function positionCard(host, rect) {
  const gap = 10;
  const width = Math.min(440, window.innerWidth - 24);
  const expectedHeight = Math.min(560, window.innerHeight - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const below = rect.bottom + gap;
  const top = below + expectedHeight <= window.innerHeight ? below : Math.max(12, rect.top - expectedHeight - gap);
  host.style.left = `${left + window.scrollX}px`;
  host.style.top = `${top + window.scrollY}px`;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Extension request failed.'));
      resolve(response.result);
    });
  });
}

function createCard(word, rect) {
  removeCard();
  anchorRect = rect;
  const host = document.createElement('div');
  host.id = CARD_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${CARD_STYLES}</style>
    <section class="card" role="dialog" aria-label="Dictionary lookup">
      <form class="toolbar">
        <input class="search" type="search" autocomplete="off" spellcheck="false" aria-label="Search dictionary">
        <button class="icon-button close" type="button" aria-label="Close">×</button>
      </form>
      <ul class="suggestions" role="listbox" hidden></ul>
      <main class="scroll"><div class="status" aria-live="polite">Looking up…</div></main>
    </section>`;
  const elements = {
    host, shadow,
    form: shadow.querySelector('.toolbar'),
    input: shadow.querySelector('.search'),
    suggestions: shadow.querySelector('.suggestions'),
    scroll: shadow.querySelector('.scroll'),
  };
  elements.input.value = word;
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = elements.input.value.trim();
    hideSuggestions(elements);
    if (query) void lookupInto(elements, query);
  });
  elements.input.addEventListener('input', () => scheduleSuggestions(elements));
  elements.input.addEventListener('keydown', (event) => navigateSuggestions(event, elements));
  shadow.querySelector('.close').addEventListener('click', removeCard);
  document.documentElement.append(host);
  positionCard(host, rect);
  return elements;
}

function hideSuggestions(elements) {
  elements.suggestions.hidden = true;
  elements.suggestions.replaceChildren();
}

function scheduleSuggestions(elements) {
  clearTimeout(suggestionTimer);
  const prefix = elements.input.value.trim();
  if (!prefix) return hideSuggestions(elements);
  suggestionTimer = setTimeout(() => void loadSuggestions(elements, prefix), 180);
}

async function loadSuggestions(elements, prefix) {
  try {
    const suggestions = await sendMessage({ type: 'suggest', prefix });
    if (!elements.host.isConnected || elements.input.value.trim() !== prefix) return;
    elements.suggestions.replaceChildren(...suggestions.map((suggestion) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const word = document.createElement('span');
      const dictionary = document.createElement('span');
      button.type = 'button';
      button.className = 'suggestion';
      button.setAttribute('role', 'option');
      word.textContent = suggestion.headword;
      dictionary.className = 'suggestion-dictionary';
      dictionary.textContent = suggestion.dictionaryName;
      button.append(word, dictionary);
      button.addEventListener('click', () => {
        elements.input.value = suggestion.headword;
        hideSuggestions(elements);
        void lookupInto(elements, suggestion.headword);
      });
      item.append(button);
      return item;
    }));
    elements.suggestions.hidden = suggestions.length === 0;
  } catch {
    hideSuggestions(elements);
  }
}

function navigateSuggestions(event, elements) {
  const buttons = [...elements.suggestions.querySelectorAll('.suggestion')];
  if (elements.suggestions.hidden || buttons.length === 0) return;
  const active = buttons.findIndex((button) => button.classList.contains('active'));
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    buttons[active]?.classList.remove('active');
    const next = event.key === 'ArrowDown' ? (active + 1) % buttons.length : (active <= 0 ? buttons.length : active) - 1;
    buttons[next].classList.add('active');
    buttons[next].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && active >= 0) {
    event.preventDefault();
    buttons[active].click();
  }
}

function speak(word, language) {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = language;
  const voice = speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith(language.toLowerCase()));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function renderEntry(elements, result) {
  const { entry, dictionary, stylesheet } = result;
  elements.scroll.replaceChildren();
  const header = document.createElement('header');
  header.className = 'entry-header';
  const headword = document.createElement('div');
  headword.className = 'headword';
  headword.textContent = entry.headword;
  const british = document.createElement('button');
  british.className = 'speak';
  british.type = 'button';
  british.textContent = '英 GB';
  british.title = 'British pronunciation';
  british.addEventListener('click', () => speak(entry.headword, 'en-GB'));
  const american = document.createElement('button');
  american.className = 'speak';
  american.type = 'button';
  american.textContent = '美 US';
  american.title = 'American pronunciation';
  american.addEventListener('click', () => speak(entry.headword, 'en-US'));
  header.append(headword, british, american);

  const section = document.createElement('details');
  section.open = true;
  const summary = document.createElement('summary');
  summary.textContent = dictionary.name;
  const definition = document.createElement('article');
  definition.className = 'definition';
  const definitionShadow = definition.attachShadow({ mode: 'closed' });
  const dictionaryStyles = document.createElement('style');
  dictionaryStyles.textContent = `${stylesheet || ''}\n:host { color: #202826; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; } img { max-width: 100%; height: auto; } table, audio, video { max-width: 100%; } a { color: #176f9e; }`;
  const content = document.createElement('div');
  if (entry.sanitizedHtml) content.innerHTML = entry.sanitizedHtml;
  else content.textContent = entry.plainText || entry.redirectTarget || 'No definition available.';
  definitionShadow.append(dictionaryStyles, content);
  section.append(summary, definition);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const addButton = document.createElement('button');
  addButton.className = 'add';
  addButton.type = 'button';
  addButton.textContent = '加入生词本';
  addButton.addEventListener('click', async () => {
    addButton.disabled = true;
    addButton.textContent = '保存中…';
    try {
      await sendMessage({ type: 'addVocabulary', entryId: entry.id });
      addButton.textContent = '已加入生词本';
    } catch (error) {
      addButton.disabled = false;
      addButton.textContent = '重试加入生词本';
      addButton.title = error instanceof Error ? error.message : '保存失败';
    }
  });
  actions.append(addButton);
  elements.scroll.append(header, section, actions);
}

async function lookupInto(elements, word) {
  const sequence = ++requestSequence;
  clearTimeout(suggestionTimer);
  hideSuggestions(elements);
  elements.input.value = word;
  elements.scroll.innerHTML = '<div class="status" aria-live="polite">Looking up…</div>';
  try {
    const result = await sendMessage({ type: 'lookup', word });
    if (sequence !== requestSequence || !elements.host.isConnected) return;
    if (!result) {
      elements.scroll.innerHTML = '<div class="status">No exact match in the ready dictionaries.</div>';
      return;
    }
    renderEntry(elements, result);
  } catch (error) {
    if (sequence === requestSequence && elements.host.isConnected) {
      elements.scroll.replaceChildren();
      const status = document.createElement('div');
      status.className = 'status';
      status.textContent = error instanceof Error ? error.message : 'Lookup failed.';
      elements.scroll.append(status);
    }
  }
}

function showLookup(word, rect) {
  const elements = createCard(word, rect);
  void lookupInto(elements, word);
}

document.addEventListener('mouseup', (event) => {
  if (event.button !== 0 || event.composedPath().includes(cardHost())) return;
  const selected = selectedWord();
  if (selected) showLookup(selected.word, selected.rect);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') removeCard();
}, true);

window.addEventListener('resize', () => {
  const host = cardHost();
  if (host && anchorRect) positionCard(host, anchorRect);
});
