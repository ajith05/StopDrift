import { describe, it, expect } from 'vitest';
import {
  buildExport,
  serializeExport,
  exportFileName,
  importFromJson,
  importFromObject,
  describeImport,
} from '../src/core/transfer.js';
import {
  defaultState,
  type StoredState,
  type BlockedSite,
  type Theme,
} from '../src/core/state.js';
import { EXTENSION_VERSION } from '../src/core/version.js';

const NOW = 1_700_000_000_000;

function stateWith(sites: BlockedSite[], minutes = 60, theme: Theme = 'auto'): StoredState {
  return {
    ...defaultState(),
    blockedSites: sites,
    settings: { temporaryUnblockMinutes: minutes, theme },
  };
}

function site(hostname: string, kind: 'apex' | 'subdomain', until: number | null = null): BlockedSite {
  return { hostname, kind, temporarilyUnblockedUntil: until };
}

function importOk(json: unknown, current: StoredState) {
  const result = importFromObject(json, current);
  if (!result.ok) throw new Error(`expected import to succeed: ${result.error}`);
  return result;
}

describe('export', () => {
  it('exports hostnames and settings only', () => {
    const file = buildExport(stateWith([site('example.com', 'apex')], 45));
    expect(file).toEqual({
      version: EXTENSION_VERSION,
      blockedHostnames: ['example.com'],
      settings: { temporaryUnblockMinutes: 45, theme: 'auto' },
    });
  });

  it('exports the selected theme', () => {
    const file = buildExport(stateWith([], 60, 'dark'));
    expect(file.settings.theme).toBe('dark');
  });

  it('never exports temporary-unblock state, kinds or rule ids', () => {
    const file = buildExport(stateWith([site('reddit.com', 'apex', NOW + 60_000)]));
    const serialized = JSON.stringify(file);

    expect(file.blockedHostnames).toEqual(['reddit.com']);
    expect(serialized).not.toContain('temporarilyUnblockedUntil');
    expect(serialized).not.toContain('kind');
    expect(serialized).not.toContain('id');
  });

  it('sorts exported hostnames', () => {
    const file = buildExport(stateWith([site('z.com', 'apex'), site('a.com', 'apex')]));
    expect(file.blockedHostnames).toEqual(['a.com', 'z.com']);
  });

  it('serializes to valid JSON text', () => {
    const text = serializeExport(stateWith([site('a.com', 'apex')]));
    expect(JSON.parse(text).blockedHostnames).toEqual(['a.com']);
  });

  it('serializes minified, with no whitespace or trailing newline', () => {
    const text = serializeExport(stateWith([site('a.com', 'apex'), site('b.com', 'apex')], 45));
    expect(text.includes(String.fromCharCode(10))).toBe(false);
    expect(text.includes('  ')).toBe(false);
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
    expect(text.startsWith('{')).toBe(true);
    expect(text.endsWith('}')).toBe(true);
  });
});

describe('round trip', () => {
  it('restores the same blocklist and settings into an empty profile', () => {
    const original = stateWith([site('example.com', 'apex'), site('www.other.com', 'subdomain')], 90);
    const text = serializeExport(original);

    const result = importFromJson(text, defaultState());
    if (!result.ok) throw new Error(result.error);

    expect(result.state.blockedSites.map((s) => s.hostname).sort()).toEqual([
      'example.com',
      'www.other.com',
    ]);
    expect(result.state.settings.temporaryUnblockMinutes).toBe(90);
  });

  it('re-derives the kind of each imported hostname', () => {
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: ['example.com', 'www.example.org'] },
      defaultState(),
    );
    const kinds = Object.fromEntries(result.state.blockedSites.map((s) => [s.hostname, s.kind]));
    expect(kinds['example.com']).toBe('apex');
    expect(kinds['www.example.org']).toBe('subdomain');
  });

  it('starts imported hostnames actively blocked', () => {
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: ['new.com'] }, defaultState());
    expect(result.state.blockedSites[0].temporarilyUnblockedUntil).toBeNull();
  });
});

