#!/usr/bin/env python3
"""Fetch CC0 low-poly models from Quaternius and convert them to compact GLBs.

Run:  python3 -I tools/fetch_models.py [--cache DIR] [--only name,name]

Quaternius packs live in public Google Drive folders (see tools/drive.py).
Each wanted OBJ (+MTL) is downloaded and converted to a GLB with:
  - ONE mesh, ONE primitive, ONE material (white, vertexColors)
  - POSITION (float32), NORMAL (float32), COLOR_0 (normalised uint8 RGBA,
    LINEAR colour, i.e. the Blender Kd values, as glTF requires)
  - metres, +Y up, centred in X/Z, base at Y = 0, scaled by a per-model rule.
Writes the "models" block of assets/manifest.json. Stdlib only (+ Pillow if a
material has a texture map, which is then baked into vertex colours).
"""
import argparse, json, math, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drive

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models")
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")

PACKS = {
    "ultimatenature": "Ultimate Nature Pack",
    "animatedfish": "Animated Fish Pack",
    "cutefish": "Cute Fish Pack",
    "survival": "Survival Pack",
    "ultimatehomeinterior": "Ultimate Home Interior Pack",
    "ultimatefurniture": "Ultimate Furniture Pack",
    "ultimatefood": "Ultimate Food Pack",
    "ultimatemodularscifi": "Ultimate Modular Sci-Fi Pack",
}

# (pack, source OBJ name, output name, rule)
#   rule: ("h", m) height  | ("len", m) longest horizontal side | ("max", m) longest side
def _nature():
    L = []
    for i, h in zip(range(1, 6), (18, 21, 15, 23, 17)):
        L.append(("ultimatenature", f"PineTree_{i}", f"pine_{i}", ("h", h)))
    L += [("ultimatenature", "CommonTree_1", "tree_common_1", ("h", 12)),
          ("ultimatenature", "CommonTree_2", "tree_common_2", ("h", 10)),
          ("ultimatenature", "BirchTree_1", "birch_1", ("h", 11)),
          ("ultimatenature", "BirchTree_2", "birch_2", ("h", 9)),
          ("ultimatenature", "BirchTree_Dead_1", "tree_dead_1", ("h", 9))]
    for i, s in zip(range(1, 8), (1.2, 2.0, 0.8, 3.0, 1.5, 2.4, 0.6)):
        L.append(("ultimatenature", f"Rock_Moss_{i}", f"rock_moss_{i}", ("max", s)))
    for i, s in zip(range(1, 4), (1.4, 2.6, 0.9)):
        L.append(("ultimatenature", f"Rock_{i}", f"rock_{i}", ("max", s)))
    L += [("ultimatenature", "Bush_1", "bush_1", ("h", 1.0)),
          ("ultimatenature", "Bush_2", "bush_2", ("h", 1.2)),
          ("ultimatenature", "BushBerries_1", "bush_berries_1", ("h", 0.9)),
          ("ultimatenature", "BushBerries_2", "bush_berries_2", ("h", 1.1)),
          ("ultimatenature", "TreeStump_Moss", "stump_moss", ("h", 0.5)),
          ("ultimatenature", "TreeStump", "stump", ("h", 0.55)),
          ("ultimatenature", "WoodLog_Moss", "log_moss", ("len", 3.6)),
          ("ultimatenature", "WoodLog", "log", ("len", 3.2)),
          ("ultimatenature", "Plant_1", "plant_1", ("h", 0.5)),
          ("ultimatenature", "Plant_2", "plant_2", ("h", 0.6)),
          ("ultimatenature", "Plant_3", "plant_3", ("h", 0.45)),
          ("ultimatenature", "Lilypad", "lilypad", ("len", 0.5)),
          ("ultimatenature", "Grass", "grass", ("h", 0.45)),
          ("ultimatenature", "Grass_Short", "grass_short", ("h", 0.25)),
          ("ultimatenature", "Flowers", "flowers", ("h", 0.35))]
    return L

