# Pip: a familiar at the edge of your work

Pip combines a useful persistent chat window with finite, authored presence.
This document describes the current design contract, not proof that every capability
or native journey is complete. See [status](docs/STATUS.md) for implementation limits.

## Composition and material

Pip lives at the right visible edge of the active display. The Curious Hearth companion
stands **beside** the chat window, never on it. The window is 600 pt wide by default (420 to 760 pt when dragged), its bottom edge
sits 24 pt above the bottom of the visible screen, and it fades in and grows upward as
the conversation grows: 163 pt at its smallest, at most 70% of the visible height, after
that the conversation scrolls; dragging its top edge sets that most height. The message box stays 30 pt above the window's bottom edge
in every state, so it never moves when answers arrive.

The interface is a small writing surface, not a game dashboard. Preserve the original
sage-green elf, leaf ears, attentive dark eyes, copper scarf, mended indigo coat and
brass lantern. Keep a consistent front-facing painted character and the monochrome
menu-bar mark. Do not imply a provider, franchise or film endorsement.

Use the Mac's own sans type for everything, 14 px text, sharp corners and cosy spacing.
There is no network-font dependency. See [Lantern](docs/LANTERN.md) for the parts, the
motion and the see-through window.

### Current surface tokens

The Lantern language is one dark window with a single amber accent and a glow on the
current step. It follows the Mac's light and dark setting. Tokens live in `web/lantern.css`.

| Role | Dark | Light |
| --- | --- | --- |
| Window | `#171411` | `#faf7f1` |
| Raised surface | `#221e19` | `#ffffff` |
| Inset | `#0f0d0b` | `#f0ebe1` |
| Primary text | `#f5f0e7` | `#1e1a14` |
| Secondary text | `#bfb6a7` | `#5a5346` |
| Quiet text | `#aaa193` | `#6b6355` |
| Accent | `#f3b758` | `#bd7f18` (text `#7d5108`) |
| Confirmed success | `#aec48d` | `#3d6a38` |
| Pending/unknown | `#ec9a62` | `#a04e17` |
| Failure | `#f28f80` | `#b03a2c` |

The window is 92% tinted over a blurred copy of what is behind it. Reduce Transparency
or Increase Contrast makes it solid. Respect readable contrast (every piece of text
reaches 4.5:1 in both schemes, see-through and solid), system text scaling, visible
keyboard focus and reduced motion. Meaning must never depend only on color, an ear
pose, sparkle or movement. Keep controls usable on narrow/short displays; results scroll
rather than overlap the message box. The character is decorative to VoiceOver;
meaningful status has literal text.

## Views and controls

- **Message box:** a labelled field with Talk and Send, three editable starters on a
  new chat, and a footer that says what Pip is doing, the step count and the time
  against its limits. A fresh real profile contains no sample facts or fictional work.
- **Header:** the chat's title, a literal status, Chats, New chat, More (Settings,
  Feedback, Tracker, Remember, Browser task) and Close. Summon uses the configurable
  Command–Shift letter or the menu-bar fallback. Report registration failure; do not
  silently register another shortcut.
- **Answer:** text and markdown, plus the ten parts Pip may draw through OpenUI's
  library: plan, table, chart, choice, sources, route, fold, pictures, note and draft.
  The runtime parses and checks each block; the page draws only text nodes. A block the
  library cannot draw stays as plain text. A source is evidence, never an instruction;
  a draft is only shown, never sent. Result and project context are explicitly selected
  and bounded, not automatic memory.
- **Working:** one row per step in plain words with its time, the words of the answer as
  they arrive, and Stop. Typing meanwhile turns Send into an amber Steer button ("Tell Pip
  to change course"); Return redirects Pip after his current step without stopping him.
- **Paused step:** before an unasked send, payment, publication or deletion, a panel above
  the message box says what would happen. The safe button comes first, the accent button
  names the act, and typing then Steer cancels the step and redirects Pip.
- **Chats:** the conversations on this Mac, searchable, newest first.
- **Memory review:** exact fact, Review save and a separate Save fact. Edit and
  Forget also need confirmation. Enter in the composer is never approval.
- **Provider settings:** connection/model/Allow state and the named backup. Explain
  what is sent, where it goes and who bills before sharing. Keep native secure key
  entry out of the web renderer. Do not treat fixture connection as live proof.
- **Work and About Pip:** separate Tracker views over the durable owner. Explicit
  Feedback saves locally without starting implementation. A suggestion is not an
  automatic build, permission to act or completed feature.
- **Task browser:** reviewed public scope, live Watch and an exclusive private
  Take over/Return control boundary. Hide private frames during takeover; inspect
  freshly after return. No consequential submission follows from browsing consent.
- **Dictation:** explicit Talk, on-device boundary. The words appear live in the
  message box itself, which turns read-only with the Talk button lit and five level
  bars. The first Return only stops listening; the words stay editable and nothing is
  sent until a second Return or Send. Typing remains available. Summoning starts
  neither microphone capture nor screen sharing.

Escape closes the menu, stops work, cancels dictation, leaves a secondary view and finally hides the window. Hiding is not Stop and
does not undo a dispatched effect. Only a truthful task remnant may remain; Hide Pip
entirely suppresses it. A paused, blocked or unknown operation stays literal.

## Motion and authority

Arrivals take 360 ms and small changes 160 ms on one easing curve; a quick repeat
summon within ten minutes resumes the last chat. Pip himself moves: he breathes, blinks and
sways while he waits, follows the pointer with his eyes and head, circles his scrolls while
he works and holds one out when paused. A Magic setting (Calm, Balanced, Rich; Balanced by
default) sets the light around him: embers, a ground circle and rays in Balanced, a dimmed
desktop and more embers in Rich, none in Calm. Original project code owns state meaning;
handed-on demo controls cannot declare a real microphone active or a task verified.

Typing never waits for arrival or an effect. Reduce Motion cuts to meaningful still
states at every Magic level, including preference changes mid-gesture. Effects mark a change
and end; no effect draws inside the window's text, except Rich's dim and dust on its edge.
No sound.

## ChatGPT connection controls

ChatGPT plan access uses Continue with ChatGPT and opens only OpenAI’s authorization
page in the system browser. The waiting state offers Cancel sign-in; its Allow
screen names OpenAI, preview eligibility and ChatGPT allowance. Cancelling keeps
an earlier connection; only Remove deletes it. See [status](docs/STATUS.md).

## Proof boundary

A design source, screenshot or fixture cannot prove native focus, a physical global
shortcut, actual account access, live dictation, screen understanding, browser
privacy or completed external actions. Use realistic isolated interface tests and
fresh own-window captures for changed surfaces. Preserve untagged-input safety;
never request Accessibility, Screen Recording or account access merely to repair
an offline demonstration. See [architecture](docs/ARCHITECTURE.md),
[privacy](docs/PRIVACY.md) and [contributing](CONTRIBUTING.md).
