#!/usr/bin/env python3
"""Fetch CC0 textures from Poly Haven and bake them down to PS1-style PNGs.

Run:  python3 -I tools/fetch_textures.py [--cache DIR] [--sheet sheet.png]

Every texture role maps to one Poly Haven asset (1k diffuse JPG). The image is
area-filtered down to 64 or 128 px, then quantized to a small palette (no
dithering) and written to assets/textures/<role>.png. A few roles are drawn
procedurally (hazard stripes, chain-link, the restricted-area sign, noise).
Writes/updates the "textures" block of assets/manifest.json.
Stdlib + Pillow only.
"""
import argparse, io, json, math, os, random, sys, urllib.request
from PIL import Image, ImageDraw, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "textures")
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")

# role: (poly haven id, size px, palette colours[, brightness, saturation])
ROLES = {
    "ground_forest":  ("mud_forest", 128, 48, 1.35, 1.0),
    "ground_grass":   ("grass_ground", 128, 48),
    "dirt_road":      ("rocky_trail", 128, 48),
    "shore_gravel":   ("ganges_river_pebbles", 128, 48, 0.95, 0.8),
    "rock_cliff":     ("dark_rock_02", 128, 48, 1.35, 0.8),
    "moss_rock":      ("mossy_rock", 64, 48),
    "cabin_logs":     ("wood_trunk_wall", 64, 48),
    "wood_planks":    ("wood_floor_worn", 64, 48),
    "wood_dark":      ("dark_wood", 64, 32),
    "roof_shingles":  ("roof_slates_02", 64, 32),
    "dock_planks":    ("weathered_planks", 64, 48),
    "concrete_wall":  ("concrete_wall_006", 64, 32),
    "concrete_floor": ("hangar_concrete_floor", 64, 32, 1.6, 0.8),
    "concrete_dirty": ("dirty_concrete", 64, 32),
    "metal_plate":    ("metal_plate", 64, 32),
    "metal_panel":    ("blue_metal_plate", 64, 32),
    "metal_rusty":    ("rusty_metal_02", 64, 48),
    "floor_tiles":    ("worn_tile_floor", 64, 32),
    "carpet_office":  ("dirty_carpet", 64, 32),
    "brick_painted":  ("painted_brick", 64, 32, 0.95, 0.35),
    "castle_stone":   ("stone_block_wall", 64, 48, 1.4, 0.7),
    "stone_floor_old":("monastery_stone_floor", 64, 48),
}

UA = {"User-Agent": "badideas-asset-fetch/1.0"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def diffuse_url(asset):
    files = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))
    return files["Diffuse"]["1k"]["jpg"]["url"]

def fetch(asset, cache):
    path = os.path.join(cache, asset + "_1k.jpg")
    if not os.path.exists(path):
        data = get(diffuse_url(asset))
        with open(path, "wb") as f:
            f.write(data)
    return Image.open(path).convert("RGB")