CATALOGUE = _nature() + [
    # fish + fishing
    ("animatedfish", "Fish1", "fish_1", ("max", 0.40)),
    ("animatedfish", "Fish2", "fish_2", ("max", 0.45)),
    ("animatedfish", "Fish3", "fish_3", ("max", 0.35)),
    ("cutefish", "FishingRod_Lvl1", "fishing_rod", ("max", 2.0)),
    ("cutefish", "Lure_1", "lure", ("max", 0.06)),
    ("cutefish", "Worm", "worm", ("max", 0.06)),
    ("cutefish", "Boat", "rowboat", ("len", 3.6)),
    ("cutefish", "Dock_Long", "dock_long", ("len", 6.0)),
    ("cutefish", "Dock_Stairs", "dock_stairs", ("len", 2.0)),
    # survival / tools
    ("survival", "Axe", "axe", ("max", 0.8)),
    ("survival", "Axe_Small", "hatchet", ("max", 0.45)),
    ("survival", "Backpack", "backpack", ("h", 0.55)),
    ("survival", "Battery_Big", "battery_big", ("max", 0.11)),
    ("survival", "Battery_Small", "battery_small", ("max", 0.05)),
    ("survival", "Can_Closed", "can_closed", ("h", 0.12)),
    ("survival", "Can_Open", "can_open", ("h", 0.11)),
    ("survival", "FirstAidKit", "first_aid_kit", ("max", 0.32)),
    ("survival", "Radio", "radio", ("max", 0.32)),
    ("survival", "Pan", "pan", ("max", 0.45)),
    ("survival", "Pot", "pot", ("max", 0.28)),
    ("survival", "Bonfire", "bonfire", ("len", 1.0)),
    ("survival", "WoodLog", "firewood", ("max", 0.55)),
    ("survival", "Compass_Open", "compass", ("max", 0.08)),
    ("survival", "Shovel", "shovel", ("max", 1.1)),
    ("survival", "Raft_Paddle", "paddle", ("max", 1.5)),
    ("survival", "Torch", "flashlight", ("max", 0.25)),
    ("survival", "GasCan", "gas_can", ("h", 0.4)),
    ("survival", "PropaneTank", "propane_tank", ("h", 0.45)),
    ("survival", "Matchbox", "matchbox", ("max", 0.06)),
    ("survival", "Trashcan", "trashcan", ("h", 0.8)),
    ("survival", "BearTrap_Open", "bear_trap", ("len", 0.5)),
    ("survival", "Bandages", "bandages", ("max", 0.1)),
    ("survival", "WaterBottle_1", "water_bottle", ("h", 0.25)),
    ("survival", "FlareGun", "flare_gun", ("max", 0.25)),
    # cabin interior
    ("ultimatehomeinterior", "Bed_King", "bed_double", ("len", 2.1)),
    ("ultimatehomeinterior", "Bed_Single", "bed_single", ("len", 2.0)),
    ("ultimatehomeinterior", "Bookshelf", "bookshelf", ("h", 1.9)),
    ("ultimatehomeinterior", "Carpet_1", "rug", ("len", 2.4)),
    ("ultimatehomeinterior", "Carpet_Round", "rug_round", ("len", 1.6)),
    ("ultimatehomeinterior", "Chair_1", "chair_1", ("h", 0.9)),
    ("ultimatehomeinterior", "Chair_2", "chair_2", ("h", 0.9)),
    ("ultimatehomeinterior", "Couch_Medium1", "couch", ("len", 1.9)),
    ("ultimatehomeinterior", "Drawer_1", "drawer", ("h", 0.85)),
    ("ultimatehomeinterior", "Fireplace", "fireplace", ("h", 1.2)),
    ("ultimatehomeinterior", "Kitchen_Fridge", "fridge", ("h", 1.75)),
    ("ultimatehomeinterior", "Kitchen_Oven", "oven", ("h", 0.9)),
    ("ultimatehomeinterior", "Kitchen_Sink", "kitchen_sink", ("h", 0.9)),
    ("ultimatehomeinterior", "Kitchen_Cabinet1", "kitchen_cabinet", ("h", 0.9)),
    ("ultimatehomeinterior", "Kitchen_2Drawers", "kitchen_drawers", ("h", 0.9)),
    ("ultimatehomeinterior", "Light_Desk", "lamp_desk", ("h", 0.45)),
    ("ultimatehomeinterior", "Light_Floor1", "lamp_floor", ("h", 1.6)),
    ("ultimatehomeinterior", "Light_CeilingSingle", "lamp_ceiling", ("len", 0.4)),
    ("ultimatehomeinterior", "NightStand_1", "nightstand", ("h", 0.55)),
    ("ultimatehomeinterior", "Shelf_Small1", "wall_shelf", ("len", 0.9)),
    ("ultimatehomeinterior", "Table_RoundSmall", "table_round", ("h", 0.75)),
    ("ultimatehomeinterior", "Stool", "stool", ("h", 0.45)),
    ("ultimatehomeinterior", "Plate_1", "plate", ("len", 0.25)),
    ("ultimatehomeinterior", "Trashcan_Small1", "trashcan_small", ("h", 0.35)),
    ("ultimatehomeinterior", "Houseplant_1", "houseplant", ("h", 0.6)),
    ("ultimatehomeinterior", "Door_1", "door_wood", ("h", 2.05)),
    ("ultimatefurniture", "Table", "table", ("h", 0.76)),
    ("ultimatefurniture", "Desk", "desk", ("h", 0.76)),
    ("ultimatefurniture", "OfficeChair", "office_chair", ("h", 1.0)),
    ("ultimatefurniture", "Closet", "closet", ("h", 2.0)),
    # food
    ("ultimatefood", "Fish", "fish_cooked", ("max", 0.32)),
    ("ultimatefood", "FishBone", "fish_bone", ("max", 0.3)),
    ("ultimatefood", "Mushroom", "mushroom", ("h", 0.12)),
    ("ultimatefood", "CookingPot_Soup", "pot_soup", ("max", 0.32)),
    ("ultimatefood", "FryingPan", "frying_pan", ("max", 0.45)),
    ("ultimatefood", "Bread", "bread", ("max", 0.3)),
    ("ultimatefood", "Apple", "apple", ("max", 0.08)),
    ("ultimatefood", "Steak", "steak", ("max", 0.22)),
    ("ultimatefood", "Jar_Large", "jar", ("h", 0.22)),
    ("ultimatefood", "Soda", "soda", ("h", 0.12)),
    ("ultimatefood", "ChocolateBar", "chocolate_bar", ("max", 0.15)),
    ("ultimatefood", "Egg_Fried", "egg_fried", ("max", 0.12)),
    ("ultimatefood", "Bottle1", "bottle", ("h", 0.3)),
    # facility props
    ("ultimatemodularscifi", "Props_Computer", "computer", ("h", 1.9)),
    ("ultimatemodularscifi", "Props_ComputerSmall", "computer_small", ("h", 1.1)),
    ("ultimatemodularscifi", "Props_Crate", "crate", ("max", 1.0)),
    ("ultimatemodularscifi", "Props_CrateLong", "crate_long", ("max", 2.0)),
    ("ultimatemodularscifi", "Props_ContainerFull", "container", ("max", 1.4)),
    ("ultimatemodularscifi", "Props_Shelf", "shelf", ("h", 1.9)),
    ("ultimatemodularscifi", "Props_Shelf_Tall", "shelf_tall", ("h", 2.8)),
    ("ultimatemodularscifi", "Props_Capsule", "capsule", ("h", 2.3)),
    ("ultimatemodularscifi", "Props_Pod", "pod", ("h", 1.8)),
    ("ultimatemodularscifi", "Props_Vessel", "vessel", ("h", 1.6)),
    ("ultimatemodularscifi", "Props_Vessel_Tall", "vessel_tall", ("h", 2.6)),
    ("ultimatemodularscifi", "Props_Vessel_Short", "vessel_short", ("h", 1.0)),
    ("ultimatemodularscifi", "Props_Chest", "chest", ("max", 0.8)),
    ("ultimatemodularscifi", "Props_Laser", "laser", ("h", 1.6)),
    ("ultimatemodularscifi", "Props_Teleporter_1", "teleporter", ("len", 3.0)),
    ("ultimatemodularscifi", "Props_Base", "machine_base", ("len", 1.5)),
    ("ultimatemodularscifi", "Props_Statue", "statue", ("h", 2.2)),
    ("ultimatemodularscifi", "Pipes", "pipes", ("max", 2.0)),
    ("ultimatemodularscifi", "Details_Pipes_Long", "pipes_long", ("max", 4.0)),
    ("ultimatemodularscifi", "Details_Vent_1", "vent", ("max", 1.0)),
    ("ultimatemodularscifi", "Column_1", "column", ("h", 3.0)),
    ("ultimatemodularscifi", "Staircase", "staircase", ("h", 2.0)),
]

