/**
 * Minimal declarations for the Node built-ins used by tests.
 *
 * The project deliberately keeps `types` limited to chrome + vitest, so
 * @types/node is not installed. Only what tests actually use is declared here.
 */
declare module 'fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
}

declare module 'zlib' {
  export function inflateSync(buf: Uint8Array): Uint8Array;
}
