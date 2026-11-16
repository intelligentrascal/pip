# Pip documentation media

These files show Pip's real native WebKit window, the Lantern chat window beside the painted
elf, in a new disposable profile. The original capture masters, the capture tool and the test
logs remain private. No desktop, personal notification, account, credential, film or reference
footage, or real document appears.

| File | What it shows |
| --- | --- |
| [pip-window.png](pip-window.png) | The settled Lantern window and the elf at the default 600 pt width |
| [work.mp4](work.mp4), [work.gif](work.gif) | Ask, watch the step rows, steer with Return, read the redirected answer |
| [steer.png](steer.png) | The amber Steer button with a typed redirect while Pip works |
| [answer-parts.png](answer-parts.png) | The end of a finished answer: a choice, a draft and a note |
| [resize.mp4](resize.mp4), [resize.gif](resize.gif) | Drag the left edge wider and narrower, then the top edge for the most height |
| [resize-static.png](resize-static.png) | The same finished window at its widest and narrowest |
| [magic.mp4](magic.mp4), [magic.gif](magic.gif) | Pip arriving with Balanced light, then following a scripted pointer path |
| [magic-static.png](magic-static.png) | The arrival at Calm, Balanced and Rich, left to right |
| [settings-magic.png](settings-magic.png) | Settings → Magic with the three levels explained |
| [remember.mp4](remember.mp4), [remember.gif](remember.gif) | More → Remember → Review save → Save fact, then Settings → Remembered facts |
| [remember-static.png](remember-static.png) | The same approval and saved list, side by side |
| [provider-settings.png](provider-settings.png) | Native Settings provider controls: not connected and not allowed |
| [provider-allow.png](provider-allow.png) | Two crops of the same OpenRouter Allow screen: sharing, routing, billing and the buttons |
| [manifest.json](manifest.json) | Size, dimensions, frames, duration and a SHA-256 for every file above |

## What is real and what is staged

- The window and Pip are the real native app's own web view, captured in process; nothing is
  drawn by hand. Frames are composited over a plain neutral background and encoded without
  audio or personal metadata. Each MP4 is H.264, 1280 × 720 at 24 frames a second. Each GIF
  plays once.
- Typing and clicks are sent by the test harness to the real controls. This is not
  physical-keyboard or mouse proof. The edge drags in the resize recording are pointer events
  on the real handles; a real mouse drag on the native panel is not driven.
- The working turn uses a scripted stand-in for the model. No sign-in, key entry, provider
  Allow or AI request occurred, and an available provider connection is not proof of account
  access.
- The memory fact is **“For this demo, I prefer tea.”** It is disposable demonstration data,
  not a statement about a real person.
- The Magic recording shows Balanced; the static strip shows Calm, Balanced and Rich from
  separate runs. The pointer path is scripted. The native see-through blur is not drawn in
  captures, so the window looks solid.
- Every source frame and every encoded video was visually inspected. Blank canvas around a
  smaller window is intentional: the window grows upward from a fixed bottom edge, as in the
  app.

## Credit and rights

Credit **intelligentrascal — Pip native demonstration** and indicate changes. Original
explanatory text uses MIT. Screens include original project code and the AI-assisted Curious
Hearth artwork, so [artwork eligibility](../../assets/LICENSE.md) and the
[reference and output terms review](../ARTWORK.md) still apply. These local preparation
derivatives are not a declaration that unresolved generated-art rights have been cleared for
public distribution. No endorsement or exclusive AI-art copyright is claimed. Final
exact-content publication review remains mandatory.
