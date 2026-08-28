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

export function installFakeChrome(
  options: { tabs?: FakeTab[]; incognito?: boolean } = {},
) {
  const store: Record<string, unknown> = {};
  let dynamicRules: { id: number }[] = [];
  const alarms = new Map<string, { when: number }>();
  const tabs: FakeTab[] = [...(options.tabs ?? [])];
  const alarmListeners: ((alarm: { name: string }) => void)[] = [];

  const fake = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
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
      onMessage: { addListener: vi.fn() },
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
    get rules() {
      return dynamicRules;
    },
    get alarms() {
      return alarms;
    },
  };
}
