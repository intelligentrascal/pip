# Magic

Pip's movement and the light around him. The page code is `web/character.js` and
`web/character.css` (Pip) and `web/magic.js` (the effects layer).

## Pip's movement

- Waiting: breathing, a blink about every 5.6 s, ear flicks, and a sway of the arm, scarf
  tail and lantern, all CSS animations on the compositor. Three scrolls float and bob at
  1.9, 2.3 and 2.7 s. A waiting Pip asks the page for no script frames.
- Pointer: eyes, head, ears, body and scrolls turn toward the pointer with time constants
  of 70, 240 and 520 ms. After 2.5 s without movement Pip looks at the message box or the
  newest step; at a paused step he faces the person instead, even with words typed. The native app polls the pointer at 60 Hz and sends only changed positions.
- Poses: working circles the scrolls at 150 degrees a second and brightens the lantern,
  paused holds one scroll out in copper, blocked drops the scrolls and lowers his head,
  listening lifts his ears. The lantern's light follows the pose: amber, copper when paused,
  and a dim red (the window's problem colour, `#f28f80` dark, `#b03a2c` light) when blocked,
  which draws no embers and no circle. Pressing Pip hops and blinks; typing nudges his eyes.

## Magic levels

Settings > Magic: Calm, Balanced (default) or Rich, saved natively as `magic.json`.

| Moment | Calm | Balanced | Rich |
| --- | --- | --- | --- |
| Arrival | light bloom, reveal | ground circle, embers, flash, rays, reveal | adds a 42% desktop dim, 110 embers |
| Working | circling scrolls | adds embers from the lantern (11 a second) | 22 a second |
| A part arrives | none | embers to the window edge, then the part's border lights about 480 ms later | 14 across the window, gold dust |
| A step finishes | none | 4 embers from the lantern | the same |
| Paused | none | copper circle drawn once in 0.45 s, then held still until you answer; embers to the panel, then its border lights | more embers |
| Yes | scroll flies off | embers fall | 60 embers |

Flying effects (embers, flashes, rays, dust) never cross into the window at Balanced and Calm; the brief border light of a
new part or the paused panel is the one thing drawn inside, and it never shows at Calm. The arrival flash is 150 pt in radius
(300 pt across), the quick return 70 pt (140 pt across), nominal gradient bounds. Choosing Calm clears whatever Balanced had
on screen at once. Reduce Motion turns every effect
off at every level. The effects canvas passes clicks through and is hidden when nothing
is drawn. Hiding plays the effect backwards (450 ms, 160 ms in Calm, none with Reduce Motion)
before the panel goes.

## Known limits

The effects are a Canvas 2D port of the planned preview, not its HDR renderer. They live in
the panel, which is the window plus 156 pt, so a ring or ray that would pass the right edge
of Pip's box is clipped there. The ground circle is 190 pt across and the rays 300 pt, as
designed; the wider click-through effect room and the preview's renderer are not built yet.

## Checks

`tests/ui/character.spec.ts`, `tests/ui/magic.spec.ts`, `tests/native/MagicChecks.swift`, and
the native art probe (`PIP_PROBE_SCENARIO=art python3 scripts/validate-native.py`), which fails
when the frame p95 is above 20 ms, a frame is above 50 ms, a key takes 50 ms or more to move
Pip, or a waiting Pip asks for script frames.
