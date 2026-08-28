/**
 * Popup: block the current tab, add a block by hand, show the normalized
 * preview, link to the options page.
 */
import { parseHostnameInput, describeScope } from '../core/hostname.js';
import { evaluateCurrentTab, type CurrentTabState } from '../core/current-tab.js';
import { send } from './messaging.js';
import { applyStoredTheme } from '../shared/theme.js';
import type { BlockedSite } from '../core/state.js';

const input = document.getElementById('host-input') as HTMLInputElement;
const preview = document.getElementById('preview') as HTMLDivElement;
const previewHost = document.getElementById('preview-host') as HTMLDivElement;
const previewScope = document.getElementById('preview-scope') as HTMLDivElement;
const addButton = document.getElementById('add-btn') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLDivElement;
const count = document.getElementById('count') as HTMLParagraphElement;
const optionsButton = document.getElementById('options-btn') as HTMLButtonElement;
const incognito = document.getElementById('incognito') as HTMLParagraphElement;
const currentPreview = document.getElementById('current-preview') as HTMLDivElement;
const currentHost = document.getElementById('current-host') as HTMLDivElement;
const currentScope = document.getElementById('current-scope') as HTMLDivElement;
const currentNote = document.getElementById('current-note') as HTMLParagraphElement;
const currentRow = document.getElementById('current-row') as HTMLDivElement;
const currentButton = document.getElementById('current-btn') as HTMLButtonElement;
const currentStatus = document.getElementById('current-status') as HTMLDivElement;

/** Hostname the current-tab button would add, or null when there is nothing to offer. */
let currentHostname: string | null = null;

function setStatus(text: string, kind: 'error' | 'success' | '' = ''): void {
  status.textContent = text;
  status.className = kind ? `status ${kind}` : 'status';
}

/** Live preview of exactly what will be blocked, before the user commits. */
function updatePreview(): void {
  const raw = input.value.trim();
  if (raw === '') {
    preview.classList.add('hidden');
    addButton.disabled = true;
    setStatus('');
    return;
  }

  const parsed = parseHostnameInput(raw);
  if (!parsed.ok) {
    preview.classList.add('hidden');
    addButton.disabled = true;
    setStatus(parsed.message, 'error');
    return;
  }

  preview.classList.remove('hidden');
  previewHost.textContent = parsed.hostname;
  previewScope.textContent = describeScope(parsed.kind, parsed.hostname);
  addButton.disabled = false;
  setStatus('');
}

/**
 * Render the current-tab card from an already-classified state.
 *
 * Exactly one of the three regions is visible at a time, so the card never
 * shows a stale hostname beside a note explaining why there isn't one.
 */
function renderCurrentTab(state: CurrentTabState): void {
  currentHostname = null;
  currentPreview.classList.add('hidden');
  currentNote.classList.add('hidden');
  currentRow.classList.add('hidden');

  if (state.status === 'blockable') {
    currentHostname = state.hostname;
    currentHost.textContent = state.hostname;
    currentScope.textContent = state.scope;
    currentPreview.classList.remove('hidden');
    currentRow.classList.remove('hidden');
    currentButton.disabled = false;
    return;
  }

  if (state.status === 'already-blocked') {
    currentNote.textContent =
      state.coveredBy === state.hostname
        ? `${state.hostname} is already blocked.`
        : `${state.hostname} is already blocked by the rule for ${state.coveredBy}.`;
  } else {
    currentNote.textContent = state.reason;
  }
  currentNote.classList.remove('hidden');
}

/**
 * Read the active tab and classify it against the blocklist.
 *
 * No "tabs" permission is needed: the existing http(s) host permissions already
 * allow reading these tab URLs. The URL is used only to decide what to offer
 * and is never stored or transmitted.
 */
async function refreshCurrentTab(blockedSites: BlockedSite[]): Promise<void> {
  let url: string | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    url = tab?.url;
  } catch {
    // Leave url undefined; evaluateCurrentTab reports it as unavailable.
  }
  renderCurrentTab(evaluateCurrentTab(url, blockedSites));
}

/**
 * Refresh the count and the current-tab card from one getState call.
 *
 * Both need the same blocklist, and the card's already-blocked check must agree
 * with the count the user is looking at, so they share a single snapshot rather
 * than issuing two round trips that could disagree.
 */
async function refresh(): Promise<void> {
  const response = await send({ type: 'getState' });
  if (!response.ok || !response.snapshot) {
    count.textContent = 'Could not load your blocklist.';
    renderCurrentTab({ status: 'unavailable', reason: 'Could not load your blocklist.' });
    return;
  }
  const sites = response.snapshot.state.blockedSites;
  count.textContent = `${sites.length} site${sites.length === 1 ? '' : 's'} blocked`;
  await refreshCurrentTab(sites);
}

async function refreshIncognito(): Promise<void> {
  const response = await send({ type: 'getIncognitoStatus' });
  if (!response.ok) return;
  incognito.textContent = response.incognitoEnabled
    ? 'Incognito blocking: Enabled'
    : 'Incognito blocking: Not enabled';
}

input.addEventListener('input', updatePreview);

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !addButton.disabled) void submit();
});

addButton.addEventListener('click', () => void submit());

async function submit(): Promise<void> {
  const raw = input.value.trim();
  if (raw === '') return;

  addButton.disabled = true;
  const response = await send({ type: 'addBlock', input: raw });

  if (!response.ok) {
    setStatus(response.error, 'error');
    addButton.disabled = false;
    return;
  }

  input.value = '';
  preview.classList.add('hidden');
  setStatus(response.message ?? 'Blocked.', 'success');
  await refresh();
}

currentButton.addEventListener('click', () => void submitCurrent());

/**
 * Block the current tab.
 *
 * Routed through the same `addBlock` command as the text box, so hostname
 * validation, consolidation, DNR rules, open-tab enforcement and cross-process
 * propagation all behave identically to a manual add.
 */
async function submitCurrent(): Promise<void> {
  if (currentHostname === null) return;

  currentButton.disabled = true;
  const response = await send({ type: 'addBlock', input: currentHostname });

  if (!response.ok) {
    currentStatus.textContent = response.error;
    currentStatus.className = 'status error';
    currentButton.disabled = false;
    return;
  }

  currentStatus.textContent = response.message ?? 'Blocked.';
  currentStatus.className = 'status success';
  // Re-render from fresh state so the card flips to its already-blocked note.
  await refresh();
}

optionsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Paint the stored theme before the rest of the popup renders.
void applyStoredTheme();
void refresh();
void refreshIncognito();
