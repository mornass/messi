#!/usr/bin/env python3
"""
Allège un modèle GLB pour le web sans outil externe (Pillow seulement) :
chaque texture est réduite (côté max --max, 1024 par défaut) et réencodée en
JPEG (ou PNG si elle a de la transparence). La géométrie n'est pas touchée :
la générer directement avec un nombre de faces raisonnable (≈ 40 000).

Usage :
  python3 tools/glb-shrink.py entree.glb sortie.glb [--max 1024] [--quality 82]
"""
import argparse
import io
import json
import struct

from PIL import Image


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2, "pas un GLB v2"
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


def write_glb(path, gltf, binc):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binc += b"\0" * (-len(binc) % 4)
    total = 12 + 8 + len(js) + 8 + len(binc)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binc), 0x004E4942) + binc)


def main(src, dst, max_side, quality):
    gltf, binc = read_glb(src)
    views = gltf["bufferViews"]
    image_views = {img["bufferView"] for img in gltf.get("images", []) if "bufferView" in img}
    new_bytes = {}
    for img in gltf.get("images", []):
        if "bufferView" not in img:
            continue
        bv = views[img["bufferView"]]
        raw = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        im = Image.open(io.BytesIO(raw))
        im.load()
        if max(im.size) > max_side:
            k = max_side / max(im.size)
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        out = io.BytesIO()
        alpha = im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 255
        if alpha:
            im.save(out, "PNG", optimize=True)
            img["mimeType"] = "image/png"
        else:
            im.convert("RGB").save(out, "JPEG", quality=quality, optimize=True, progressive=True)
            img["mimeType"] = "image/jpeg"
        new_bytes[img["bufferView"]] = out.getvalue()
    # reconstruit le buffer binaire (alignement 4 octets par vue)
    blob = bytearray()
    for i, bv in enumerate(views):
        if i in image_views:
            chunk = new_bytes[i]
        else:
            chunk = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        blob += b"\0" * (-len(blob) % 4)
        bv["byteOffset"] = len(blob)
        bv["byteLength"] = len(chunk)
        blob += chunk
    gltf["buffers"] = [{"byteLength": len(blob)}]
    write_glb(dst, gltf, bytes(blob))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--max", type=int, default=1024)
    ap.add_argument("--quality", type=int, default=82)
    o = ap.parse_args()
    main(o.src, o.dst, o.max, o.quality)
