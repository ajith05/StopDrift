/**
 * Semantic versioning for the export format.
 *
 * The extension version is a semver string that lives in exactly one place -
 * package.json - and is injected at build time (see scripts/build.mjs). The
 * manifest is checked against it during the build, so the two can never drift.
 *
 * The major version means export-format compatibility, and nothing else. It is
 * bumped only when a previously valid export file would no longer import
 * correctly; a change of any size that leaves the format intact is a minor or
 * patch release. That is what makes the import rule below meaningful.
 *
 * This is deliberately NOT the same thing as the storage schema version. See
 * SCHEMA_VERSION in state.ts.
 */

/**
 * Injected by esbuild from package.json. Declared rather than imported so the
 * bundle never reaches for package.json at runtime.
 */
declare const __EXTENSION_VERSION__: string;

export const EXTENSION_VERSION: string = __EXTENSION_VERSION__;

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse `MAJOR.MINOR.PATCH`, or null if the value is not exactly that.
 *
 * Strict on purpose: this validates untrusted file content, so anything with a
 * pre-release suffix, extra parts, missing parts, leading `v`, or non-numeric
 * components is rejected rather than guessed at. Chrome's manifest rejects
 * pre-release suffixes too, so a released version can always parse here.
 */
export function parseVersion(value: unknown): SemVer | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Whether a file with version `fileVersion` can be imported by this build.
 *
 * Only the major version is compared. Minor and patch differences are
 * compatible in both directions: a file from an older build imports into a
 * newer one, and vice versa. Forward compatibility within a major version is
 * only real if unknown fields are ignored, which importFromObject does.
 */
export function isCompatible(fileVersion: SemVer, appVersion: SemVer): boolean {
  return fileVersion.major === appVersion.major;
}