def bake(img, size, colours, bright=1.0, sat=1.0):
    # area (box) filter keeps the texture tileable at power-of-two sizes
    small = img.resize((size, size), Image.BOX)
    if sat != 1.0:
        small = ImageEnhance.Color(small).enhance(sat)
    if bright != 1.0:
        small = ImageEnhance.Brightness(small).enhance(bright)
    q = small.quantize(colors=colours, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    return q.convert("RGB")

# ---------- procedural roles ----------
def hazard_stripes(size=64):
    im = Image.new("RGB", (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            band = ((x + y) // (size // 4)) % 2   # period divides size -> tiles
            px[x, y] = (214, 168, 22) if band == 0 else (24, 22, 20)
    rnd = random.Random(3)
    for _ in range(140):  # grime
        x, y = rnd.randrange(size), rnd.randrange(size)
        r, g, b = px[x, y]
        k = rnd.uniform(0.6, 0.85)
        px[x, y] = (int(r * k), int(g * k), int(b * k))
    return im

def chainlink(size=64):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = (150, 154, 158, 255)
    s = size // 4                         # diamond cell, tiles 4x4
    for k in range(-size, 2 * size, s):
        d.line([(k, 0), (k + size, size)], fill=c, width=2)
        d.line([(k, size), (k + size, 0)], fill=c, width=2)
    # darker knuckles where wires cross
    px = im.load()
    for y in range(0, size, s // 2):
        for x in range(0, size, s // 2):
            if ((x // (s // 2)) + (y // (s // 2))) % 2 == 0 and px[x % size, y % size][3]:
                px[x % size, y % size] = (95, 98, 100, 255)
    return im

# 3x5 pixel font, enough for the sign
FONT = {
 'A':"010101111101101",'B':"110101110101110",'C':"011100100100011",'D':"110101101101110",
 'E':"111100110100111",'F':"111100110100100",'G':"011100101101011",'H':"101101111101101",
 'I':"111010010010111",'J':"001001001101010",'K':"101101110101101",'L':"100100100100111",
 'M':"101111111101101",'N':"110101101101101",'O':"010101101101010",'P':"110101110100100",
 'Q':"010101101110011",'R':"110101110101101",'S':"011100010001110",'T':"111010010010010",
 'U':"101101101101111",'V':"101101101101010",'W':"101101111111101",'X':"101101010101101",
 'Y':"101101010010010",'Z':"111001010100111",' ':"000000000000000",'-':"000000111000000",
 '.':"000000000000010",'!':"010010010000010",
}

def draw_text(px, text, x0, y0, scale, colour):
    x = x0
    for ch in text:
        g = FONT.get(ch.upper(), FONT[' '])
        for i, bit in enumerate(g):
            if bit == '1':
                gx, gy = i % 3, i // 3
                for sy in range(scale):
                    for sx in range(scale):
                        px[x + gx * scale + sx, y0 + gy * scale + sy] = colour
        x += 4 * scale
    return x

def text_w(text, scale):
    return len(text) * 4 * scale - scale

def sign_restricted(w=128, h=64):
    rnd = random.Random(7)
    im = Image.new("RGB", (w, h), (222, 220, 210))
    px = im.load()
    for y in range(h):
        for x in range(w):
            n = rnd.randint(-10, 6)
            r, g, b = px[x, y]
            px[x, y] = (r + n, g + n, b + n - 2)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w - 1, 15], fill=(176, 28, 24))
    d.rectangle([0, 0, w - 1, h - 1], outline=(70, 66, 60))
    t = "RESTRICTED AREA"; draw_text(px, t, (w - text_w(t, 2)) // 2, 3, 2, (245, 240, 230))
    t = "CASCADE BASIN"; draw_text(px, t, (w - text_w(t, 2)) // 2, 21, 2, (20, 20, 20))
    t = "RESEARCH"; draw_text(px, t, (w - text_w(t, 2)) // 2, 34, 2, (20, 20, 20))
    t = "AUTHORIZED PERSONNEL ONLY"; draw_text(px, t, (w - text_w(t, 1)) // 2, 50, 1, (20, 20, 20))
    # rust streaks and bolt holes
    for bx in (4, w - 5):
        for by in (19, h - 5):
            d.ellipse([bx - 1, by - 1, bx + 1, by + 1], fill=(60, 50, 40))
            for k in range(rnd.randint(3, 9)):
                yy = by + 2 + k
                if yy < h:
                    r, g, b = px[bx, yy]
                    px[bx, yy] = (int(r * 0.7), int(g * 0.55), int(b * 0.45))
    for _ in range(260):
        x, y = rnd.randrange(w), rnd.randrange(16, h)
        r, g, b = px[x, y]
        px[x, y] = (int(r * 0.8), int(g * 0.76), int(b * 0.7))
    return im

def ceiling_tiles(size=64):
    """Acoustic drop-ceiling: 2x2 tiles per texture, T-bar grid, pinhole speckle."""
    rnd = random.Random(5)
    im = Image.new("RGB", (size, size), (196, 192, 182))
    px = im.load()
    half = size // 2
    for y in range(size):
        for x in range(size):
            n = rnd.randint(-8, 5)
            if rnd.random() < 0.12:
                n -= 28                      # fissure pinholes
            r, g, b = px[x, y]
            px[x, y] = (r + n, g + n, b + n)
    # water stain on one tile
    cx, cy, rad = 44, 18, 9
    for y in range(size):
        for x in range(size):
            dd = math.hypot(x - cx, y - cy)
            if dd < rad:
                r, g, b = px[x, y]
                k = 0.86 if dd > rad - 1.5 else 0.94
                px[x, y] = (int(r * k), int(g * k * 0.98), int(b * k * 0.9))
    d = ImageDraw.Draw(im)
    for t in (0, half):                      # T-bar grid on tile edges (tiles seamlessly)
        d.line([(t, 0), (t, size - 1)], fill=(150, 148, 142))
        d.line([(0, t), (size - 1, t)], fill=(150, 148, 142))
        d.line([(t + 1, 0), (t + 1, size - 1)], fill=(214, 212, 205))
        d.line([(0, t + 1), (size - 1, t + 1)], fill=(214, 212, 205))
    return im

def noise(size=64):
    rnd = random.Random(11)
    # tileable value noise: sum of octaves on a wrapped lattice
    def lattice(n):
        return [[rnd.random() for _ in range(n)] for _ in range(n)]
    octs = [(4, 0.5), (8, 0.3), (16, 0.2)]
    grids = [(n, a, lattice(n)) for n, a in octs]
    im = Image.new("L", (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            v = 0.0
            for n, a, g in grids:
                fx, fy = x * n / size, y * n / size
                x0, y0 = int(fx), int(fy)
                tx, ty = fx - x0, fy - y0
                tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
                x1, y1 = (x0 + 1) % n, (y0 + 1) % n
                a0 = g[y0][x0] + (g[y0][x1] - g[y0][x0]) * tx
                a1 = g[y1][x0] + (g[y1][x1] - g[y1][x0]) * tx
                v += a * (a0 + (a1 - a0) * ty)
            px[x, y] = max(0, min(255, int(v * 255)))
    return im

PROCEDURAL = {
    "hazard_stripes": (hazard_stripes, 64, "procedural (tools/fetch_textures.py)"),
    "chainlink": (chainlink, 64, "procedural (tools/fetch_textures.py)"),
    "sign_restricted": (sign_restricted, [128, 64], "procedural (tools/fetch_textures.py)"),
    "ceiling_tiles": (ceiling_tiles, 64, "procedural (tools/fetch_textures.py)"),
    "noise": (noise, 64, "procedural (tools/fetch_textures.py)"),
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "polyhaven"))
    ap.add_argument("--sheet", default=None, help="write a contact sheet PNG here")
    ap.add_argument("--only", default=None, help="comma list of roles")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    only = set(a.only.split(",")) if a.only else None
    entries = {}
    for role, spec in ROLES.items():
        asset, size, cols = spec[:3]
        adj = spec[3:]
        if only and role not in only:
            continue
        print(f"{role:16s} <- {asset}", flush=True)
        img = bake(fetch(asset, a.cache), size, cols, *adj)
        img.save(os.path.join(OUT, role + ".png"), optimize=True)
        entries[role] = {"file": f"textures/{role}.png", "size": size,
                         "source": f"https://polyhaven.com/a/{asset}", "license": "CC0"}
    for role, (fn, size, src) in PROCEDURAL.items():
        if only and role not in only:
            continue
        img = fn()
        img.save(os.path.join(OUT, role + ".png"), optimize=True)
        entries[role] = {"file": f"textures/{role}.png", "size": size, "source": src, "license": "CC0"}
    man = {}
    if os.path.exists(MANIFEST):
        man = json.load(open(MANIFEST))
    man.setdefault("textures", {}).update(entries)
    json.dump(man, open(MANIFEST, "w"), indent=1)
    if a.sheet:
        names = sorted(man["textures"])
        cell = 132
        cols = 6
        rows = math.ceil(len(names) / cols)
        sheet = Image.new("RGB", (cols * cell, rows * (cell + 12)), (40, 40, 40))
        d = ImageDraw.Draw(sheet)
        for i, n in enumerate(names):
            im = Image.open(os.path.join(ROOT, "assets", man["textures"][n]["file"])).convert("RGBA")
            im = im.resize((128, 128 * im.height // im.width), Image.NEAREST)
            x, y = (i % cols) * cell, (i // cols) * (cell + 12)
            sheet.paste(im, (x + 2, y + 2), im)
            d.text((x + 2, y + 130), n, fill=(255, 255, 255))
        sheet.save(a.sheet)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"textures: {len(os.listdir(OUT))} files, {total/1024:.0f} KB")

if __name__ == "__main__":
    main()
