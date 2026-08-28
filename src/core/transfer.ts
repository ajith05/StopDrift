/**
 * Import/export of the blocklist and settings.
 *
 * Export carries configuration only. Import is strictly additive and treats the
 * file as untrusted: every hostname goes through the same validator used for
 * typed input, and an empty or partly invalid file can never delete entries.
 */
import {
  isValidDuration,
  isValidTheme,
  type BlockedSite,
  type StoredState,
  type Theme,
} from './state.js';
import { parseHostnameInput } from './hostname.js';
import { addToBlocklist } from './blocklist.js';
import { EXTENSION_VERSION, isCompatible, parseVersion } from './version.js';

export interface ExportFile {
  /** The extension version that produced this file. See core/version.ts. */
  version: string;
  blockedHostnames: string[];
  settings: { temporaryUnblockMinutes: number; theme: Theme };
}

/**
 * Serialize configuration. Temporary-unblock timestamps, alarms, DNR rule IDs
 * and all runtime state are deliberately excluded.
 */
export function buildExport(state: StoredState): ExportFile {
  return {
    version: EXTENSION_VERSION,
    blockedHostnames: state.blockedSites.map((s) => s.hostname).sort((a, b) => a.localeCompare(b)),
    settings: {
      temporaryUnblockMinutes: state.settings.temporaryUnblockMinutes,
      theme: state.settings.theme,
    },
  };
}

/**
 * Serialize to minified JSON. The file is machine-written and machine-read; it
 * is not meant to be hand-edited, and importFromObject reports any problem in
 * terms the user can act on rather than by line number.
 */
export function serializeExport(state: StoredState): string {
  return JSON.stringify(buildExport(state));
}

/**
 * Filename for an export, stamped `yyyymmddhhmmss` so repeated exports sort
 * chronologically and never overwrite one another.
 *
 * The stamp is local time: it is read by a human scanning their downloads
 * folder, so it should match the clock on the wall rather than UTC.
 */
export function exportFileName(at: Date = new Date()): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const stamp = [
    pad(at.getFullYear(), 4),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    pad(at.getHours()),
    pad(at.getMinutes()),
    pad(at.getSeconds()),
  ].join('');
  return `stopdrift-blocklist-${stamp}.json`;
}

export interface ImportSummary {
  added: string[];
  duplicates: string[];
  consolidated: string[];
  rejected: { value: string; reason: string }[];
  settingsApplied: boolean;
  themeApplied: boolean;
}

export type ImportResult =
  | { ok: true; state: StoredState; summary: ImportSummary }
  | { ok: false; error: string };

/** Parse and validate an import file, returning the merged state. */
export function importFromJson(text: string, current: StoredState): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  return importFromObject(parsed, current);
}

export function importFromObject(parsed: unknown, current: StoredState): ImportResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The file must contain a JSON object.' };
  }

  const file = parsed as Partial<ExportFile>;

  // Only the major version gates compatibility: a differing minor or patch
  // cannot have broken the format, by the definition of the versioning rule.
  // Unknown fields from a newer minor are ignored rather than rejected, which
  // is what makes that forward compatibility real.
  const fileVersion = parseVersion(file.version);
  if (fileVersion === null) {
    return {
      ok: false,
      error: `Missing or malformed "version". Expected a version like ${EXTENSION_VERSION}.`,
    };
  }

  const appVersion = parseVersion(EXTENSION_VERSION);
  if (appVersion === null) {
    // Unreachable in a real build: the build refuses a non-semver version.
    return { ok: false, error: 'This build has an invalid version.' };
  }

  if (!isCompatible(fileVersion, appVersion)) {
    return {
      ok: false,
      error:
        `This file was exported by version ${file.version}, which is not compatible ` +
        `with version ${EXTENSION_VERSION}. Major versions must match.`,
    };
  }

  if (!Array.isArray(file.blockedHostnames)) {
    return { ok: false, error: '"blockedHostnames" must be an array of hostnames.' };
  }

  const summary: ImportSummary = {
    added: [],
    duplicates: [],
    consolidated: [],
    rejected: [],
    settingsApplied: false,
    themeApplied: false,
  };

  // Work on a copy: existing entries (and their active exceptions) are never
  // dropped, so importing can only ever broaden protection.
  let sites: BlockedSite[] = current.blockedSites.map((s) => ({ ...s }));

  for (const raw of file.blockedHostnames) {
    if (typeof raw !== 'string') {
      summary.rejected.push({ value: String(raw), reason: 'Not a string.' });
      continue;
    }

    const parsedHost = parseHostnameInput(raw);
    if (!parsedHost.ok) {
      summary.rejected.push({ value: raw, reason: parsedHost.message });
      continue;
    }

    const outcome = addToBlocklist(sites, parsedHost.hostname, parsedHost.kind);
    if (outcome.status === 'added') {
      sites = outcome.sites;
      summary.added.push(outcome.hostname);
      summary.consolidated.push(...outcome.consolidated);
    } else {
      // Duplicate, or already covered by a broader apex entry - harmless.
      summary.duplicates.push(parsedHost.hostname);
    }
  }

  const settings = { ...current.settings };
  const importedMinutes = file.settings?.temporaryUnblockMinutes;
  if (importedMinutes !== undefined) {
    if (isValidDuration(importedMinutes)) {
      // Applies to future unblocks only; active exceptions keep their timestamp.
      settings.temporaryUnblockMinutes = importedMinutes;
      summary.settingsApplied = true;
    } else {
      summary.rejected.push({
        value: `temporaryUnblockMinutes: ${String(importedMinutes)}`,
        reason: 'Duration must be a whole number of minutes between 1 and 1440.',
      });
    }
  }

  const importedTheme = file.settings?.theme;
  if (importedTheme !== undefined) {
    if (isValidTheme(importedTheme)) {
      settings.theme = importedTheme;
      summary.themeApplied = true;
    } else {
      summary.rejected.push({
        value: `theme: ${String(importedTheme)}`,
        reason: 'Theme must be one of auto, light or dark.',
      });
    }
  }

  return {
    ok: true,
    state: { schemaVersion: current.schemaVersion, blockedSites: sites, settings },
    summary,
  };
}

export function describeImport(summary: ImportSummary): string {
  const parts = [
    `${summary.added.length} added`,
    `${summary.duplicates.length} already blocked`,
  ];
  if (summary.consolidated.length > 0) {
    parts.push(`${summary.consolidated.length} consolidated under an apex rule`);
  }
  if (summary.rejected.length > 0) parts.push(`${summary.rejected.length} rejected`);
  if (summary.settingsApplied) parts.push('duration setting updated');
  if (summary.themeApplied) parts.push('theme updated');
  return `Import complete: ${parts.join(', ')}.`;
}
