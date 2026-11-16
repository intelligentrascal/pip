#!/usr/bin/env python3
"""Regenerate release/icon/Pip.icns from the registered Curious Hearth artwork (head and scarf crop).
Needs Pillow and macOS iconutil. The committed .icns is what the release build uses."""
import pathlib, subprocess, tempfile
from PIL import Image, ImageChops, ImageDraw
root = pathlib.Path(__file__).resolve().parents[2]
art = Image.open(root / 'assets/curious-hearth/assembled-rest.png').convert('RGBA')
head = art.crop((392, 70, 962, 640))
# Soften the crop: fade the coat at the bottom and the sliver of the waving arm at the left.
fade = Image.new('L', head.size, 255)
pixels = fade.load()
for y in range(head.height):
    for x in range(head.width):
        down = min(1, (head.height - y) / 110)
        across = 1 if y < 380 else min(1, x / 90)
        pixels[x, y] = int(255 * down * across)
head.putalpha(ImageChops.multiply(head.getchannel('A'), fade))
size = 1024
canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
inset = 100
body = size - 2 * inset
tile = Image.new('RGBA', (body, body), (0, 0, 0, 0))
mask = Image.new('L', (body, body), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, body - 1, body - 1), radius=185, fill=255)
background = Image.new('RGBA', (body, body), (0x2a, 0x24, 0x38, 255))
tile.paste(background, (0, 0), mask)
fitted = head.resize((int(body * 0.8), int(body * 0.8)), Image.LANCZOS)
layer = Image.new('RGBA', (body, body), (0, 0, 0, 0))
layer.paste(fitted, ((body - fitted.width) // 2, int(body * 0.17)), fitted)
tile = Image.alpha_composite(tile, Image.composite(layer, Image.new('RGBA', (body, body), (0, 0, 0, 0)), mask))
canvas.paste(tile, (inset, inset), tile)
with tempfile.TemporaryDirectory() as folder:
    iconset = pathlib.Path(folder) / 'Pip.iconset'
    iconset.mkdir()
    for points in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            pixels = points * scale
            canvas.resize((pixels, pixels), Image.LANCZOS).save(iconset / f'icon_{points}x{points}{"@2x" if scale == 2 else ""}.png')
    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(root / 'release/icon/Pip.icns')], check=True)
