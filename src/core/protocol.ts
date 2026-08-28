/**
 * Message contract between UI pages and the service worker.
 *
 * UI pages never write storage or DNR rules directly; they send one of these
 * commands so all mutations are serialized through a single coordinator.
 */
import type { StoredState, Theme } from './state.js';
import type { ImportSummary } from './transfer.js';

export type Command =
  | { type: 'getState' }
  | { type: 'addBlock'; input: string }
  | { type: 'temporaryUnblock'; hostname: string; challenge: string }
  | { type: 'endTemporaryUnblock'; hostname: string }
  | { type: 'removeBlock'; hostname: string; challenge: string }
  | { type: 'setDuration'; minutes: number }
  | { type: 'setTheme'; theme: Theme }
  | { type: 'importJson'; text: string }
  | { type: 'getIncognitoStatus' };

export interface StateSnapshot {
  state: StoredState;
  now: number;
}

export type CommandResponse =
  | { ok: true; snapshot?: StateSnapshot; message?: string; summary?: ImportSummary;
      incognitoEnabled?: boolean }
  | { ok: false; error: string };
