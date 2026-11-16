# Pip artwork

Pip is an original sage-green elf with broad leaf-shaped ears, attentive dark eyes,
a copper scarf, a mended indigo coat and a brass lantern. The app uses the painted
Curious Hearth parts; the earlier vector companion remains an editable reference.

| Material | Role | Provenance |
| --- | --- | --- |
| `curious-hearth/` | Registered cropped RGBA parts, contour and assembled fallback | GPT Image 1.5 selected painting through Comfy Cloud, original project references and local preparation |
| `pip-companion.svg` | Editable original vector companion | Authored vector work, not image-model output |
| `pip-companion.png` | Transparent 1024-pixel vector export | Local rasterization of the original SVG |
| `pip-mark.svg` | Monochrome leaf-ear/lantern menu-bar mark | Original small vector using `currentColor` |
| `pip-mark.png` | Transparent 128-pixel mark export | Local rasterization; use as an NSImage template |

The painted source chain also includes an earlier FLUX.2 [pro] project-art study.
The Curious Hearth painted parts are the only artwork. These materials do not imply model/provider
endorsement, exclusive AI-art copyright or legal uniqueness.

## License and source review

Read [artwork licensing](LICENSE.md) and the
[provenance and rights limitations](../docs/ARTWORK.md) before reuse or redistribution.
Eligible original vector rights use CC BY 4.0 with intelligentrascal credit;
generated material does not receive blanket MIT or CC BY coverage from this notice.
Preserve required provenance markings and indicate changes.

Do not commit personal captures, raw generation records, account/job metadata,
outside reference images or private handoff demos. New documentation media needs
fresh disposable data, complete frame inspection and exact-file review.

## Re-exporting and registration

Render the companion SVG at width 1024 with transparency. Resolve `currentColor`
when exporting the monochrome mark at width 128; use the raster as a native template
so the menu bar controls its appearance. Preserve the full view box, ears, feet and
lantern rather than cropping the figure for convenience.

For painted parts, keep the logical canvas, pivots, offsets, draw order and hashes
in `curious-hearth/manifest.json` aligned. Scale the registered scene, not every
cropped tile into a full-canvas texture. See the [painted-part contract](curious-hearth/README.md).
