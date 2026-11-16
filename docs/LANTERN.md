# Lantern

Lantern is the design language of Pip's chat window: a dark window with one amber accent
and a glow on the current step, drawn in the Mac's own sans type with sharp corners.
It follows the Mac's light and dark setting. Tokens and layout live in `web/lantern.css`.

## Window

- 600 pt wide beside Pip unless a width was saved; the panel adds 6 pt and Pip's 150 pt.
  `PanelGeometry` in `native/PipCore.swift` owns the sizes and is checked by
  `swift run PipCoreChecks`.
- The window's bottom edge is 24 pt above the visible screen's bottom. Its height follows
  the conversation from 163 pt to 70% of the visible height, then the conversation scrolls.
- Drag the left edge to change the width (420 to 760 pt) and the top edge to change the
  most height (320 pt up to the screen, 12 pt short of the top). The window grows up and
  left, so the bottom edge and Pip stay put. On release the host saves both in
  `window.json` (`WindowSetting`, like `magic.json`), and the next launch opens with
  them. The top drag only sets the most; the window settles back to its content on
  release, so a short chat stays short.
- The page tells the host its height with `resize {windowHeight, mostHeight?}`; the host
  places the panel and the see-through layer. The message box stays 30 pt above the
  bottom edge in every state. The width travels only in `configureWindow {width, most}`
  (from a drag) and in the optional `windowWidth` of `resize`. A zero, negative or
  missing width keeps the current one: a web view measured before it has a size must not
  shrink a fresh window, which is why a cold launch opens at 600 pt, not 420 pt.
- See-through: a native blurred layer behind the page, with the window tinted at 92%.
  Reduce Transparency or Increase Contrast makes the window solid. A browser preview has
  no blur, only the tint.

## Parts

The model may write a fenced `openui-lang` block in its reply. `runtime/parts.ts` defines
the ten kinds with OpenUI's library (`@openuidev/lang-core`) and gives the model its
instructions; `runtime/reply.ts` parses and checks each block in Node and sends the page
plain data; `web/parts.js` draws it with text nodes only. A block that cannot be drawn
stays as code, so no words are lost. Only https links and PNG, JPEG or WebP data pictures
(up to 1.5 MB) survive the check. Nothing a part shows sends, saves or opens anything by
itself: Save note, Copy and links are proposals the person approves.

Plan, table, chart, choice, sources, route (`Figure`), fold, pictures, note and draft.

## Live view

`runtime/live.ts` reduces the conversation's own events into one row per step, its time,
the words so far and the turn count. The page draws them in `LiveBox`; the footer shows
the step and the time against the limits from `RUN_LIMITS`.

## Steer

While Pip works, typing turns the Stop button into an amber Steer button, the box says
"Tell Pip to change course", and Return sends `steer {workId, request}` instead of
queuing a new ask. `Host.steer` (`runtime/pi-durable-adapter.ts`) submits the words to the
running ask with pi-durable's `whenBusy: 'steer'`, so Pip takes them after the current
tool round without stopping. The steered words are kept on the work (`steers`), shown in
the conversation as your own bubble, and count as asking for the pause rule: only
your own words (the ask and any steer) allow an outward step. A steer that arrives as the
ask ends is refused ("Pip is not working on that any more"), and the page puts the
words back in the box. At a paused step, typing then Steer cancels the step and
redirects the same ask. With an empty box the button is still Stop.

## Motion

Arrivals take 360 ms, small changes 160 ms, on `cubic-bezier(.32,.72,0,1)`. Reduced motion
cuts. Pip's own movement (`web/character.js`, `web/character.css`) and effects layer
(`web/magic.js`) are described in `docs/MAGIC.md`.

## Proof limits

The geometry, parts, contrast and solid mode are covered by `tests/ui/lantern.spec.ts`,
`tests/reply.test.ts`, `tests/live.test.ts` and the `PanelGeometryChecks`. The native
blur and the real Reduce Transparency setting are not driven by a test; a browser
preview emulates the media query only.
