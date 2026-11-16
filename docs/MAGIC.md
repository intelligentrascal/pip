# Magic

Pip's movement and the light around him. The page code is `web/character.js` and
`web/character.css` (Pip) and `web/magic.js` (the effects layer).

## Pip's movement

- Waiting: breathing, a blink about every 5.6 s, ear flicks, and a sway of the arm, scarf
  tail and lantern, all CSS animations on the compositor. Three scrolls float and bob at
  1.9, 2.3 and 2.7 s. A waiting Pip asks the page for no script frames.
- Pointer: eyes, head, ears, body and scrolls turn toward the pointer with time constants
  of 70, 240 and 520 ms. After 2.5 s without movement Pip looks at the message box or the
  newest step. The native app polls the pointer at 60 Hz and sends only changed positions.
- Poses: working circles the scrolls at 150 degrees a second and brightens the lantern,
  paused holds one scroll out in copper, blocked drops the scrolls and lowers his head,
  listening lifts his ears. Pressing Pip hops and blinks; typing nudges his eyes.

## Magic levels

Settings > Magic: Calm, Balanced (default) or Rich, saved natively as `magic.json`.

| Moment | Calm | Balanced | Rich |
| --- | --- | --- | --- |
| Arrival | light bloom, reveal | ground circle, embers, flash, rays, reveal | adds a 42% desktop dim, 110 embers |
| Working | circling scrolls | adds embers from the lantern (11 a second) | 22 a second |
| A part arrives | edge glow | embers to the window edge | 14 across the window, gold dust |
| Paused | circle stays | copper circle and embers | more embers |
| Yes | scroll flies off | embers fall | 60 embers |

Balanced and Calm never draw a pixel inside the window. Reduce Motion turns every effect
off at every level. The effects canvas passes clicks through and is hidden when nothing
is drawn. Hiding plays the effect backwards (450 ms, 160 ms in Calm, none with Reduce Motion)
before the panel goes.

## Known limits

The effects are a Canvas 2D port of the planned preview, not its HDR renderer. They live in
the panel, which is the window plus 156 pt, so a ring or ray that would pass the right edge
of Pip's box is clipped there.

## Checks

`tests/ui/character.spec.ts`, `tests/ui/magic.spec.ts`, `tests/native/MagicChecks.swift`, and
the native art probe (`PIP_PROBE_SCENARIO=art python3 scripts/validate-native.py`), which fails
when the frame p95 is above 20 ms, a frame is above 50 ms, a key takes 50 ms or more to move
Pip, or a waiting Pip asks for script frames.
