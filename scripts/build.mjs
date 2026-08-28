/**
 * Builds a clean, loadable unpacked extension into dist/.
 *
 * Bundles every entry point with esbuild (all dependencies inlined - nothing is
 * fetched at runtime) and copies the static files from public/.
 */
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, watch as watchDir } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'dist');
const watch = process.argv.includes('--watch');

/**
 * package.json is the single source of truth for the version. The manifest has
 * to repeat it because Chrome reads it from there, so verify the two agree and
 * fail loudly rather than shipping a build whose export files are stamped with
 * a different version than the extension reports.
 */
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const version = readJson('package.json').version;
const manifestVersion = readJson('public/manifest.json').version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package.json version "${version}" is not MAJOR.MINOR.PATCH.`);
  process.exit(1);
}

if (version !== manifestVersion) {
  console.error(
    `Version mismatch: package.json is ${version} but public/manifest.json is ${manifestVersion}.` +
      ' Update both to the same value.',
  );
  process.exit(1);
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const options = {
  entryPoints: {
    'service-worker': join(root, 'src/background/service-worker.ts'),
    popup: join(root, 'src/ui/popup.ts'),
    options: join(root, 'src/ui/options.ts'),
    blocked: join(root, 'src/blocked/blocked.ts'),
  },
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome123',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  minify: true,
  logLevel: 'info',
  define: { __EXTENSION_VERSION__: JSON.stringify(version) },
};

function copyStatic() {
  // manifest.json, HTML, CSS and icons ship as-is.
  cpSync(join(root, 'public'), outdir, { recursive: true });
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  copyStatic();

  // esbuild only watches the TypeScript graph. Without this, edits to
  // manifest.json, the HTML or the CSS would silently never reach dist/.
  let pending;
  watchDir(join(root, 'public'), { recursive: true }, (_event, file) => {
    // Debounce: editors often emit several events for one save.
    clearTimeout(pending);
    pending = setTimeout(() => {
      copyStatic();
      console.log(`Copied public/ after change to ${file ?? 'a static file'}.`);
    }, 50);
  });

  console.log('Watching src/ and public/. Reload the extension in chrome://extensions after each build.');
} else {
  await build(options);
  copyStatic();
  console.log('Built dist/ - load it via chrome://extensions > Load unpacked.');
}
