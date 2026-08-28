/**
 * Options page: blocklist management, both typing challenges, duration setting
 * and import/export. All mutations go through the service worker.
 */
import { parseHostnameInput, describeScope } from '../core/hostname.js';
import { formatRemaining, isTemporarilyUnblocked } from '../core/exceptions.js';
import { permanentChallengeText, temporaryChallengeText } from '../core/templates.js';
import { describeImport, exportFileName, serializeExport } from '../core/transfer.js';
import type { BlockedSite, StoredState } from '../core/state.js';
import { createChallengeWidget } from './challenge-widget.js';
import { send } from './messaging.js';
import { applyTheme, applyStoredTheme } from '../shared/theme.js';
import { isValidTheme } from '../core/state.js';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = el<HTMLInputElement>('host-input');
const preview = el<HTMLDivElement>('preview');
const previewHost = el<HTMLDivElement>('preview-host');
const previewScope = el<HTMLDivElement>('preview-scope');
const addButton = el<HTMLButtonElement>('add-btn');
const addStatus = el<HTMLDivElement>('add-status');

const listEl = el<HTMLUListElement>('blocklist');
const countEl = el<HTMLSpanElement>('count');
const emptyEl = el<HTMLParagraphElement>('empty');

const durationInput = el<HTMLInputElement>('duration');
const durationButton = el<HTMLButtonElement>('duration-btn');
const durationStatus = el<HTMLDivElement>('duration-status');

const themeSelect = el<HTMLSelectElement>('theme');
const themeStatus = el<HTMLDivElement>('theme-status');

const exportButton = el<HTMLButtonElement>('export-btn');
const importButton = el<HTMLButtonElement>('import-btn');
const importFile = el<HTMLInputElement>('import-file');
const transferStatus = el<HTMLDivElement>('transfer-status');
const incognitoEl = el<HTMLParagraphElement>('incognito');

const tempDialog = el<HTMLDialogElement>('temp-dialog');
const removeDialog = el<HTMLDialogElement>('remove-dialog');

let currentState: StoredState | null = null;
let tempTarget: string | null = null;
let removeTarget: string | null = null;

function setStatus(node: HTMLElement, text: string, kind: 'error' | 'success' | '' = ''): void {
  node.textContent = text;
  node.className = kind ? `status ${kind}` : 'status';
}

/* ------------------------------------------------------------------ adding */

function updatePreview(): void {
  const raw = input.value.trim();
  if (raw === '') {
    preview.classList.add('hidden');
    addButton.disabled = true;
    setStatus(addStatus, '');
    return;
  }

  const parsed = parseHostnameInput(raw);
  if (!parsed.ok) {
    preview.classList.add('hidden');
    addButton.disabled = true;
    setStatus(addStatus, parsed.message, 'error');
    return;
  }

  preview.classList.remove('hidden');
  previewHost.textContent = parsed.hostname;
  previewScope.textContent = describeScope(parsed.kind, parsed.hostname);
  addButton.disabled = false;
  setStatus(addStatus, '');
}

async function submitAdd(): Promise<void> {
  const raw = input.value.trim();
  if (raw === '') return;
  addButton.disabled = true;

  const response = await send({ type: 'addBlock', input: raw });
  if (!response.ok) {
    setStatus(addStatus, response.error, 'error');
    addButton.disabled = false;
    return;
  }

  input.value = '';
  preview.classList.add('hidden');
  setStatus(addStatus, response.message ?? 'Blocked.', 'success');
  applySnapshot(response.snapshot?.state ?? null);
}

input.addEventListener('input', updatePreview);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !addButton.disabled) void submitAdd();
});
addButton.addEventListener('click', () => void submitAdd());

/* -------------------------------------------------------------- rendering */

function renderList(state: StoredState): void {
  const now = Date.now();
  listEl.replaceChildren();
  countEl.textContent = String(state.blockedSites.length);
  emptyEl.classList.toggle('hidden', state.blockedSites.length > 0);

  for (const site of state.blockedSites) {
    listEl.appendChild(renderEntry(site, now));
  }
}

