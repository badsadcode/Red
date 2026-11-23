#!/usr/bin/env python3
"""Build the underground sectors of the research complex from BadLevel.

The complex is *generated once, then frozen*: we run BadLevel with fixed recipes
and seeds, squeeze its Level IR into a compact JSON per sector and commit the
result to assets/sectors/. The game never re-rolls a sector, so the player can
learn the place like a real building (design doc 2.4, 5.3).

Usage:
    python3 tools/build_sectors.py --badlevel /path/to/badlevel/checkout

Compact sector format (all distances in Quake units, 32 units = 1 metre,
BadLevel axes: x east, y north, z up; the game converts to three.js Y-up):
    brushes:  [x0,y0,z0, x1,y1,z1, flags, zone, extra]
              flags: bit0 top is floor, bit1 bottom is ceiling
              zone:  index into `zones` (room program / corridor), for texturing
              extra: 0 | ["s", z00,z10,z11,z01] sloped top | ["c", "nw"|"ne"|"sw"|"se"] corner wedge
    entities: [{k: kind, p: [x,y,z], ...props, b?: bounds}]
    rooms:    [{id,x,y,w,h,floor,ceil,program,sector,kind,storey,name}]
    spans:    [[cx, cy, f0, c0, f1, c1, ...], ...] every open span per cell (minimap, face culling)
    water:    [[cx, cy, surfaceZ]]
    hazards:  [[cx, cy, type]]
    sky:      [[cx, cy]]  cells open above (we put a cavern roof over them)
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

# Order = depth. Each entry becomes one freight-elevator stop.
SECTORS = [
    dict(id="b1", code="B-1", name="Administration & Security", recipe="facility", seed=11,
         theme="admin", stalkers=0, args=[]),
    dict(id="b2", code="B-2", name="Commons & Residential", recipe="complex", seed=12,
         theme="residential", stalkers=2, args=["--style", "compound"]),
    dict(id="b3", code="B-3", name="Research Laboratories", recipe="facility", seed=13,
         theme="research", stalkers=4, args=["--style", "scifi"]),
    dict(id="b4", code="B-4", name="Hydroponics & Biosciences", recipe="compound", seed=14,
         theme="hydro", stalkers=4, args=["--floods", "0.5"]),
    dict(id="b5", code="B-5", name="Power & Reactor", recipe="industrial", seed=15,
         theme="reactor", stalkers=6, args=[]),
    dict(id="b6", code="B-6", name="Flooded Maintenance", recipe="bunker", seed=16,
         theme="flooded", stalkers=5, args=["--floods", "0.8", "--sumps", "0.5"]),
    dict(id="b7", code="B-7", name="(no label)", recipe="dungeon", seed=17,
         theme="deep", stalkers=8, args=[]),
]


def corner_of(brush):
    c = brush.get("corner")
    if isinstance(c, str):
        return c
    if isinstance(c, (list, tuple)) and c and isinstance(c[-1], str):
        return c[-1]
    return str(c)


def compact(ir, spec):
    rooms = []
    zones = ["corridor"]
    zone_index = {"corridor": 0}

    def zone(name):
        if name not in zone_index:
            zone_index[name] = len(zones)
            zones.append(name)
        return zone_index[name]

    for r in ir["rooms"]:
        meta = r.get("meta") or {}
        program = meta.get("program") or r.get("kind")
        rooms.append(dict(id=r["id"], x=r["x"], y=r["y"], w=r["w"], h=r["h"],
                          floor=r["floor"], ceil=r["ceil"], program=program,
                          sector=meta.get("sector"), kind=r.get("kind"),
                          storey=r.get("storey", 0), shape=r.get("shape")))
        zone(program)

    cell = ir["units"]["cell"]

    def room_at(x, y, z):
        cx, cy = x / cell, y / cell
        best = None
        for r in rooms:
            if r["x"] <= cx < r["x"] + r["w"] and r["y"] <= cy < r["y"] + r["h"]:
                if r["floor"] - 64 <= z <= r["ceil"] + 64:
                    return r
                best = best or r
        return best

    brushes = []
    for b in ir["brushes"]:
        (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
        flags = (1 if b["top"] == "floor" else 0) | (2 if b["bottom"] == "ceiling" else 0)
        r = room_at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        zi = zone(r["program"]) if r else 0
        extra = 0
        if "slope" in b:
            extra = ["s"] + [round(v, 2) for v in b["slope"]]
        elif "corner" in b:
            extra = ["c", corner_of(b)]
        brushes.append([round(x0, 2), round(y0, 2), round(z0, 2), round(x1, 2), round(y1, 2),
                        round(z1, 2), flags, zi, extra])

    entities = []
    for e in ir["entities"]:
        o = {"k": e["kind"], "p": [round(v, 1) for v in e["pos"]]}
        for key, val in (e.get("props") or {}).items():
            if isinstance(val, (int, float, str, bool)) or (isinstance(val, list) and len(val) <= 4):
                o[key] = val
        if "bounds" in e:
            o["b"] = [[round(v, 1) for v in e["bounds"][0]], [round(v, 1) for v in e["bounds"][1]]]
        entities.append(o)

    spans = []
    for cx, cy, ss in ir.get("spans") or []:
        if ss:
            row = [cx, cy]
            for f, c in ss:
                row += [f, c]
            spans.append(row)

    hazards = ir.get("hazards", []) or []

    return dict(
        format="lakehouse-sector", version=1,
        id=spec["id"], code=spec["code"], name=spec["name"], theme=spec["theme"],
        recipe=spec["recipe"], seed=spec["seed"], stalkers=spec["stalkers"],
        cell=cell, grid=ir["stats"]["grid"], z_range=ir["stats"]["z_range"],
        zones=zones, rooms=rooms, brushes=brushes, entities=entities,
        spans=spans, water=ir.get("water", []) or [], hazards=hazards,
        sky=ir.get("sky", []) or [],
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--badlevel", required=True, help="path to a BadLevel checkout")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "sectors"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    index = []
    with tempfile.TemporaryDirectory() as tmp:
        for spec in SECTORS:
            out = os.path.join(tmp, spec["id"])
            cmd = [sys.executable, "-m", "badlevel", "generate", "--seed", str(spec["seed"]),
                   "--recipe", spec["recipe"], "--formats", "json", "--no-analysis",
                   "--out", out] + spec["args"]
            subprocess.run(cmd, cwd=args.badlevel, check=True, stdout=subprocess.DEVNULL)
            ir_path = [f for f in os.listdir(out) if f.endswith(".json") and "recipe" not in f][0]
            with open(os.path.join(out, ir_path)) as fh:
                ir = json.load(fh)
            data = compact(ir, spec)
            path = os.path.join(args.out, spec["id"] + ".json")
            with open(path, "w") as fh:
                json.dump(data, fh, separators=(",", ":"))
            size = os.path.getsize(path)
            index.append(dict(id=spec["id"], code=spec["code"], name=spec["name"],
                              theme=spec["theme"], file="sectors/" + spec["id"] + ".json"))
            print(f'{spec["code"]:4} {spec["name"]:28} {len(data["brushes"]):5} brushes '
                  f'{len(data["entities"]):4} entities {size // 1024:5} KB')
    with open(os.path.join(args.out, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)


if __name__ == "__main__":
    main()
