/** Popup: add a block, show the normalized preview, link to the options page. */
import { parseHostnameInput, describeScope } from '../core/hostname.js';
import { send } from './messaging.js';
import { applyStoredTheme } from '../shared/theme.js';

const input = document.getElementById('host-input') as HTMLInputElement;
const preview = document.getElementById('preview') as HTMLDivElement;
const previewHost = document.getElementById('preview-host') as HTMLDivElement;
const previewScope = document.getElementById('preview-scope') as HTMLDivElement;
const addButton = document.getElementById('add-btn') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLDivElement;
const count = document.getElementById('count') as HTMLParagraphElement;
const optionsButton = document.getElementById('options-btn') as HTMLButtonElement;
const incognito = document.getElementById('incognito') as HTMLParagraphElement;

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

async function refreshCount(): Promise<void> {
  const response = await send({ type: 'getState' });
  if (!response.ok || !response.snapshot) {
    count.textContent = 'Could not load your blocklist.';
    return;
  }
  const total = response.snapshot.state.blockedSites.length;
  count.textContent = `${total} site${total === 1 ? '' : 's'} blocked`;
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
  await refreshCount();
}

optionsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Paint the stored theme before the rest of the popup renders.
void applyStoredTheme();
void refreshCount();
void refreshIncognito();
