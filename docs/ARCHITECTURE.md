# Architecture

Pip keeps the native window, the web interface and the local service separate.

```text
AppKit floating panel / menu bar      Native secure provider entry
                 │                                   │
          Bundled WebKit UI                          │
                 │ reviewed messages                 │
                 └───── Private-pipe Node service ────┘
                                (one writer)
                 ├── SQLite application state + backups
                 ├── Separate private credential file
                 ├── One pi-durable conversation per ask ── Allow ── chosen AI provider
                 │     (every ability is a tool;        └── one allowed named backup
                 │      events survive a restart)
                 └── Public research / isolated task Chrome
```

The diagram describes trust boundaries, not blanket proof of every journey.
Native credential entry goes directly to the service, not through the WebKit UI.
Each ask is one pi-durable conversation of at most 24 model turns and ten minutes;
its abilities are tools, and its event stream is kept across a restart. What you ask
for runs at once; one before-tool check (`runtime/pause.ts`) pauses Pip only before
a send, payment, publication or deletion that your own message did not ask for. Those
four kinds are separate named tools so the check can see them; a step run through a
general-purpose tool would be invisible to it, so new abilities of those kinds must be
added as their own named tools. Every effect is recorded in the ledger before the Mac
is asked, and one whose outcome is never confirmed stays Unknown and is not repeated.
Public page content remains untrusted evidence: it can never ask for a step, which is
why a step it suggests is paused. Changes to Pip's own memory still wait for your
approval by name, tied to the exact change.

## Mac abilities as tools

Every Mac ability joins the one conversation as a tool (`runtime/mac-tools.ts`):

- **Files and shell** are pi-durable 1.4's own `read`, `write`, `edit` and `bash` tools.
  Relative paths and shell commands start at your home folder; in tests they stay inside
  the isolated test home.
- **Browser, clicks and typing** come from the installed Playwright MCP server;
  **screen and Mac control** from Peekaboo's; **AppleScript and app automation** from
  the Automator MCP server. Each package is pinned in `package.json`, starts with Node
  from Pip's own `node_modules`, and speaks one MCP stdio adapter (`runtime/mcp.ts`).
  Its tool schemas pass through unchanged, prefixed with the server's name.
- **Saved integrations** are the axi command-line tools, found on `PATH` and run with
  their arguments. A tool that is missing or cannot start says so plainly; none of
  them asks for a password or a key.

A server that will not start registers one plainly-worded tool instead, so the model
can report the gap. A general-purpose tool (the shell, a browser form) can reach an
outward step without its name, which the accepted plan trades away: the four named
tools and the pause rule remain for the kinds the check can see.

## Mac permissions asked once at setup

Setup asks macOS once, in order, for all six permissions Pip's abilities need:
accessibility, screen recording, automation (Apple Events), Full Disk Access,
microphone and notifications. The order and the plain words live in
`native/PermissionsSetup.swift`; each ask shows its own system prompt or opens its own
System Settings pane, and only you can grant or revoke. The answers are recorded in
`permissions.json` inside Pip's home, live checks that cannot prompt are refreshed on
every view of the panel, and Pip never re-asks what it has already asked.

## Source map

| Directory | Responsibility |
| --- | --- |
| `native/` | AppKit host, native bridge, owned-window probes and dictation boundary |
| `web/` | Bundled Lantern chat window, answer parts, projects, provider settings, Pip's movement and the Magic effects layer |
| `runtime/` | Service, persistence, providers, research and browser boundaries |
| `assets/` | Registered companion artwork, vector mark and provenance |
| `scripts/` | Developer and release builds, local packaging, the update feed tool, isolated validation and local candidate export |
| `tests/` | Host, native interface and connected UI behavior coverage |
| `tools/` | Disposable native backend fixture |

The unsigned developer build points to machine-local dependencies. `python3 scripts/release.py package`
instead builds a self-contained Apple-silicon app with its own Node runtime and only the production
dependencies, and Pip menu > Check for Updates… can replace it from a signed feed
([releasing](RELEASING.md)); none of that is signed, notarized or published yet. Source organization stays stable; publication does
not require a cosmetic directory migration.

## Context and continuity

A follow-up uses a bounded snapshot of the selected result, not whichever job ran
most recently. Project context is explicitly selected by revision; a reference
pin does not grant access. Restarted unfinished work waits for reviewed Continue.
No uncertain action should replay automatically. These boundaries do not imply
unlimited reliable automation or automatic project memory.

Window-context attachment boundaries exist, but capture and live understanding
are unfinished or unproved. See [status](STATUS.md) rather than assuming that a
schema or diagram establishes a completed feature.

## ChatGPT plan access

The native Continue with ChatGPT control opens only OpenAI’s authorization page
in the system browser. An app-owned host identity survives restarts/reconnects;
signed identity and account-model checks precede credential saving. The service
uses the public Responses API and private streaming with the same app-owned tools.
After partial progress, it does not restart the request on a backup. Eligibility
and allowance belong to OpenAI; a connected status alone is not live proof.

Provider cancellation checks are repaired in merged source. The credential file
store follows the pinned engine contract: a no-change update keeps and returns the
saved credential, and only Remove deletes it. See [status](STATUS.md).

## Motion and accessibility

The Curious Hearth companion uses registered cropped parts. A waiting Pip moves with
CSS animations and asks the page for no script frames; the pointer feed (a 60 Hz
native poll that sends only changed positions, only while Pip is on screen) moves his
eyes, head and scrolls, and the Magic effects layer (`web/magic.js`) draws a
Canvas 2D effect at the chosen level. Reduced motion has still poses and no effects.
No sound or account operation is needed for the companion. See [Magic](MAGIC.md).
Screenshots and recordings of the character do not prove native input, resource
usage under other apps' load or private browser integration.

Read [privacy](PRIVACY.md) for storage, sharing and browser handoff limits.
