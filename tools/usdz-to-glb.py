#!/usr/bin/env python3
"""
Convertit un modèle USDZ (ex. export Sketchfab / Reality Composer) en GLB,
le format 3D lu par Three.js sur le site.

- lit chaque Mesh (positions, normales, triangles) avec sa transformation
  monde et son matériau UsdPreviewSurface (couleur, métal, rugosité) ;
- centre le modèle (x, z), pose sa base à y = 0 et le ramène à une hauteur de 1 ;
- écrit un GLB : un mesh + un matériau PBR par partie, nommés comme dans l'USD.

Dépendance : pip install usd-core
Usage      : python3 tools/usdz-to-glb.py modele.usdz assets/3d/ballon-dor.glb
"""
import json
import struct
import sys
import tempfile
import zipfile

from pxr import Gf, Usd, UsdGeom, UsdShade


def read_usdz(path):
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(path) as z:
        z.extractall(tmp)
        first = next(n for n in z.namelist() if n.endswith((".usdc", ".usda", ".usd")))
    return Usd.Stage.Open(f"{tmp}/{first}")


def material_of(prim):
    mat = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    out = {"name": "default", "color": (0.8, 0.8, 0.8), "metallic": 0.0, "roughness": 0.5}
    if not mat:
        return out
    out["name"] = mat.GetPrim().GetName()
    for p in mat.GetPrim().GetChildren():
        sh = UsdShade.Shader(p)
        if sh and sh.GetIdAttr().Get() == "UsdPreviewSurface":
            for key, inp in (("color", "diffuseColor"), ("metallic", "metallic"), ("roughness", "roughness")):
                i = sh.GetInput(inp)
                if i and i.Get() is not None:
                    v = i.Get()
                    out[key] = tuple(v) if key == "color" else float(v)
    return out


def main(src, dst):
    stage = read_usdz(src)
    cache = UsdGeom.XformCache()
    parts = []
    for prim in stage.Traverse():
        if prim.GetTypeName() != "Mesh":
            continue
        mesh = UsdGeom.Mesh(prim)
        m = cache.GetLocalToWorldTransform(prim)
        nm = m.GetInverse().GetTranspose()
        pts = [m.Transform(Gf.Vec3d(*p)) for p in mesh.GetPointsAttr().Get()]
        normals = mesh.GetNormalsAttr().Get()
        if normals is None or mesh.GetNormalsInterpolation() != "vertex" or len(normals) != len(pts):
            normals = None
        else:
            normals = [nm.TransformDir(Gf.Vec3d(*n)).GetNormalized() for n in normals]
        counts = mesh.GetFaceVertexCountsAttr().Get()
        idx = mesh.GetFaceVertexIndicesAttr().Get()
        tris, k = [], 0
        for c in counts:  # éventail : polygones → triangles
            for j in range(1, c - 1):
                tris += [idx[k], idx[k + j], idx[k + j + 1]]
            k += c
        if mesh.GetOrientationAttr().Get() == "leftHanded":
            for t in range(0, len(tris), 3):
                tris[t + 1], tris[t + 2] = tris[t + 2], tris[t + 1]
        parts.append({"name": prim.GetParent().GetParent().GetName(), "pts": pts, "normals": normals,
                      "tris": tris, "mat": material_of(prim)})

    # centrage + hauteur 1
    allp = [p for part in parts for p in part["pts"]]
    lo = [min(p[i] for p in allp) for i in range(3)]
    hi = [max(p[i] for p in allp) for i in range(3)]
    cx, cz, base, h = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, lo[1], hi[1] - lo[1]
    for part in parts:
        part["pts"] = [((p[0] - cx) / h, (p[1] - base) / h, (p[2] - cz) / h) for p in part["pts"]]

    # GLB
    bin_ = bytearray()
    views, accessors, meshes, materials, nodes = [], [], [], [], []

    def add_view(data, target):
        while len(bin_) % 4:
            bin_.append(0)
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data), "target": target})
        bin_.extend(data)
        return len(views) - 1

    for part in parts:
        pts = part["pts"]
        pos = struct.pack(f"<{len(pts) * 3}f", *[c for p in pts for c in p])
        a_pos = len(accessors)
        accessors.append({"bufferView": add_view(pos, 34962), "componentType": 5126, "count": len(pts), "type": "VEC3",
                          "min": [min(p[i] for p in pts) for i in range(3)], "max": [max(p[i] for p in pts) for i in range(3)]})
        attrs = {"POSITION": a_pos}
        if part["normals"]:
            nrm = struct.pack(f"<{len(pts) * 3}f", *[c for n in part["normals"] for c in n])
            attrs["NORMAL"] = len(accessors)
            accessors.append({"bufferView": add_view(nrm, 34962), "componentType": 5126, "count": len(pts), "type": "VEC3"})
        big = len(pts) > 65535
        ind = struct.pack(f"<{len(part['tris'])}{'I' if big else 'H'}", *part["tris"])
        a_ind = len(accessors)
        accessors.append({"bufferView": add_view(ind, 34963), "componentType": 5125 if big else 5123,
                          "count": len(part["tris"]), "type": "SCALAR"})
        mat = part["mat"]
        materials.append({"name": mat["name"], "pbrMetallicRoughness": {
            "baseColorFactor": [*mat["color"], 1.0], "metallicFactor": mat["metallic"], "roughnessFactor": mat["roughness"]}})
        meshes.append({"name": part["name"], "primitives": [{"attributes": attrs, "indices": a_ind, "material": len(materials) - 1}]})
        nodes.append({"name": part["name"], "mesh": len(meshes) - 1})

    while len(bin_) % 4:
        bin_.append(0)
    gltf = {"asset": {"version": "2.0", "generator": "tools/usdz-to-glb.py"},
            "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
            "materials": materials, "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942) + bin_)
    for part in parts:
        print(f"{part['name']}: {len(part['pts'])} sommets, {len(part['tris']) // 3} triangles, matériau {part['mat']['name']}")
    print(f"→ {dst} ({(28 + len(js) + len(bin_)) // 1024} Ko)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