describe('rejected files', () => {
  it('rejects malformed JSON', () => {
    const result = importFromJson('{not json', defaultState());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('JSON');
  });

  it('rejects a non-object top level', () => {
    expect(importFromObject([1, 2], defaultState()).ok).toBe(false);
    expect(importFromObject('nope', defaultState()).ok).toBe(false);
    expect(importFromObject(null, defaultState()).ok).toBe(false);
  });

  it('rejects a file from a different major version', () => {
    const result = importFromObject(
      { version: '2.0.0', blockedHostnames: ['a.com'] },
      defaultState(),
    );
    expect(result.ok).toBe(false);
    // The message names both versions so the user can tell which is which.
    if (!result.ok) {
      expect(result.error).toContain('2.0.0');
      expect(result.error).toContain(EXTENSION_VERSION);
    }
  });

  it('rejects an older major version too', () => {
    expect(
      importFromObject({ version: '0.9.0', blockedHostnames: ['a.com'] }, defaultState()).ok,
    ).toBe(false);
  });

  it('rejects a missing version', () => {
    expect(importFromObject({ blockedHostnames: [] }, defaultState()).ok).toBe(false);
  });

  it.each(['1', '1.0', 'v1.0.0', '1.2.0-beta.1', '', 1, null, {}])(
    'rejects malformed version %s',
    (version) => {
      const result = importFromObject({ version, blockedHostnames: [] }, defaultState());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('version');
    },
  );

  it('rejects the pre-1.0 schemaVersion format outright', () => {
    // Clean break: files stamped with the old integer `schemaVersion` key carry
    // no `version`, so they are refused rather than silently half-read.
    const result = importFromObject(
      { schemaVersion: 1, blockedHostnames: ['a.com'] },
      defaultState(),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a non-array blockedHostnames', () => {
    const result = importFromObject(
      { version: EXTENSION_VERSION, blockedHostnames: 'example.com' },
      defaultState(),
    );
    expect(result.ok).toBe(false);
  });
});

describe('version compatibility', () => {
  // The rule: only a differing MAJOR indicates a possibly breaking format
  // change, so minor and patch differences must import cleanly in either
  // direction. These pin the rule against the real EXTENSION_VERSION.
  const major = Number(EXTENSION_VERSION.split('.')[0]);

  it.each([`${major}.0.0`, `${major}.99.99`, `${major}.0.1`, `${major}.5.2`])(
    'accepts same-major version %s',
    (version) => {
      const result = importOk({ version, blockedHostnames: ['new.com'] }, defaultState());
      expect(result.summary.added).toEqual(['new.com']);
    },
  );

  it('accepts a file from an older minor and a newer minor alike', () => {
    for (const version of [`${major}.0.0`, `${major}.1000.0`]) {
      expect(importFromObject({ version, blockedHostnames: [] }, defaultState()).ok).toBe(true);
    }
  });

  it('ignores unknown fields from a newer minor version', () => {
    // Forward compatibility within a major is only real if unknown keys are
    // ignored rather than rejected.
    const result = importOk(
      {
        version: `${major}.9.0`,
        blockedHostnames: ['new.com'],
        somethingAddedLater: { nested: true },
        settings: { temporaryUnblockMinutes: 30, futureSetting: 'x' },
      },
      defaultState(),
    );
    expect(result.summary.added).toEqual(['new.com']);
    expect(result.state.settings.temporaryUnblockMinutes).toBe(30);
  });

  it('round-trips its own export', () => {
    const original = stateWith([site('example.com', 'apex')], 45, 'dark');
    const result = importOk(JSON.parse(serializeExport(original)), defaultState());
    expect(result.state.blockedSites.map((b) => b.hostname)).toEqual(['example.com']);
    expect(result.state.settings).toEqual({ temporaryUnblockMinutes: 45, theme: 'dark' });
  });
});

describe('per-entry validation', () => {
  it('rejects invalid hostnames but keeps the valid ones', () => {
    const result = importOk(
      {
        version: EXTENSION_VERSION,
        blockedHostnames: ['good.com', 'localhost', '127.0.0.1', '*.wild.com', 'com', 42],
      },
      defaultState(),
    );

    expect(result.summary.added).toEqual(['good.com']);
    expect(result.summary.rejected).toHaveLength(5);
    expect(result.state.blockedSites.map((s) => s.hostname)).toEqual(['good.com']);
  });

  it('normalizes imported URLs and casing through the same validator', () => {
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: ['HTTPS://WWW.Example.com/path'] },
      defaultState(),
    );
    expect(result.state.blockedSites[0].hostname).toBe('www.example.com');
  });

  it('gives every rejection a reason', () => {
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: ['localhost'] }, defaultState());
    expect(result.summary.rejected[0].reason.length).toBeGreaterThan(0);
  });
});

