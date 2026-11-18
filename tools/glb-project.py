#!/usr/bin/env python3
"""
Habille un maillot 3D avec deux photos à plat (face + dos), par projection.

Les générateurs image→3D inventent mal le dos d'un maillot. Ce script garde
seulement la forme du modèle (GLB) et refait sa texture : chaque triangle
tourné vers l'avant reçoit la photo de face, chaque triangle tourné vers
l'arrière reçoit la photo de dos (vue de dos, donc retournée gauche/droite),
cadrées sur la silhouette du maillot. Les deux photos sont réunies dans une
seule texture (atlas 2 × 1).

Le modèle doit regarder vers +Z (face), Y vers le haut.

Usage :
  python3 tools/glb-project.py modele.glb face.png dos.png sortie.glb [--size 1024]
Dépendances : numpy, Pillow.
"""
import argparse
import io
import json
import struct

import numpy as np
from PIL import Image

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = open(path, "rb").read()
    off, gltf, binc = 12, None, b""
    while off < len(data):
        ln, typ = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + ln]
        if typ == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif typ == 0x004E4942:
            binc = chunk
        off += 8 + ln
    return gltf, binc


def accessor(gltf, binc, i):
    a = gltf["accessors"][i]
    bv = gltf["bufferViews"][a["bufferView"]]
    dt = np.dtype(COMP[a["componentType"]])
    n = NCOMP[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0) or dt.itemsize * n
    raw = np.frombuffer(binc, dtype=np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], dt.itemsize * n), strides=(stride, 1))
    return np.frombuffer(out.copy().tobytes(), dtype=dt).reshape(a["count"], n)


def node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    t = np.array(node.get("translation", [0, 0, 0]), dtype=np.float64)
    q = node.get("rotation", [0, 0, 0, 1])
    s = np.array(node.get("scale", [1, 1, 1]), dtype=np.float64)
    x, y, z, w = q
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def world_triangles(gltf, binc):
    """Tous les triangles du modèle, en coordonnées monde (N × 3 × 3)."""
    tris = []

    def walk(ni, parent):
        node = gltf["nodes"][ni]
        m = parent @ node_matrix(node)
        if "mesh" in node:
            for prim in gltf["meshes"][node["mesh"]]["primitives"]:
                pos = accessor(gltf, binc, prim["attributes"]["POSITION"]).astype(np.float64)
                pos = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3]
                idx = accessor(gltf, binc, prim["indices"]).ravel() if "indices" in prim else np.arange(len(pos))
                tris.append(pos[idx].reshape(-1, 3, 3))
        for c in node.get("children", []):
            walk(c, m)

    scene = gltf["scenes"][gltf.get("scene", 0)]
    for ni in scene["nodes"]:
        walk(ni, np.eye(4))
    return np.concatenate(tris)


def silhouette(img):
    """Contour opaque (alpha > 128) en fraction de l'image : x0, y0, x1, y1."""
    a = np.asarray(img.getchannel("A")) > 128
    ys, xs = np.nonzero(a)
    h, w = a.shape
    return xs.min() / w, ys.min() / h, (xs.max() + 1) / w, (ys.max() + 1) / h


def main(model, front, back, dst, size):
    gltf, binc = read_glb(model)
    tri = world_triangles(gltf, binc)                          # N × 3 × 3
    lo, hi = tri.reshape(-1, 3).min(0), tri.reshape(-1, 3).max(0)
    span = hi - lo

    # normales de face → côté (face / dos)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    is_back = n[:, 2] < 0

    imgs = [Image.open(front).convert("RGBA"), Image.open(back).convert("RGBA")]
    boxes = [silhouette(im) for im in imgs]

    # atlas : face à gauche, dos à droite, fond = couleur moyenne du tissu (bords)
    atlas = Image.new("RGB", (size * 2, size), (40, 40, 90))
    for k, (im, b) in enumerate(zip(imgs, boxes)):
        crop = im.crop((round(b[0] * im.width), round(b[1] * im.height), round(b[2] * im.width), round(b[3] * im.height)))
        crop = crop.resize((size, size), Image.LANCZOS)
        rgb = np.asarray(crop.convert("RGB")).astype(np.float64)
        alpha = np.asarray(crop.getchannel("A")).astype(np.float64)[..., None] / 255
        fill = (rgb * alpha).sum((0, 1)) / max(alpha.sum(), 1)   # couleur moyenne → bords sans halo blanc
        flat = (rgb * alpha + fill * (1 - alpha)).astype(np.uint8)
        atlas.paste(Image.fromarray(flat), (k * size, 0))

    # UV : x, y du sommet → place dans la silhouette (dos : gauche/droite inversés)
    p = tri.reshape(-1, 3)
    u = (p[:, 0] - lo[0]) / span[0]
    v = (p[:, 1] - lo[1]) / span[1]
    back_v = np.repeat(is_back, 3)
    u = np.where(back_v, 1 - u, u)
    u = (u * 0.998 + 0.001) * 0.5 + np.where(back_v, 0.5, 0.0)
    v = v * 0.998 + 0.001                                        # glTF : v = 0 en haut de l'image
    v = 1 - v
    uv = np.c_[u, v].astype(np.float32)

    # normales lissées par sommet (sommets fusionnés par position) pour un tissu doux
    key = np.round(p / (span.max() * 1e-5)).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    acc = np.zeros((inv.max() + 1, 3))
    np.add.at(acc, inv, np.repeat(n, 3, axis=0))
    vn = acc[inv]
    # pas de lissage à travers la couture face / dos
    vn = np.where((np.repeat(n[:, 2], 3)[:, None] * vn[:, 2:3]) < 0, np.repeat(n, 3, axis=0), vn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12

    # recentre, hauteur = 1
    pos = ((p - (lo + hi) / 2) / span[1]).astype(np.float32)
    vn = vn.astype(np.float32)

    # sommets identiques (position + normale + UV) fusionnés → géométrie indexée
    rows = np.round(np.c_[pos, vn, uv] * 1e5).astype(np.int64)
    _, first, inv2 = np.unique(rows, axis=0, return_index=True, return_inverse=True)
    pos, vn, uv = pos[first], vn[first], uv[first]
    idx = inv2.ravel().astype(np.uint16 if len(first) < 65536 else np.uint32)

    buf = io.BytesIO()
    atlas.save(buf, "JPEG", quality=85, optimize=True, progressive=True)
    jpg = buf.getvalue()

    parts = [pos.tobytes(), vn.tobytes(), uv.tobytes(), jpg, idx.tobytes()]
    blob, views = bytearray(), []
    for b in parts:
        blob += b"\0" * (-len(blob) % 4)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(b)})
        blob += b
    count = len(pos)
    out = {
        "asset": {"version": "2.0", "generator": "glb-project.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "maillot"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"name": "tissu", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.85}, "doubleSided": True}],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": 3, "mimeType": "image/jpeg"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3",
             "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": count, "type": "VEC2"},
            {"bufferView": 4, "componentType": 5123 if idx.dtype == np.uint16 else 5125, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": [dict(v, **({"target": 34962} if i < 3 else {"target": 34963} if i == 4 else {})) for i, v in enumerate(views)],
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(out, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    blob += b"\0" * (-len(blob) % 4)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    print(f"{len(tri)} triangles ({is_back.sum()} au dos), {count} sommets, {len(jpg) // 1024} Ko de texture")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model")
    ap.add_argument("front")
    ap.add_argument("back")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=1024)
    o = ap.parse_args()
    main(o.model, o.front, o.back, o.dst, o.size)
