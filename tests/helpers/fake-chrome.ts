/**
 * Minimal in-memory fake of the Chrome APIs the service worker uses.
 *
 * Enough to exercise the coordinator's orchestration (storage + DNR + alarms +
 * tab enforcement) without a browser. It models the API surface, not Chrome's
 * native URL-matching behavior.
 */
import { vi } from 'vitest';

export interface FakeTab {
  id: number;
  url: string;
}

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

export type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

export function installFakeChrome(
  options: { tabs?: FakeTab[]; incognito?: boolean } = {},
) {
  const store: Record<string, unknown> = {};
  let dynamicRules: { id: number }[] = [];
  const alarms = new Map<string, { when: number }>();
  const tabs: FakeTab[] = [...(options.tabs ?? [])];
  const alarmListeners: ((alarm: { name: string }) => void)[] = [];
  const storageListeners: StorageListener[] = [];
  const messageListeners: MessageListener[] = [];

  const fake = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          // Model Chrome's own behavior: a write emits a change event to every
          // listener, including the one in the process that made the write.
          const changes: Record<string, StorageChange> = {};
          for (const [key, newValue] of Object.entries(items)) {
            changes[key] = { oldValue: store[key], newValue };
          }
          Object.assign(store, items);
          for (const listener of storageListeners) listener(changes, 'local');
        }),
      },
      onChanged: {
        addListener: vi.fn((fn: StorageListener) => storageListeners.push(fn)),
      },
    },
    declarativeNetRequest: {
      getDynamicRules: vi.fn(async () => dynamicRules),
      updateDynamicRules: vi.fn(
        async ({
          removeRuleIds = [],
          addRules = [],
        }: {
          removeRuleIds?: number[];
          addRules?: { id: number }[];
        }) => {
          dynamicRules = dynamicRules.filter((r) => !removeRuleIds.includes(r.id));
          // Chrome rejects the whole call if an added ID already exists. Model
          // that: without it, two overlapping syncs silently produce duplicate
          // rules here while failing in a real browser.
          for (const rule of addRules) {
            if (dynamicRules.some((r) => r.id === rule.id)) {
              throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
            }
          }
          dynamicRules.push(...addRules);
        },
      ),
    },
    alarms: {
      create: vi.fn(async (name: string, info: { when: number }) => {
        alarms.set(name, info);
      }),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      onAlarm: { addListener: vi.fn((fn: (a: { name: string }) => void) => alarmListeners.push(fn)) },
    },
    tabs: {
      // Chrome applies the `url` patterns server-side; model that here so a
      // test cannot accidentally rely on non-http(s) tabs being returned.
      query: vi.fn(async (info: { url?: string[] } = {}) => {
        const patterns = info.url ?? [];
        const match = (url: string) =>
          patterns.length === 0 ||
          patterns.some((p) => {
            const scheme = p.split('://')[0];
            return url.startsWith(`${scheme}://`);
          });
        return tabs.filter((t) => match(t.url)).map((t) => ({ ...t }));
      }),
      update: vi.fn(async (id: number, props: { url: string }) => {
        const tab = tabs.find((t) => t.id === id);
        if (tab) tab.url = props.url;
      }),
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://fake-id${path}`,
      onMessage: {
        addListener: vi.fn((fn: MessageListener) => messageListeners.push(fn)),
      },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    extension: {
      isAllowedIncognitoAccess: vi.fn(async () => options.incognito ?? false),
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = fake;

  return {
    fake,
    store,
    tabs,
    /**
     * Deliver a change event as if a DIFFERENT process had written it, which is
     * the split-incognito case the onChanged listener exists to handle.
     */
    emitForeignChange(key: string, newValue: unknown) {
      const changes: Record<string, StorageChange> = {
        [key]: { oldValue: store[key], newValue },
      };
      store[key] = newValue;
      for (const listener of storageListeners) listener(changes, 'local');
    },
    storageListenerCount: () => storageListeners.length,
    /**
     * Send a command the way chrome.runtime.onMessage would, and resolve with
     * the response the worker passes to sendResponse.
     *
     * Deliberately does NOT await anything before returning: callers need to be
     * able to fire two commands without awaiting the first, which is exactly
     * how Chrome delivers them and exactly the race being tested.
     */
    sendMessage(message: unknown): Promise<unknown> {
      return new Promise((resolve) => {
        for (const listener of messageListeners) listener(message, {}, resolve);
      });
    },
    /** Fire an alarm as Chrome would, outside any command. */
    emitAlarm(name: string) {
      for (const listener of alarmListeners) listener({ name });
    },
    get rules() {
      return dynamicRules;
    },
    get alarms() {
      return alarms;
    },
  };
}