describe('import is additive and never destructive', () => {
  it('adds to the existing blocklist rather than replacing it', () => {
    const current = stateWith([site('keep.com', 'apex')]);
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: ['new.com'] }, current);

    expect(result.state.blockedSites.map((s) => s.hostname).sort()).toEqual([
      'keep.com',
      'new.com',
    ]);
  });

  it('does not clear the blocklist when the imported list is empty', () => {
    const current = stateWith([site('keep.com', 'apex'), site('www.other.com', 'subdomain')]);
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: [] }, current);

    expect(result.state.blockedSites).toHaveLength(2);
    expect(result.summary.added).toEqual([]);
  });

  it('treats duplicate imported entries as harmless', () => {
    const current = stateWith([site('dup.com', 'apex')]);
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: ['dup.com', 'dup.com'] },
      current,
    );

    expect(result.state.blockedSites).toHaveLength(1);
    expect(result.summary.added).toEqual([]);
    expect(result.summary.duplicates).toEqual(['dup.com', 'dup.com']);
  });

  it('keeps an active temporary exception on an existing duplicate entry', () => {
    const current = stateWith([site('reddit.com', 'apex', NOW + 60_000)]);
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: ['reddit.com'] }, current);

    const reddit = result.state.blockedSites.find((s) => s.hostname === 'reddit.com');
    expect(reddit?.temporarilyUnblockedUntil).toBe(NOW + 60_000);
  });

  it('treats a subdomain already covered by an existing apex as a duplicate', () => {
    const current = stateWith([site('example.com', 'apex')]);
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: ['www.example.com'] },
      current,
    );

    expect(result.summary.added).toEqual([]);
    expect(result.summary.duplicates).toEqual(['www.example.com']);
    expect(result.state.blockedSites).toHaveLength(1);
  });
});

describe('apex consolidation on import', () => {
  it('consolidates existing subdomain entries under an imported apex', () => {
    const current = stateWith([
      site('www.example.com', 'subdomain'),
      site('news.example.com', 'subdomain'),
      site('unrelated.org', 'apex'),
    ]);
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: ['example.com'] }, current);

    expect(result.state.blockedSites.map((s) => s.hostname).sort()).toEqual([
      'example.com',
      'unrelated.org',
    ]);
    expect(result.summary.consolidated.sort()).toEqual(['news.example.com', 'www.example.com']);
  });
});