# ---------------------------------------------------------------- OBJ / MTL
def parse_mtl(path, folder_dir):
    mats, cur = {}, None
    if not os.path.exists(path):
        return mats
    for line in open(path, encoding="utf-8", errors="replace"):
        p = line.split()
        if not p:
            continue
        if p[0] == "newmtl":
            cur = " ".join(p[1:]); mats[cur] = {"kd": (0.8, 0.8, 0.8), "map": None}
        elif cur and p[0] == "Kd":
            mats[cur]["kd"] = tuple(float(x) for x in p[1:4])
        elif cur and p[0] == "map_Kd":
            mats[cur]["map"] = os.path.basename(" ".join(p[1:]).replace("\\", "/"))
    return mats

def srgb_to_lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def parse_obj(path, mats, tex_lookup):
    V, VN, VT = [], [], []
    tris = []  # list of (positions[3], normals[3] or None, colour(s)[3])
    colour = (0.8, 0.8, 0.8); cur_map = None
    images = {}
    def sample(img, uv):
        w, h = img.size
        x = int((uv[0] % 1.0) * (w - 1)); y = int((1 - (uv[1] % 1.0)) * (h - 1))
        r, g, b = img.getpixel((x, y))[:3]
        return (srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b))
    for line in open(path, encoding="utf-8", errors="replace"):
        p = line.split()
        if not p:
            continue
        t = p[0]
        if t == "v":
            V.append(tuple(float(x) for x in p[1:4]))
        elif t == "vn":
            VN.append(tuple(float(x) for x in p[1:4]))
        elif t == "vt":
            VT.append(tuple(float(x) for x in p[1:3]))
        elif t == "usemtl":
            m = mats.get(" ".join(p[1:]), {"kd": (0.8, 0.8, 0.8), "map": None})
            colour = m["kd"]; cur_map = None
            if m["map"]:
                fp = tex_lookup(m["map"])
                if fp:
                    if fp not in images:
                        from PIL import Image
                        images[fp] = Image.open(fp).convert("RGB")
                    cur_map = images[fp]
        elif t == "f":
            idx = []
            for tok in p[1:]:
                parts = tok.split("/")
                vi = int(parts[0]); vi = vi - 1 if vi > 0 else len(V) + vi
                ti = None
                if len(parts) > 1 and parts[1]:
                    ti = int(parts[1]); ti = ti - 1 if ti > 0 else len(VT) + ti
                ni = None
                if len(parts) > 2 and parts[2]:
                    ni = int(parts[2]); ni = ni - 1 if ni > 0 else len(VN) + ni
                idx.append((vi, ti, ni))
            for k in range(1, len(idx) - 1):
                tri = (idx[0], idx[k], idx[k + 1])
                pos = [V[a[0]] for a in tri]
                nrm = [VN[a[2]] if a[2] is not None else None for a in tri]
                if cur_map is not None and all(a[1] is not None for a in tri):
                    cols = [sample(cur_map, VT[a[1]]) for a in tri]
                else:
                    cols = [colour] * 3
                tris.append((pos, nrm, cols))
    return tris

