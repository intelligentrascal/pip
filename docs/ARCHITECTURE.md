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
                 ├── Provider seam ── Allow ── chosen AI provider
                 │                            └── one allowed named backup
                 └── Public research / isolated task Chrome
```

The diagram describes trust boundaries, not blanket proof of every journey.
Native credential entry goes directly to the service, not through the WebKit UI.
Public page content remains untrusted. A proposed action is not permission to
execute it; keep approvals tied to the actual effect and current context.

## Source map

| Directory | Responsibility |
| --- | --- |
| `native/` | AppKit host, native bridge, owned-window probes and dictation boundary |
| `web/` | Bundled panel, projects, provider settings and finite companion motion |
| `runtime/` | Service, persistence, providers, research and browser boundaries |
| `assets/` | Registered companion artwork, vector mark and provenance |
| `scripts/` | Unsigned build, isolated validation and local candidate export |
| `tests/` | Host, native interface and connected UI behavior coverage |
| `tools/` | Disposable native backend fixture |

The unsigned development app points to machine-local dependencies. It is not a
self-contained distribution. Source organization stays stable; publication does
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

The Curious Hearth companion uses registered cropped parts and finite app-owned
motion. Reduced motion has still poses. No sound or account operation is needed
for the companion. Screenshots of the character do not prove native input,
resource usage or private browser integration.

Read [privacy](PRIVACY.md) for storage, sharing and browser handoff limits.
