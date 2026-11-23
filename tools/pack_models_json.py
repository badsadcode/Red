#!/usr/bin/env python3
"""Pack the GLB models into small JSON files (for hosts that won't serve .glb).

Each output is {"pos": b64 float32 xyz, "nor": b64 float32 xyz, "col": b64 uint8 rgba,
"idx": b64 uint16|uint32, "idxType": "u16"|"u32"}; src/assets.js decodes it without
any network fetch of data: URIs. Also writes a manifest copy that points at the JSON files.

    python3 tools/pack_models_json.py OUT_DIR
"""
import base64
import json
import os
import struct
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "assets")
COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = open(path, "rb").read()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", path
    off = 12
    gltf, binchunk = None, b""
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif ctype == 0x004E4942:
            binchunk = chunk
        off += 8 + clen
    return gltf, binchunk


def accessor_bytes(gltf, binchunk, idx):
    acc = gltf["accessors"][idx]
    view = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = COMP[acc["componentType"]]
    n = NCOMP[acc["type"]]
    count = acc["count"]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 0) or size * n
    if stride == size * n:
        raw = binchunk[start: start + count * stride]
    else:
        raw = b"".join(binchunk[start + i * stride: start + i * stride + size * n] for i in range(count))
    return raw, acc


def pack(path):
    gltf, binchunk = read_glb(path)
    prim = gltf["meshes"][0]["primitives"][0]
    at = prim["attributes"]
    out = {}
    pos, _ = accessor_bytes(gltf, binchunk, at["POSITION"])
    out["pos"] = base64.b64encode(pos).decode()
    if "NORMAL" in at:
        nor, _ = accessor_bytes(gltf, binchunk, at["NORMAL"])
        out["nor"] = base64.b64encode(nor).decode()
    if "COLOR_0" in at:
        col, acc = accessor_bytes(gltf, binchunk, at["COLOR_0"])
        if acc["componentType"] == 5126:  # float colours -> uint8
            vals = struct.unpack("<%df" % (len(col) // 4), col)
            n = NCOMP[acc["type"]]
            rgba = []
            for i in range(0, len(vals), n):
                c = list(vals[i:i + n]) + ([1.0] if n == 3 else [])
                rgba += [max(0, min(255, round(v * 255))) for v in c]
            col = bytes(rgba)
        elif NCOMP[acc["type"]] == 3:
            col = b"".join(col[i:i + 3] + b"\xff" for i in range(0, len(col), 3))
        out["col"] = base64.b64encode(col).decode()
    if "indices" in prim:
        idx, acc = accessor_bytes(gltf, binchunk, prim["indices"])
        if acc["componentType"] == 5121:
            idx = struct.pack("<%dH" % len(idx), *idx)
            out["idxType"] = "u16"
        else:
            out["idxType"] = "u32" if acc["componentType"] == 5125 else "u16"
        out["idx"] = base64.b64encode(idx).decode()
    return out


def main():
    out_dir = sys.argv[1]
    os.makedirs(os.path.join(out_dir, "models"), exist_ok=True)
    manifest = json.load(open(os.path.join(ROOT, "manifest.json")))
    for name, info in manifest["models"].items():
        src = os.path.join(ROOT, info["file"])
        packed = pack(src)
        rel = "models/%s.json" % name
        with open(os.path.join(out_dir, rel), "w") as fh:
            json.dump(packed, fh, separators=(",", ":"))
        info["file"] = rel
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print("packed", len(manifest["models"]), "models")


if __name__ == "__main__":
    main()