def face_normal(p):
    ax, ay, az = (p[1][i] - p[0][i] for i in range(3))
    bx, by, bz = (p[2][i] - p[0][i] for i in range(3))
    n = (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
    l = math.sqrt(sum(c * c for c in n)) or 1.0
    return tuple(c / l for c in n)

def norm(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / l for c in v)

# ---------------------------------------------------------------- GLB writer
def build_glb(tris, rule, name):
    xs = [v[0] for t in tris for v in t[0]]
    ys = [v[1] for t in tris for v in t[0]]
    zs = [v[2] for t in tris for v in t[0]]
    w, h, d = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    kind, target = rule
    ref = {"h": h, "len": max(w, d), "max": max(w, h, d)}[kind] or 1.0
    s = target / ref
    cx, cz, by = (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2, min(ys)
    verts, index, lookup = [], [], {}
    for pos, nrm, cols in tris:
        fn = face_normal(pos)
        for i in range(3):
            p = ((pos[i][0] - cx) * s, (pos[i][1] - by) * s, (pos[i][2] - cz) * s)
            n = norm(nrm[i]) if nrm[i] is not None else fn
            c = tuple(max(0, min(255, int(round(ch * 255)))) for ch in cols[i])
            key = (tuple(round(x, 5) for x in p), tuple(round(x, 4) for x in n), c)
            j = lookup.get(key)
            if j is None:
                j = len(verts); lookup[key] = j; verts.append(key)
            index.append(j)
    nv = len(verts)
    pos_b = b"".join(struct.pack("<3f", *v[0]) for v in verts)
    nrm_b = b"".join(struct.pack("<3f", *v[1]) for v in verts)
    col_b = b"".join(struct.pack("<4B", *v[2], 255) for v in verts)
    big = nv > 65535
    idx_b = struct.pack(f"<{len(index)}{'I' if big else 'H'}", *index)
    pad = lambda b: b + b"\x00" * ((4 - len(b) % 4) % 4)
    chunks, views, off = [], [], 0
    for b, target_ in ((pos_b, 34962), (nrm_b, 34962), (col_b, 34962), (idx_b, 34963)):
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), "target": target_})
        pb = pad(b); chunks.append(pb); off += len(pb)
    bin_ = b"".join(chunks)
    P = [v[0] for v in verts]
    gltf = {
        "asset": {"version": "2.0", "generator": "badideas tools/fetch_models.py"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "materials": [{"name": "vertex_colour", "pbrMetallicRoughness":
                       {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.9}}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
                                                   "indices": 3, "material": 0}]}],
        "buffers": [{"byteLength": len(bin_)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": nv, "type": "VEC3",
             "min": [min(p[i] for p in P) for i in range(3)], "max": [max(p[i] for p in P) for i in range(3)]},
            {"bufferView": 1, "componentType": 5126, "count": nv, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5121, "normalized": True, "count": nv, "type": "VEC4"},
            {"bufferView": 3, "componentType": 5125 if big else 5123, "count": len(index), "type": "SCALAR"},
        ],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    glb = struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js \
        + struct.pack("<II", len(bin_), 0x004E4942) + bin_
    size = [round(c, 3) for c in (w * s, h * s, d * s)]
    return glb, size, len(index) // 3