function renderEntry(site: BlockedSite, now: number): HTMLLIElement {
  const item = document.createElement('li');

  const header = document.createElement('div');
  header.className = 'row';

  const host = document.createElement('span');
  host.className = 'entry-host';
  host.textContent = site.hostname; // never innerHTML
  header.appendChild(host);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = site.kind === 'apex' ? 'apex + subdomains' : 'exact hostname';
  header.appendChild(badge);

  const unblocked = isTemporarilyUnblocked(site, now);
  if (unblocked) {
    const temp = document.createElement('span');
    temp.className = 'badge temp';
    temp.textContent = `temporarily unblocked for ${formatRemaining(site, now)}`;
    header.appendChild(temp);
  }

  item.appendChild(header);

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = '8px';

  if (unblocked) {
    // Blocking again is always one click - no challenge.
    const blockNow = document.createElement('button');
    blockNow.textContent = 'Block now';
    blockNow.addEventListener('click', () => void endTemporary(site.hostname));
    actions.appendChild(blockNow);
  } else {
    const tempButton = document.createElement('button');
    tempButton.textContent = 'Temporarily unblock';
    tempButton.addEventListener('click', () => openTemporaryChallenge(site.hostname));
    actions.appendChild(tempButton);
  }

  // The only deletion route, and it opens the long challenge.
  const removeButton = document.createElement('button');
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => openRemoveChallenge(site.hostname));
  actions.appendChild(removeButton);

  item.appendChild(actions);
  return item;
}

function applySnapshot(state: StoredState | null): void {
  if (!state) return;
  currentState = state;
  durationInput.value = String(state.settings.temporaryUnblockMinutes);
  // Keep the selector in step with stored state (an import can change it).
  themeSelect.value = state.settings.theme;
  applyTheme(state.settings.theme);
  renderList(state);
}

async function refresh(): Promise<void> {
  const response = await send({ type: 'getState' });
  if (!response.ok || !response.snapshot) {
    setStatus(addStatus, 'Could not load your blocklist.', 'error');
    return;
  }
  applySnapshot(response.snapshot.state);
}

/* ------------------------------------------------------- temporary unblock */

const tempWidget = createChallengeWidget({
  input: el<HTMLInputElement>('temp-input'),
  promptEl: el<HTMLDivElement>('temp-prompt'),
  statusEl: el<HTMLDivElement>('temp-status'),
  confirmButton: el<HTMLButtonElement>('temp-confirm'),
});

function openTemporaryChallenge(hostname: string): void {
  tempTarget = hostname;
  el<HTMLSpanElement>('temp-host').textContent = hostname;
  const minutes = currentState?.settings.temporaryUnblockMinutes ?? 60;
  el<HTMLButtonElement>('temp-confirm').textContent = `Temporarily unblock for ${describeDuration(
    minutes,
  )}`;
  tempWidget.setExpected(temporaryChallengeText(hostname));
  tempDialog.showModal();
  tempWidget.focus();
}

