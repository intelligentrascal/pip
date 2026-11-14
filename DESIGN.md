# Pip: a familiar at the edge of your work

Pip combines a useful persistent composer with one finite, authored magical moment.
This document describes the current design contract, not proof that every capability
or native journey is complete. See [status](docs/STATUS.md) for implementation limits.

## Composition and material

Pip lives at the right visible edge of the active display, above the Dock and clamped
to the display. The Curious Hearth companion stands **beside** a warm parchment page;
the page unrolls up and outward from the open palm. Pip does not sit above or on it.
Results grow upward without moving the composer. Browsing/Watch can use their
reviewed larger layouts, retaining composer position and palm contact.

The interface is a small writing surface, not a game dashboard. Preserve the original
sage-green elf, leaf ears, attentive dark eyes, copper scarf, mended indigo coat and
brass lantern. Keep a consistent front-facing painted character and the monochrome
menu-bar mark. Do not imply a provider, franchise or film endorsement.

Use native system sans for instructions, controls and results, with a small installed
system-serif signature for Pip's name. There is no network-font dependency.

### Current surface tokens

The base interface retains ink-green tokens in `web/style.css`; the active parchment
surface overrides them in `web/emberweave.css`:

| Role | Parchment surface | Base ink surface |
| --- | --- | --- |
| Surface | `#f6ead4` | `#142923` |
| Input/inset | `#ead9b9` | `#203a31` |
| Primary text | `#142923` | `#f6ead4` |
| Secondary text | `#5d533f` | `#c7cbb9` |
| Action/focus | `#6f5217` | `#e7bf78` |
| Dividers | `#b59a6e` | `#4c6354` |
| Confirmed success | `#2d6a48` | `#abd6b8` |
| Pending/unknown | `#7d4f10` | `#f0c88c` |
| Failure | `#9a3a2f` | `#f2ada4` |

Respect readable contrast, system text scaling, visible keyboard focus and reduced
motion. Meaning must never depend only on color, an ear pose, sparkle or movement.
Keep controls usable on narrow/short displays; results scroll rather than overlap
input. The character is decorative to VoiceOver; meaningful status has literal text.

## Views and controls

- **Persistent composer:** labelled request field, explicit Talk and Ask, editable
  prompt starters, Settings, shortcut disclosure, Feedback and literal privacy/error
  status. A fresh real profile contains no sample facts or fictional work.
- **Header:** Pip's name, literal task status, Tracker and Close. Summon uses the
  configurable Command–Shift letter or the menu-bar fallback. Report registration
  failure; do not silently register another shortcut.
- **Results:** readable answer, sources when applicable, editable writing draft and
  selected-result follow-up. A source is evidence, never an instruction. Result and
  project context are explicitly selected and bounded, not automatic memory.
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
- **Dictation:** explicit Talk, on-device boundary, editable transcript review,
  separate Add to composer and Ask. Typing remains available. Summoning starts
  neither microphone capture nor screen sharing.

Escape closes a secondary view first, then hides the popup. Hiding is not Stop and
does not undo a dispatched effect. Only a truthful task remnant may remain; Hide Pip
entirely suppresses it. A paused, blocked or unknown operation stays literal.

## Motion and authority

The accepted direction is Living ink with right-edge presence, intent reveal,
task-only remnant, dictation and finite authored motion. Emberweave supplies the
hand-led parchment composition and contextual effects. Original project code owns
state meaning; handed-on demo controls cannot declare a real microphone active or
a task verified.

| State | Meaningful cue |
| --- | --- |
| Arrival | Page unrolls from the palm; material gathers locally |
| Listening | Ear and input-level meter, only from real input |
| Thinking | Joined route islands |
| Working | Finite quill-writing gesture, then still rest |
| Approval | Parked quill; waits for the person's decision |
| Blocked | Closed fold with slack thread |
| Unknown | Unresolved state, not a success animation or resend |
| Verified done | Seal/brief effect only after an authoritative receipt |
| Hide | Finite close gesture; native hotkey/menu hides remain immediate |

New visible events retarget from the current rendered pose rather than queueing
animations. Typing never waits for arrival or an effect. Reduced motion cuts to
meaningful still poses, including preference changes mid-gesture. No decorative
loops, perpetual particles, background celebration or sound. The selected contour
is a registered raster reveal, not a claim of continuous brush simulation.

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