describe('imported settings', () => {
  it('applies a valid duration for future unblocks', () => {
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: [], settings: { temporaryUnblockMinutes: 120 } },
      stateWith([], 60),
    );
    expect(result.state.settings.temporaryUnblockMinutes).toBe(120);
    expect(result.summary.settingsApplied).toBe(true);
  });

  it('rejects an out-of-range duration and keeps the current setting', () => {
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: [], settings: { temporaryUnblockMinutes: 5000 } },
      stateWith([], 60),
    );
    expect(result.state.settings.temporaryUnblockMinutes).toBe(60);
    expect(result.summary.settingsApplied).toBe(false);
    expect(result.summary.rejected).toHaveLength(1);
  });

  it('applies a valid imported theme', () => {
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: [], settings: { theme: 'dark' } },
      stateWith([], 60, 'light'),
    );
    expect(result.state.settings.theme).toBe('dark');
    expect(result.summary.themeApplied).toBe(true);
  });

  it.each(['neon', '', 'DARK', 42, null])('rejects invalid theme %s', (theme) => {
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: [], settings: { theme } },
      stateWith([], 60, 'light'),
    );
    // The current theme survives an invalid imported value.
    expect(result.state.settings.theme).toBe('light');
    expect(result.summary.themeApplied).toBe(false);
    expect(result.summary.rejected).toHaveLength(1);
  });

  it('keeps the current theme when the file omits it', () => {
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: [] }, stateWith([], 60, 'dark'));
    expect(result.state.settings.theme).toBe('dark');
    expect(result.summary.themeApplied).toBe(false);
  });

  it('round-trips the theme through export and import', () => {
    const text = serializeExport(stateWith([site('a.com', 'apex')], 60, 'dark'));
    const result = importFromJson(text, defaultState());
    if (!result.ok) throw new Error(result.error);
    expect(result.state.settings.theme).toBe('dark');
  });

  it('leaves the setting alone when the file omits it', () => {
    const result = importOk({ version: EXTENSION_VERSION, blockedHostnames: [] }, stateWith([], 30));
    expect(result.state.settings.temporaryUnblockMinutes).toBe(30);
    expect(result.summary.settingsApplied).toBe(false);
  });

  it('does not alter an active exception when applying a new duration', () => {
    const current = stateWith([site('reddit.com', 'apex', NOW + 60_000)], 60);
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: [], settings: { temporaryUnblockMinutes: 240 } },
      current,
    );
    expect(result.state.blockedSites[0].temporarilyUnblockedUntil).toBe(NOW + 60_000);
  });
});

describe('import summary', () => {
  it('summarizes added, duplicate, consolidated and rejected entries', () => {
    const current = stateWith([site('www.example.com', 'subdomain'), site('dup.com', 'apex')]);
    const result = importOk(
      { version: EXTENSION_VERSION, blockedHostnames: ['example.com', 'dup.com', 'localhost'] },
      current,
    );

    const text = describeImport(result.summary);
    expect(text).toContain('1 added');
    expect(text).toContain('1 already blocked');
    expect(text).toContain('consolidated');
    expect(text).toContain('1 rejected');
  });
});

describe('export file name', () => {
  // Date(y, m, d, ...) builds a local-time date, matching the local-time
  // getters exportFileName reads, so these assertions hold in any timezone.
  it('stamps the local date and time as yyyymmddhhmmss', () => {
    expect(exportFileName(new Date(2026, 7, 27, 14, 5, 9))).toBe(
      'stopdrift-blocklist-20260827140509.json',
    );
  });

  it('zero-pads every component', () => {
    expect(exportFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      'stopdrift-blocklist-20260102030405.json',
    );
  });

  it('uses a 24-hour clock so afternoon sorts after morning', () => {
    const morning = exportFileName(new Date(2026, 7, 27, 9, 0, 0));
    const evening = exportFileName(new Date(2026, 7, 27, 21, 0, 0));
    expect(evening).toContain('210000');
    expect(morning < evening).toBe(true);
  });

  it('sorts chronologically as plain strings across a year boundary', () => {
    const stamps = [
      new Date(2027, 0, 1, 0, 0, 0),
      new Date(2026, 11, 31, 23, 59, 59),
      new Date(2026, 7, 27, 14, 5, 9),
    ].map((d) => exportFileName(d));
    expect([...stamps].sort()).toEqual([stamps[2], stamps[1], stamps[0]]);
  });

  it('produces a distinct name for each second', () => {
    const a = exportFileName(new Date(2026, 7, 27, 14, 5, 9));
    const b = exportFileName(new Date(2026, 7, 27, 14, 5, 10));
    expect(a).not.toBe(b);
  });

  it('keeps the .json extension and stopdrift prefix', () => {
    const name = exportFileName(new Date(2026, 7, 27, 14, 5, 9));
    expect(name.startsWith('stopdrift-blocklist-')).toBe(true);
    expect(name.endsWith('.json')).toBe(true);
    expect(/^stopdrift-blocklist-\d{14}\.json$/.test(name)).toBe(true);
  });

  it('defaults to the current time', () => {
    expect(/^stopdrift-blocklist-\d{14}\.json$/.test(exportFileName())).toBe(true);
  });
});
