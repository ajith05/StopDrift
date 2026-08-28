# StopDrift

A local-only Chrome website blocker that makes impulsive browsing inconvenient on purpose.

Block a site and it stays blocked. Unblocking it — even temporarily — requires typing an exact
sentence by hand. Removing a block permanently requires typing a long paragraph. There is no
pause button, no global off switch, and nothing to click your way past in a moment of weakness.

**Everything happens on your own machine.** No account, no server, no sync, no analytics, no
network requests of any kind.

---

## Install (5 minutes)

You do not need to know TypeScript or how extensions work. You need
[Node.js](https://nodejs.org) 18 or newer (`node --version` to check) and Chrome 123 or newer.

**1. Get the code** — either way works.

*Download a ZIP (no extra tools needed):* on the
[project page](https://github.com/ajith05/StopDrift), click the green **Code** button, choose
**Download ZIP**, then unzip it. On Windows, right-click the file and choose *Extract All* —
don't just open the ZIP and run from the preview window, or the build will fail.

*Or clone it,* if you have [git](https://git-scm.com) and want to pull updates later:

```bash
git clone https://github.com/ajith05/StopDrift.git
```

**2. Build it.** Open a terminal in the project folder — the one containing `package.json` — and
run:

```bash
npm install
npm run build
```

These two commands are identical on Windows, macOS and Linux, and work in PowerShell, Command
Prompt and any POSIX shell. Every script is plain Node with no platform-specific shell steps.

This creates the `dist/` folder that you load into Chrome. `dist/` is generated — it is not in the
repository or the ZIP, so you build it yourself.

Then load it into Chrome:

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the **`dist/`** folder inside this project.
5. StopDrift appears in your extensions list and toolbar.

To pin it to the toolbar, click the puzzle-piece icon in Chrome and pin StopDrift.

### After changing the code

Run `npm run build` again, then click the **reload icon** on the StopDrift card at
`chrome://extensions`.

### Blocking in Incognito

Blocking does not apply to Incognito windows unless you allow it:

1. Go to `chrome://extensions`.
2. Click **Details** on StopDrift.
3. Turn on **Allow in Incognito**.

The popup and options page show whether this is currently enabled.

Once enabled, Chrome runs StopDrift as two separate processes - one for regular
windows, one for Incognito - that share a blocklist but not much else. StopDrift
bridges them, so a site you block in a regular window is blocked in an
already-open Incognito window too, and the other way round. That covers tabs
already sitting on the site as well as new navigations.

---

## How to use it

**Popup** (click the toolbar icon): block the site you are currently on with one click, add a
site by hand, see how many sites are blocked, open the full management page.

**Options page** (the "Manage blocklist" button): everything else — the full list, temporary
unblocks, permanent removal, the duration setting, and import/export.

### Apex domains vs. exact subdomains

This distinction matters, so the popup always previews what will happen before you commit:

| You enter | What gets blocked |
|---|---|
| `example.com` | `example.com` **and every subdomain** (`www.`, `foo.`, `a.b.`, …) |
| `www.example.com` | **only** `www.example.com` — not `example.com`, not `foo.example.com` |
| `https://example.com/some/path` | `example.com` and all subdomains (path is discarded) |

`www` is treated as an ordinary subdomain and gets no special handling. Subdomain rules are
exact-host rules, so blocking `foo.example.com` does **not** block `bar.foo.example.com`.

Domains with multi-part suffixes are handled correctly via the Public Suffix List:
`example.co.uk` is an apex domain, not a subdomain.

### Blocking the site you are on

The top of the popup offers a **Block this site** button for the tab you are currently viewing.
It is a shortcut, not a separate feature: it offers exactly the hostname you would get by typing
that page's URL into the box below it, shows the same preview, and goes through the same add.

The hostname offered is the tab's exact hostname. On `https://news.ycombinator.com/item?id=1`
the button offers `news.ycombinator.com` as an exact-subdomain block — never the apex — so the
shortcut can't quietly block more than the page you are looking at. If you want the whole apex,
type it in the box.

The button is replaced by a short explanation when there is nothing to offer: on `chrome://`
pages, the extension's own pages and `file://` URLs; on hosts that can't be blocked at all
(IP addresses, `localhost`); and on sites already covered, in which case it names the entry
covering them. A site with an active temporary unblock counts as already blocked — use **Block
Now** on the options page to end the exception early.

Reading the current tab's URL for this needs no extra permission (see
[Permissions](#permissions-and-why-each-is-needed)), and the URL is never stored or transmitted.

### Redundant entries

- Adding a site that is already listed is rejected as a duplicate.
- Adding `www.example.com` when `example.com` is already blocked is rejected as redundant.
- Adding `example.com` when `www.example.com` and `news.example.com` are listed **adds the apex
  and removes the two now-redundant entries**. This needs no challenge, because protection is
  becoming broader, not weaker.

### Temporary unblocking

In the options page, click **Temporarily unblock** and type, exactly:

```
I want to unblock example.com. I am really sure.
```

Capitalization, punctuation and spacing must match exactly. One wrong character clears the whole
field and you start again. Pasting and drag-and-drop are disabled.

The default duration is **60 minutes** (configurable, 1–1440). Changing the setting later never
affects an exception that is already running — each exception stores its own absolute expiry time.

To end an exception early, click **Block now**. That requires no challenge — blocking is always easy.

### Permanent removal

There is no separate "unblock forever". Permanently unblocking a site *is* deleting it from the
blocklist, and **Remove** is the only way to do it. It opens a long paragraph you must type in
full, with the same strict rules. There is no trash icon, no edit field and no bulk delete.

To change the wording, edit `PERMANENT_UNBLOCK_TEMPLATE` in
[`src/core/templates.ts`](src/core/templates.ts) and rebuild. `{hostname}` is substituted with the
site being removed. Nothing else needs to change.

### Theme

The options page has an **Appearance** setting with three choices:

- **Auto (follow device)** — the default. Follows your operating system's light/dark setting and
  changes with it live.
- **Light**
- **Dark**

The choice applies to every extension page — popup, options and the block page — and is included
in export/import.

### Import / export

**Export** writes `stopdrift-blocklist-<yyyymmddhhmmss>.json` (for example
`stopdrift-blocklist-20260827140509.json`, stamped with your local time) containing only your
hostnames, duration setting and theme.
Temporary unblocks, alarms and rule IDs are never exported.

**Import is additive.** It only ever adds; it never deletes. An empty imported list does not clear
anything, duplicates are harmless, existing active exceptions are preserved, and every hostname is
validated exactly as if you had typed it. You get a summary of what was added, skipped,
consolidated and rejected.

```json
{
  "version": "1.0.0",
  "blockedHostnames": ["example.com", "www.reddit.com"],
  "settings": { "temporaryUnblockMinutes": 60, "theme": "auto" }
}
```

**Version compatibility.** An export is stamped with the extension version that produced it. On
import, only the **major** version has to match — a file from `1.0.0` imports into `1.4.2` and
vice versa, because by the versioning rule below only a major change can break the format. A
file from a different major version is refused with a message naming both versions.

---

## Privacy

StopDrift stores only what it needs to work: your blocked hostnames, each one's temporary-unblock
expiry (when active), your duration setting and your theme choice.

It does **not** record browsing history, attempted visits, block counts, last-visit times,
unblock history, or full URLs. There is no telemetry, no analytics SDK, no account, no cloud sync
and no tracking of any kind.

The extension reads open tab URLs in one situation only — to decide whether a currently open tab
must be redirected when a site becomes blocked. Those URLs are used in memory and never stored or
sent anywhere. The block page is told only *which blocklist entry* triggered it, never the URL you
tried to visit.

You can confirm the no-network claim yourself: open DevTools on the service worker and the
Network tab stays empty. The Public Suffix List is bundled into the build at compile time.

### Permissions, and why each is needed

| Permission | Why |
|---|---|
| `declarativeNetRequestWithHostAccess` | Redirect blocked navigations to the block page. Chrome evaluates these rules itself; the extension never sees your requests. |
| `host_permissions` for `http://*/*`, `https://*/*` | DNR **redirect** rules require host access for the sites they act on. Since you choose what to block, that has to be all sites. Also what lets StopDrift redirect an already-open tab. |
| `storage` | Save your blocklist and settings locally. |
| `alarms` | Wake the extension when a temporary unblock expires. |

Not requested: `tabs` (broad host access already covers reading the http/https tab URLs needed for
enforcement), and there are no content scripts.

---

## Development

```bash
npm install      # install dependencies
npm run build    # build dist/
npm test         # run the automated test suite once
npm run test:watch # re-run tests on change
npm run dev      # rebuild on change
npm run typecheck # TypeScript check with no emit
npm run icons    # regenerate the PNG icons
```

### Project structure

```
src/
  core/                 pure logic, no Chrome APIs - this is what the tests cover
    hostname.ts         parse/normalize/validate input (tldts + Public Suffix List)
    matching.ts         THE canonical matcher used by both DNR and tab enforcement
    blocklist.ts        duplicate/redundancy/consolidation rules
    challenge.ts        THE canonical typing-challenge validator
    templates.ts        challenge wording (PERMANENT_UNBLOCK_TEMPLATE lives here)
    state.ts            storage schema + defensive normalization
    exceptions.ts       expiry sweeping and next-alarm selection
    rules.ts            state -> DNR rules (deterministic)
    transfer.ts         import validation / export building
    messages.ts         local motivational statements
    protocol.ts         UI <-> service worker message contract
    sync.ts             cross-process (split-incognito) propagation decisions
    current-tab.ts      what the popup's "block this site" button offers
  background/           Chrome adapters
    service-worker.ts   the single coordinator for all state changes
    storage.ts  dnr.ts  alarms.ts  tabs.ts
  shared/theme.ts       theme application, shared by all four pages
  ui/                   popup + options pages
    popup.ts options.ts the two page entry points
    challenge-widget.ts shared typing challenge (paste/drop prevention)
    messaging.ts        typed wrapper for talking to the service worker
  blocked/blocked.ts    the block page
public/                 manifest.json, HTML, CSS, icons (copied to dist/ as-is)
tests/                  automated tests
```

### Versioning

This project uses [semantic versioning](https://semver.org), where **the major version means
export-format compatibility**:

- **MAJOR** — a previously valid export file would no longer import. Bumping this is a deliberate
  statement that old files are refused.
- **MINOR** — functionality added, format still backward compatible.
- **PATCH** — fixes only.

A change that leaves the export format intact is never a major bump, however large it is
otherwise — a UI rewrite is a minor release. This is what makes the import rule meaningful:
imports are gated on the major version alone.

`package.json` is the single source of truth. The version is injected into the bundle at build
time, and the build **fails** if `public/manifest.json` disagrees, so the two cannot drift. To
release, update the version in both files.

Chrome's manifest accepts one to four dot-separated integers (0–65535) and rejects SemVer
pre-release suffixes, so `1.2.0-beta.1` is not a usable extension version.

**Storage versioning is separate.** `SCHEMA_VERSION` in
[`src/core/state.ts`](src/core/state.ts) versions the `chrome.storage.local` shape and is an
integer unrelated to the extension version — it may stay at `1` while the extension reaches `3.x`.
It is currently written but never read, because `normalizeState` validates every field on its own
merits and so absorbs added or removed fields without needing a version. It would **not** absorb a
semantic change (a field keeping its type but changing meaning); the comment on that constant
explains what to build when that day comes.

**Architecture.** `chrome.storage.local` is the single source of truth. DNR rules and the
expiration alarm are *derived* state, rebuilt from storage whenever anything changes — so they are
always reconstructible and any drift self-heals. All mutations go through the service worker, so
no two pages can write inconsistent state.

---

## Testing

### Automated

```bash
npm test
```

The suite covers hostname parsing and validation, apex vs. exact-subdomain matching, DNR rule
generation, redundancy/consolidation, the typing challenges (pure logic *and* DOM behavior),
temporary-exception expiry and alarm selection, storage normalization of corrupt data,
theme selection/persistence, import/export, what the popup's block-current-tab button offers for a
given URL, and that concurrent ruleset rebuilds are serialized rather than colliding on rule IDs.

**What automated tests do and do not prove.** They cover this project's own logic, including a
local model of Chrome's `|...^` URL-filter syntax that verifies the exact-host filters we generate.
They run against an in-memory fake of the Chrome APIs, so they do **not** prove how Chrome itself
matches rules, delays alarms, or handles navigation history. Those need the manual checks below.

### Manual checklist (in Chrome)

This is a release checklist, not a list of outstanding work. These are the behaviors that only
Chrome itself can confirm, so they are re-run by hand before a release rather than left undone.
Nothing in this list has been verified by automation.

**Blocking basics**

1. Load `dist/` unpacked; the popup opens without errors.
2. Add `example.com`; the preview says apex + all subdomains.
3. Navigate to `http://example.com` → redirected to the block page.
4. Navigate to `https://www.example.com` and `https://foo.example.com` → both redirected.
5. Add `www.wikipedia.org`; the preview says exact hostname only.
6. `https://www.wikipedia.org` is blocked, but `https://wikipedia.org` and
   `https://en.wikipedia.org` are **not**.
7. Try a non-default port (`https://example.com:8443`) → still blocked.

**Open tabs**

8. Open a site, then block it from the popup → the open tab redirects immediately.
9. With `www.example.com` and `news.example.com` blocked and tabs open on both, add `example.com`
   → both entries consolidate and both tabs redirect.

**Block page**


10. The block page shows the blocking rule and a random message that varies between visits.
11. **Go back** returns to the previous page and does not bounce back into a redirect loop.
12. Type a blocked URL directly in the address bar, then Go back → lands somewhere harmless
    (`about:blank` if there is no prior history).
13. Open a blocked link in a new tab, then Go back → no loop.
14. Press Back repeatedly on a blocked site → no loop.
15. Check a site that redirects HTTP → HTTPS, and one that redirects itself.

**Temporary unblock**


16. Attempt to paste into the challenge field → rejected.
17. Attempt to drag text into it → rejected.
18. Type one wrong character → the whole field clears with "Typing error — start again."
19. Type it correctly → the confirm button enables and names the configured duration.
20. Confirm → the site loads normally.
21. Click **Block now** → the site is blocked again immediately, including any open tab.
22. Start a 1-minute exception and wait → blocking restores automatically, and an open tab on the
    site is redirected when it expires.
23. Start a 60-minute exception, then change the duration setting to 240 → the active exception
    still expires at its original time.

**Permanent removal**


24. Confirm the only removal route is **Remove** — no trash icon, no edit field, no bulk delete.
25. Paste into the paragraph field → rejected; a typo clears the whole field.
26. Removal happens only after the complete paragraph plus an explicit click.

**Persistence**


27. Restart Chrome → the blocklist and settings survive.
28. Start a short exception, quit Chrome, wait past the expiry, reopen → the site is blocked again
    immediately (the stored timestamp is authoritative, so sleeping through an expiry does not
    extend it).

**Import/export and privacy**


29. Export → the JSON contains no timestamps or rule IDs.
30. Import a file with an extra hostname → it is added and nothing is deleted.
31. Import an empty list → nothing is deleted.
32. Import a file containing an apex over existing subdomains → they consolidate, and matching
    open tabs redirect.
33. Import malformed JSON, a file from a different major version, a missing `version`, and an
    invalid hostname → each is refused with a clear message and no state change.
34. Enable **Allow in Incognito** and confirm blocking works there; the status line updates.
35. In an Incognito window, visit a blocked site and confirm the **block page itself renders**
    (not just a failed navigation or an error page).
36. With an Incognito window open on a not-yet-blocked site, block that site from a **regular**
    window → the open Incognito tab is redirected, and a fresh navigation there is blocked too.
37. Reverse it: block a site from Incognito and confirm a regular window picks it up.
38. Permanently remove a block in one window → the other stops blocking it without a reload of
    the extension.
39. Repeat check 36 after clicking **stop** on the Incognito service worker in `chrome://extensions`,
    to confirm the change still wakes it.

**Blocking the current tab**

40. On an ordinary site, open the popup → it names that site with the right scope; click
    **Block this site** → the tab redirects to the block page.
41. Reopen the popup on that site → the button is gone and the card says it is already blocked.
42. Open the popup on a subdomain of an apex you have blocked → it says it is already blocked and
    names the apex entry.
43. Open the popup on `chrome://extensions`, on the block page itself, and on
    `http://localhost:3000` → each shows an explanation instead of a button, and nothing crashes.
44. Repeat check 40 in an Incognito window.
45. Open the popup on a site with an active temporary unblock → it reports it as already blocked
    rather than offering to add it again.
46. Open DevTools on the service worker → the Network tab stays empty during normal use.

**Theme**


47. Set the theme to Dark → the options page, popup and block page all render dark.
48. Set it to Light on a device set to dark mode → the extension stays light (explicit wins).
49. Set it to Auto, then flip the OS light/dark setting → the pages follow it.
50. Export, then import into a fresh profile → the theme comes across.
51. Import a file with `"theme": "neon"` → rejected with a message; the current theme is kept.

---

## Known Chrome behaviors and limitations

- **Dynamic rule updates cannot overlap.** Rebuilding the ruleset reads the current rules and then
  replaces them. Chrome rejects an update that adds a rule ID already present, so two rebuilds
  running at once fail with *"Rule with id 1 does not have a unique ID."* Several triggers are
  fire-and-forget and can land in the same tick — the expiry alarm, a storage change from the other
  process, a fresh worker activation, a popup command — so `syncRules` in
  [dnr.ts](src/background/dnr.ts) queues rebuilds onto a single chain. Rebuilds are deterministic
  and replace the ruleset wholesale, so ordering within the queue does not matter.

- **Go back lands on `about:blank` when there is no history.** **Go back** steps back through the
  tab's own history, so it returns to whatever preceded the blocked navigation — including the new
  tab page, if that is the previous entry. Only when there is nothing to step back to (the blocked
  page is the tab's first entry, as when a blocked link opens in a new tab) does it fall back to
  `about:blank`. An extension page cannot navigate the tab to `chrome://newtab/` directly, so
  `about:blank` is the neutral landing spot in that case.
- **Incognito requires `"incognito": "split"`.** Under the default `spanning` mode the extension
  has no renderer process in the Incognito profile, so its own pages cannot be instantiated there:
  DNR rules still fire (the site is blocked) but `blocked.html` fails with
  `ERR_BLOCKED_BY_CLIENT`, whether reached by redirect or typed directly into the address bar.
  `split` gives Incognito its own extension process that can render the page.
  `chrome.storage.local` is shared between the regular and Incognito processes, so the blocklist
  itself needs no bridging. Everything *derived* from it does: each process has its own DNR
  ruleset and can only see its own tabs, and a message from a popup reaches only that popup's
  process. StopDrift bridges them with a `chrome.storage.onChanged` listener - it fires in both
  processes, so each rebuilds its own rules and re-checks its own tabs from shared storage. The
  rebuild deliberately does not write storage unless something actually changed, since that would
  retrigger the same listener. The block page and its subresources (`blocked.js`, `styles.css`)
  are also declared web-accessible with `use_dynamic_url: false`.
- **Alarms can be delayed.** Chrome may hold alarms while the machine sleeps, and MV3 service
  workers are ephemeral. The stored absolute timestamp is authoritative: an exception that lapsed
  during sleep is simply expired on wake, never extended. The extension re-checks and repairs its
  state on every startup, alarm and service-worker revival, so a lost or late alarm self-corrects.
- **Chrome pages cannot be blocked.** DNR does not apply to `chrome://` pages, the Web Store, or
  other extensions' pages. Only `http`/`https` navigations are blockable.
- **Rule quota.** Chrome caps dynamic DNR rules (30,000 at the time of writing). An apex block
  costs one rule and an exact-subdomain block costs two. If Chrome rejects an update, the error is
  surfaced and stored state is left untouched rather than corrupted.
- **This is friction, not security.** Anyone who controls Chrome can disable or uninstall the
  extension, or edit an unpacked extension with DevTools. That is out of scope by design. The goal
  is to make an impulsive detour inconvenient enough that your earlier deliberate decision wins.

## License

[MIT](LICENSE) - free to use, modify and distribute, with no warranty.