def validate_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67 and ver == 2 and total == len(b), "bad header"
    jl, jt = struct.unpack_from("<II", b, 12); assert jt == 0x4E4F534A
    g = json.loads(b[20:20 + jl])
    bl, bt = struct.unpack_from("<II", b, 20 + jl); assert bt == 0x004E4942
    assert bl == g["buffers"][0]["byteLength"]
    for v in g["bufferViews"]:
        assert v["byteOffset"] + v["byteLength"] <= bl and v["byteOffset"] % 4 == 0
    acc = g["accessors"]; nv = acc[0]["count"]
    assert acc[1]["count"] == nv == acc[2]["count"]
    ib = 20 + jl + 8 + g["bufferViews"][3]["byteOffset"]
    fmt = "I" if acc[3]["componentType"] == 5125 else "H"
    idx = struct.unpack_from(f"<{acc[3]['count']}{fmt}", b, ib)
    assert max(idx) < nv and acc[3]["count"] % 3 == 0
    return True

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "quaternius"))
    ap.add_argument("--only", default=None)
    a = ap.parse_args()
    only = set(a.only.split(",")) if a.only else None
    os.makedirs(OUT, exist_ok=True)
    listings = {}
    entries = {}
    for pack, src, out, rule in CATALOGUE:
        if only and out not in only:
            continue
        if pack not in listings:
            folder = drive.pack_folder(pack)
            obj_dir = drive.find_sub(folder, "OBJ")
            listings[pack] = {n: eid for eid, n, isf in drive.list_folder(obj_dir)}
            os.makedirs(os.path.join(a.cache, pack), exist_ok=True)
        files = listings[pack]
        cdir = os.path.join(a.cache, pack)
        if src + ".obj" not in files:
            print(f"!! {pack}/{src}.obj not found, skipped"); continue
        objp = drive.download(files[src + ".obj"], os.path.join(cdir, src + ".obj"))
        mtlp = os.path.join(cdir, src + ".mtl")
        if src + ".mtl" in files:
            drive.download(files[src + ".mtl"], mtlp)
        def tex_lookup(fname):
            if fname in files:
                return drive.download(files[fname], os.path.join(cdir, fname))
            return None
        mats = parse_mtl(mtlp, cdir)
        tris = parse_obj(objp, mats, tex_lookup)
        glb, size, ntri = build_glb(tris, rule, out)
        path = os.path.join(OUT, out + ".glb")
        open(path, "wb").write(glb)
        validate_glb(path)
        entries[out] = {"file": f"models/{out}.glb", "size": size, "tris": ntri,
                        "pack": f"Quaternius {PACKS[pack]}", "source": src, "colorSpace": "linear"}
        print(f"{out:18s} {size} {ntri} tris {len(glb)//1024} KB", flush=True)
    man = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    man.setdefault("models", {}).update(entries)
    json.dump(man, open(MANIFEST, "w"), indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"models: {len(os.listdir(OUT))} files, {total/1024:.0f} KB")

if __name__ == "__main__":
    main()
