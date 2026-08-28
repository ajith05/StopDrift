/**
 * Canonical hostname parsing, normalization and validation.
 *
 * Every hostname that enters the system - typed by the user in the popup or the
 * options page, or read out of an imported JSON file - passes through
 * `parseHostnameInput`. There is deliberately no second, looser parser.
 */
import { parse } from 'tldts';

/**
 * How a blocklist entry behaves when matching:
 * - `apex`      registrable domain: matches itself and every descendant subdomain
 * - `subdomain` matches that one exact hostname and nothing else
 */
export type HostnameKind = 'apex' | 'subdomain';

export type HostnameRejectionCode =
  | 'empty'
  | 'unsupported-scheme'
  | 'wildcard'
  | 'ip-address'
  | 'single-label'
  | 'special-use'
  | 'public-suffix'
  | 'malformed';

export interface ParsedHostname {
  ok: true;
  /** Canonical ASCII/Punycode hostname, lowercased, no trailing dot. */
  hostname: string;
  kind: HostnameKind;
  /** Registrable domain (eTLD+1) this hostname belongs to. */
  apex: string;
}

export interface RejectedHostname {
  ok: false;
  code: HostnameRejectionCode;
  message: string;
}

export type HostnameResult = ParsedHostname | RejectedHostname;

/** URL schemes we refuse outright when the user supplies one explicitly. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Hostnames that never refer to a public site on the internet. `tldts` treats
 * some of these as ordinary unknown-TLD names, so we reject them explicitly.
 * (RFC 6761 / RFC 8375 special-use names plus Chrome's internal pseudo-hosts.)
 */
const SPECIAL_USE_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'test',
  'invalid',
  'example',
  'onion',
  'home.arpa',
  'arpa',
];

const reject = (code: HostnameRejectionCode, message: string): RejectedHostname => ({
  ok: false,
  code,
  message,
});

/**
 * Strip a scheme/path/query/fragment/port wrapper off the raw input and hand
 * back just the host portion. Uses the URL parser rather than string splitting
 * so credentials, ports and IPv6 brackets are handled correctly.
 */
function extractHostPart(raw: string): HostnameResult | string {
  const input = raw.trim();
  if (input === '') return reject('empty', 'Enter a hostname or URL.');

  // Explicit scheme present: let the URL parser do the work.
  //
  // A scheme must be followed by "//" or a non-digit, otherwise "example.com:8080"
  // would be misread as the scheme "example.com" rather than a host and port.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?=\/\/|[^0-9])/.exec(input);
  if (schemeMatch) {
    const scheme = `${schemeMatch[1].toLowerCase()}:`;
    if (!ALLOWED_SCHEMES.has(scheme)) {
      return reject(
        'unsupported-scheme',
        `Only http and https addresses are supported (got "${schemeMatch[1]}").`,
      );
    }
    try {
      return new URL(input).hostname;
    } catch {
      return reject('malformed', 'That does not look like a valid web address.');
    }
  }

  // No scheme: prepend one so the URL parser can still split host from path.
  try {
    return new URL(`https://${input}`).hostname;
  } catch {
    return reject('malformed', 'That does not look like a valid hostname.');
  }
}

/**
 * Parse arbitrary user input ("reddit.com", "https://www.reddit.com/r/x",
 * "EXAMPLE.com:8080/path") into a canonical blocklist entry.
 */
export function parseHostnameInput(raw: string): HostnameResult {
  if (typeof raw !== 'string') {
    return reject('malformed', 'That does not look like a valid hostname.');
  }

  // Reject wildcards before parsing: "*.example.com" would otherwise be
  // percent-encoded into a confusing hostname by the URL parser.
  if (raw.includes('*')) {
    return reject(
      'wildcard',
      'Wildcards are not supported. Block the apex domain to cover every subdomain.',
    );
  }

  const extracted = extractHostPart(raw);
  if (typeof extracted !== 'string') return extracted;

  // The URL parser lowercases and Punycodes the host for us; drop the optional
  // trailing DNS root dot so "example.com." and "example.com" are one entry.
  let host = extracted.toLowerCase().replace(/\.+$/, '');
  if (host === '') return reject('empty', 'Enter a hostname or URL.');

  const info = parse(host, { allowPrivateDomains: false, detectIp: true });

  if (info.isIp || /^\[.*\]$/.test(host)) {
    return reject('ip-address', 'IP addresses are not supported. Use a domain name.');
  }

  // Special-use and public-suffix names are checked before the generic
  // structural checks so each rejection reports the most specific reason.
  if (SPECIAL_USE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    return reject('special-use', `"${host}" is a local or special-use name, not a public website.`);
  }

  // A single label that is not a real public suffix ("intranet") is reported as
  // such; "com" and "org" are single labels too, but they fall through to the
  // public-suffix branch below because the PSL actually recognizes them.
  if (!host.includes('.') && !info.isIcann) {
    return reject(
      'single-label',
      `"${host}" is not a public domain name. Use a full hostname such as example.com.`,
    );
  }

  // A bare public suffix ("com", "co.uk") has no registrable domain of its own.
  if (info.publicSuffix === host) {
    return reject(
      'public-suffix',
      `"${host}" is a public suffix, not a website. Try example.${host} instead.`,
    );
  }

  const labels = host.split('.');
  if (labels.some((label) => label === '' || label.length > 63)) {
    return reject('malformed', 'That hostname has an empty or over-long label.');
  }
  if (host.length > 253) {
    return reject('malformed', 'That hostname is too long.');
  }
  // Post-Punycode a hostname may only contain letters, digits and hyphens, and
  // no label may start or end with a hyphen.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) || labels.some((l) => /^-|-$/.test(l))) {
    return reject('malformed', 'That hostname contains characters that are not allowed.');
  }

  if (!info.domain || !info.publicSuffix) {
    return reject('malformed', `"${host}" does not use a recognized public domain suffix.`);
  }

  return {
    ok: true,
    hostname: host,
    kind: host === info.domain ? 'apex' : 'subdomain',
    apex: info.domain,
  };
}

/** Human-readable description of what a given entry will block. */
export function describeScope(kind: HostnameKind, hostname: string): string {
  return kind === 'apex'
    ? `This will block ${hostname} and all of its subdomains.`
    : 'This will block only this exact hostname.';
}