/** "1 hour", "90 minutes", "2 hours 30 minutes" - used in the confirm button. */
function describeDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`;
  return mins === 0 ? hourPart : `${hourPart} ${mins} minute${mins === 1 ? '' : 's'}`;
}

el<HTMLButtonElement>('temp-confirm').addEventListener('click', () => {
  void (async () => {
    if (!tempTarget) return;
    const response = await send({
      type: 'temporaryUnblock',
      hostname: tempTarget,
      challenge: tempWidget.value(),
    });
    if (!response.ok) {
      setStatus(el<HTMLDivElement>('temp-status'), response.error, 'error');
      return;
    }
    tempDialog.close();
    applySnapshot(response.snapshot?.state ?? null);
    setStatus(addStatus, response.message ?? '', 'success');
  })();
});

el<HTMLButtonElement>('temp-cancel').addEventListener('click', () => tempDialog.close());
tempDialog.addEventListener('close', () => {
  tempWidget.reset();
  tempTarget = null;
});

async function endTemporary(hostname: string): Promise<void> {
  const response = await send({ type: 'endTemporaryUnblock', hostname });
  if (!response.ok) {
    setStatus(addStatus, response.error, 'error');
    return;
  }
  applySnapshot(response.snapshot?.state ?? null);
  setStatus(addStatus, response.message ?? '', 'success');
}

/* ------------------------------------------------------ permanent removal */

const removeWidget = createChallengeWidget({
  input: el<HTMLTextAreaElement>('remove-input'),
  promptEl: el<HTMLDivElement>('remove-prompt'),
  statusEl: el<HTMLDivElement>('remove-status'),
  confirmButton: el<HTMLButtonElement>('remove-confirm'),
});

function openRemoveChallenge(hostname: string): void {
  removeTarget = hostname;
  el<HTMLSpanElement>('remove-host').textContent = hostname;
  removeWidget.setExpected(permanentChallengeText(hostname));
  removeDialog.showModal();
  removeWidget.focus();
}

el<HTMLButtonElement>('remove-confirm').addEventListener('click', () => {
  void (async () => {
    if (!removeTarget) return;
    const response = await send({
      type: 'removeBlock',
      hostname: removeTarget,
      challenge: removeWidget.value(),
    });
    if (!response.ok) {
      setStatus(el<HTMLDivElement>('remove-status'), response.error, 'error');
      return;
    }
    removeDialog.close();
    applySnapshot(response.snapshot?.state ?? null);
    setStatus(addStatus, response.message ?? '', 'success');
  })();
});

el<HTMLButtonElement>('remove-cancel').addEventListener('click', () => removeDialog.close());
removeDialog.addEventListener('close', () => {
  removeWidget.reset();
  removeTarget = null;
});

/* ---------------------------------------------------------------- duration */

durationButton.addEventListener('click', () => {
  void (async () => {
    const minutes = Number.parseInt(durationInput.value, 10);
    if (!Number.isFinite(minutes)) {
      setStatus(durationStatus, 'Enter a whole number of minutes between 1 and 1440.', 'error');
      return;
    }
    const response = await send({ type: 'setDuration', minutes });
    if (!response.ok) {
      setStatus(durationStatus, response.error, 'error');
      return;
    }
    applySnapshot(response.snapshot?.state ?? null);
    setStatus(durationStatus, response.message ?? '', 'success');
  })();
});

/* ------------------------------------------------------------------- theme */

themeSelect.addEventListener('change', () => {
  void (async () => {
    const theme = themeSelect.value;
    if (!isValidTheme(theme)) return;

    // Apply immediately so the change is visible before the round trip.
    applyTheme(theme);

    const response = await send({ type: 'setTheme', theme });
    if (!response.ok) {
      setStatus(themeStatus, response.error, 'error');
      return;
    }
    applySnapshot(response.snapshot?.state ?? null);
    setStatus(themeStatus, 'Theme saved.', 'success');
  })();
});

/* ----------------------------------------------------------- import/export */

exportButton.addEventListener('click', () => {
  if (!currentState) return;
  const blob = new Blob([serializeExport(currentState)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName();
  link.click();
  URL.revokeObjectURL(url);
  setStatus(transferStatus, 'Exported your blocklist and settings.', 'success');
});

importButton.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', () => {
  void (async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    // Allow re-importing the same filename twice in a row.
    importFile.value = '';

    const response = await send({ type: 'importJson', text });
    if (!response.ok) {
      setStatus(transferStatus, response.error, 'error');
      return;
    }
    applySnapshot(response.snapshot?.state ?? null);
    setStatus(
      transferStatus,
      response.summary ? describeImport(response.summary) : 'Import complete.',
      'success',
    );
  })();
});

/* --------------------------------------------------------------- incognito */

void (async () => {
  const response = await send({ type: 'getIncognitoStatus' });
  if (!response.ok) return;
  incognitoEl.textContent = response.incognitoEnabled
    ? 'Incognito blocking: Enabled'
    : 'Incognito blocking: Not enabled — turn on "Allow in Incognito" for StopDrift in chrome://extensions to block sites in Incognito windows.';
})();

// Paint the stored theme as early as possible, before state loads.
void applyStoredTheme();
void refresh();

// Re-render periodically so the remaining-time labels stay roughly accurate
// while the page is open. This only re-reads state; it never mutates anything.
window.setInterval(() => {
  if (currentState) renderList(currentState);
}, 30000);
