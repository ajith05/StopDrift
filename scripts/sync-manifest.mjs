/**
 * Copies the version from package.json into public/manifest.json.
 *
 * package.json is the single source of truth for the version, but Chrome reads
 * it from the manifest, so the number has to be repeated there. This script is
 * wired to npm's `version` lifecycle hook, which runs after npm has written the
 * new number and before the commit, so a bump updates both files together.
 *
 * scripts/build.mjs still verifies the two agree and fails the build if they do
 * not. That check is deliberately independent of this script: it is what makes a
 * mismatch impossible to ship, whether or not the bump went through npm.
 *
 * Only the version line is rewritten, rather than re-serialising the parsed
 * JSON, so the manifest's formatting and key order survive untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'public/manifest.json');

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package.json version "${version}" is not MAJOR.MINOR.PATCH.`);
  process.exit(1);
}

const manifest = readFileSync(manifestPath, 'utf8');
const current = JSON.parse(manifest).version;

if (current === version) {
  console.log(`public/manifest.json is already at ${version}.`);
  process.exit(0);
}

// Anchored to the top-level "version" key. No other key ends in `version`, and
// the value is matched as a version literal, so this cannot hit
// manifest_version or minimum_chrome_version.
const pattern = /^(\s*"version":\s*")\d+\.\d+\.\d+(",?)$/m;

if (!pattern.test(manifest)) {
  console.error(`Could not find a "version" line to update in public/manifest.json.`);
  process.exit(1);
}

const updated = manifest.replace(pattern, `$1${version}$2`);

// Re-parse rather than trusting the regex: proves the file is still valid JSON
// and that the value landed where it was meant to.
if (JSON.parse(updated).version !== version) {
  console.error('Rewriting public/manifest.json did not produce the expected version.');
  process.exit(1);
}

writeFileSync(manifestPath, updated);
console.log(`public/manifest.json ${current} -> ${version}.`);
