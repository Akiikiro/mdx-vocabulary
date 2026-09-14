const CARD_ID = 'mdx-vocabulary-extension-card';
const ENGLISH_WORD = /^[A-Za-z](?:[A-Za-z'-]{0,62}[A-Za-z])?$/;
let requestSequence = 0;

function removeCard() {
  document.getElementById(CARD_ID)?.remove();
}

function selectedWord() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const word = selection.toString().trim();
  if (!ENGLISH_WORD.test(word)) return null;
  return { word, rect: selection.getRangeAt(0).getBoundingClientRect() };
}

function positionCard(card, rect) {
  const gap = 10;
  const width = Math.min(360, window.innerWidth - 24);
  card.style.width = `${width}px`;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const preferredTop = rect.bottom + gap;
  const top = preferredTop + 220 <= window.innerHeight
    ? preferredTop
    : Math.max(12, rect.top - 230);
  card.style.left = `${left + window.scrollX}px`;
  card.style.top = `${top + window.scrollY}px`;
}

function cardShell(word, rect) {
  removeCard();
  const card = document.createElement('section');
  card.id = CARD_ID;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', `Dictionary lookup for ${word}`);
  card.innerHTML = `
    <button class="mdx-vocabulary-close" type="button" aria-label="Close">×</button>
    <div class="mdx-vocabulary-headword"></div>
    <div class="mdx-vocabulary-body" aria-live="polite">Looking up…</div>
  `;
  card.querySelector('.mdx-vocabulary-headword').textContent = word;
  card.querySelector('.mdx-vocabulary-close').addEventListener('click', removeCard);
  document.documentElement.append(card);
  positionCard(card, rect);
  return card;
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

async function showLookup(word, rect) {
  const sequence = ++requestSequence;
  const card = cardShell(word, rect);
  const body = card.querySelector('.mdx-vocabulary-body');
  try {
    const result = await sendMessage({ type: 'lookup', word });
    if (sequence !== requestSequence || !card.isConnected) return;
    if (!result) {
      body.textContent = 'No exact match in the ready dictionaries.';
      return;
    }
    const entryId = result.entry.id;
    body.replaceChildren();
    const dictionary = document.createElement('div');
    dictionary.className = 'mdx-vocabulary-dictionary';
    dictionary.textContent = result.dictionary.name;
    const definition = document.createElement('p');
    definition.textContent = result.entry.plainText || result.entry.redirectTarget || 'No plain-text definition available.';
    const addButton = document.createElement('button');
    addButton.className = 'mdx-vocabulary-add';
    addButton.type = 'button';
    addButton.textContent = '加入生词本';
    addButton.addEventListener('click', async () => {
      addButton.disabled = true;
      addButton.textContent = '保存中…';
      try {
        await sendMessage({ type: 'addVocabulary', entryId });
        addButton.textContent = '已加入生词本';
      } catch (error) {
        addButton.disabled = false;
        addButton.textContent = error instanceof Error ? error.message : '保存失败';
      }
    });
    card.querySelector('.mdx-vocabulary-headword').textContent = result.entry.headword;
    body.append(dictionary, definition, addButton);
  } catch (error) {
    if (sequence === requestSequence && card.isConnected) {
      body.textContent = error instanceof Error ? error.message : 'Lookup failed.';
    }
  }
}

document.addEventListener('mouseup', (event) => {
  if (event.button !== 0 || event.target instanceof Element && event.target.closest(`#${CARD_ID}`)) return;
  const selected = selectedWord();
  if (selected) void showLookup(selected.word, selected.rect);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') removeCard();
}, true);
