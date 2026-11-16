# Changelog

## 0.1.0-alpha.1

The first public alpha: a signed, notarized, self-contained Apple-silicon Mac app, a
Homebrew cask (`intelligentrascal/tap/pip-house-elf`) and in-app updates from a signed
feed. It is experimental. Intel Macs are not supported and macOS older than 26 is untested.

### A self-contained Mac app with in-app updates

- `python3 scripts/release.py package` builds an Apple-silicon `Pip.app` that carries its own
  Node runtime and production dependencies and names nothing on the machine that built it,
  then makes the ZIP, a drag-to-Applications DMG, checksums and a manifest. `verify`
  checks downloads the way a Mac receives them; `cask` writes the Homebrew Cask file.
- Pip menu > Check for Updates… reads an Ed25519-signed feed and, only after you choose
  Download and restart, checks the download's size and SHA-256, replaces the app and
  reopens it, putting the old app back if the new one does not start. A Homebrew copy is
  updated by Homebrew. Saved work is never touched. Nothing is checked in the background.
- Signed with a Developer ID, then notarized and stapled by Apple, app and disk image; see [releasing](docs/RELEASING.md).

### Documentation pictures and recordings

- The README and `docs/media` now show the Lantern window, Steer, resizing, Magic and the
  memory flow in new captures of the real native app, replacing the earlier parchment pictures.
  Each video has an MP4 and a GIF that plays once; `docs/media/manifest.json` records every file.

### Steer Pip mid-task and resize his window

- While Pip works, typing shows an amber Steer button and "Tell Pip to change course".
  Return redirects him after his current step without stopping him; the words stay in the
  conversation. At a paused step, Steer cancels that step and redirects. The old Ask next
  queue is gone.
- Drag the chat window's left edge to make it 420 to 760 pt wide and its top edge to set
  how tall it may grow. The window does not move, and both sizes are remembered.
- A fresh launch now opens the chat window 600 pt wide (or the remembered width); it
  used to open 420 pt wide.

### Pip moves, follows the pointer and has Magic

- Pip is alive: he breathes, blinks, flicks his ears and sways his lantern, with three
  scrolls floating beside him. His eyes, head and scrolls follow the pointer, and the
  scrolls circle while he works, one held out while he waits for you and dropped when he
  is blocked.
- Settings > Magic sets the light around him: Calm, Balanced (the default) or Rich.
  Arriving, working, a step finishing, an answer part arriving and a yes each have an
  effect; Rich dims the desktop while he arrives. Reduce Motion turns all of it off.
- Pip's own idle movement costs the page no script frames while he waits.

### Lantern chat window

- Pip's window is now a chat: 600 pt wide beside Pip, fading in and growing upward from a
  fixed bottom edge to at most 70% of the screen, with a message box that never moves.
  It is dark with one amber accent, follows the Mac's light and dark, and is see-through
  at a 92% tint unless Reduce Transparency or Increase Contrast asks for a solid window.
  The parchment page, its unrolling and the smoke effect are gone.
- Answers can include a plan, table, chart, choice, sources, route, fold, pictures, note
  or draft, written by the model as OpenUI Lang and drawn from checked data only. While
  Pip works the window shows one row per step with its time and the answer as it arrives;
  a step Pip paused before shows what would happen above the message box.
- Chats lists every conversation, searchable. Settings, Feedback, Tracker, Remember and
  Browser task moved under More. Interrupted work keeps Review continuation and Stop work.

### Mac abilities as tools

- Pip's Mac abilities are now tools of the one conversation: files and shell (pi-durable's
  read, write, edit and bash, starting at your home folder), browser clicks, typing and
  form filling through the installed Playwright MCP server, screen and Mac control through
  Peekaboo's, AppleScript and app automation through the Automator MCP server, and saved
  integrations through the axi command-line tools. Each automation package is pinned and
  starts with install scripts off; one that will not start says so plainly instead of
  failing silently.
- Setup asks macOS once, in order, for all six permissions the abilities need:
  accessibility, screen recording, automation, Full Disk Access, microphone and
  notifications. The panel lives in Settings under Mac access; each ask shows its own
  system prompt or System Settings pane, answers are recorded in Pip's home, and Pip
  never re-asks. Only you can grant or revoke.
- General-purpose tools can reach a send, payment, publication or deletion without its
  name, so the named-button guarantee ends; the four named tools and the one pause rule
  remain for the kinds the check can see.

### One conversation for every ask

- Each ask now runs as one pi-durable conversation on pi-ai, in which every ability
  (public reading, the task browser, drafts, prepared actions, Calendar and Reminders
  fixtures) is a tool, and its events survive a restart. A conversation stops after
  24 model turns or ten minutes, and a reply cut off by the model's length limit is
  reported as incomplete.
- The ChatGPT plan sign-in is pi-ai's own. The Claude program route, its SDK, and the
  home-made sign-in and prompt engines are removed. Because the whole conversation is
  now sent, Allow is asked again once.

### One pause rule

- Pip now does what you ask at once: copying, opening links and any app by its
  identifier, saving notes, and sending, paying, publishing or deleting through four
  named tools. One before-tool check pauses Pip only before a send, payment,
  publication or deletion your own message did not ask for, shows exactly what would
  happen, and waits for Allow or Cancel. Stop, the 24-turn limit and the ten-minute
  limit end a pause, and a pause open at a restart is cancelled.
- The four-app list, the five-kind action gate and the prompt that forbade sending
  and deleting are removed. The Mac connects a native ability for each outward kind
  in a later piece; until then it answers that the step is not available.

### Publication preparation

- Select MIT for original code/docs and CC BY 4.0 for eligible original artwork,
  with GitHub-handle attribution and explicit third-party rights limits.
- Add privacy, installation, architecture, status and troubleshooting guides.
- Add community templates, maintainer ownership and read-only pinned check setup.
- Add a local committed-file candidate exporter that never copies original history.
- Require settled-source tests, inspected original media, rights review and final
  exact-content approval before creating the public GitHub home.

The illustrated README now includes original native media with a once-playing
memory GIF and static equivalent. Final notices, artwork clearance and the canonical
export remain gated. Existing local history and personal state remain untouched.
