"""
Maillot 3D avec Blender (module bpy) : forme commune + photos face / dos.

Pour chaque club, le script :
  1. importe la forme de maillot (un GLB, ex. assets/maillots/maillot-barca.glb),
     la recentre (hauteur 1) ;
  2. aplanit les petits reliefs de la forme (logos gravés par le générateur),
     sépare les faces tournées vers l'avant et vers l'arrière, coupe la couture
     entre les deux (normales lissées de chaque côté) ;
  3. projette la photo de face sur l'avant et la photo de dos sur l'arrière
     (UV dans un atlas 2 × 1, cadrées sur la silhouette des photos) ;
  4. calcule l'occlusion ambiante avec Cycles (plis, aisselles, col) et
     l'applique à la texture ;
  5. exporte un GLB léger (texture JPEG, tissu mat).

Usage (Blender en module Python : pip install bpy pillow numpy) :
  python tools/blender-maillot.py silhouette face.png dos.png sortie.glb [--size 1024] [--ao 0.55]
  (« silhouette » : forme construite depuis le contour de la photo de face ;
   ou le chemin d'un GLB pour partir d'une forme existante)

Repères : glTF Y en haut / +Z vers l'avant = Blender Z en haut / -Y vers l'avant.
"""
import argparse
import sys

import bpy  # en premier : bpy rend bmesh / mathutils importables
import bmesh
import mathutils
import numpy as np
from PIL import Image


def silhouette_crop(path, size):
    """Photo recadrée sur sa silhouette, fond rempli de la couleur moyenne du tissu."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im.getchannel("A")) > 128
    ys, xs = np.nonzero(a)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).resize((size, size), Image.LANCZOS)
    rgb = np.asarray(im.convert("RGB")).astype(np.float64)
    al = np.asarray(im.getchannel("A")).astype(np.float64)[..., None] / 255
    fill = (rgb * al).sum((0, 1)) / max(al.sum(), 1)
    return rgb * al + fill * (1 - al)


def inflate_from_silhouette(front, cols=170, thick=0.06, edge=0.08, folds=0.005):
    """Forme de maillot « gonflée » depuis la silhouette de la photo de face :
    grille dans le contour, profondeur = profil arrondi selon la distance au
    bord (avant en -Y, arrière en +Y, soudés sur le bord), légers plis de tissu.
    Unités : hauteur de la silhouette = 1."""
    im = Image.open(front).convert("RGBA")
    a = np.asarray(im.getchannel("A")) > 128
    ys, xs = np.nonzero(a)
    a = a[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    h0, w0 = a.shape
    rows = round(cols * h0 / w0)
    m = np.asarray(Image.fromarray(a.astype(np.uint8) * 255).resize((cols, rows), Image.BILINEAR)) > 127

    # fermeture : bouche les fentes fines de la photo (ex. Newell's, entre les deux moitiés)
    def morph(mask, grow, n):
        for _ in range(n):
            p = np.pad(mask, 1, constant_values=not grow)
            out = mask.copy()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nb = p[1 + dy: 1 + dy + mask.shape[0], 1 + dx: 1 + dx + mask.shape[1]]
                    out = (out | nb) if grow else (out & nb)
            mask = out
        return mask
    m = morph(morph(m, True, 3), False, 3)
    # distance au bord (érosions successives, voisinage 8)
    dist = np.zeros(m.shape)
    cur = m.copy()
    for k in range(1, max(rows, cols)):          # jusqu'au cœur (sinon trou au centre)
        p = np.pad(cur, 1)
        er = cur.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                er &= p[1 + dy: 1 + dy + rows, 1 + dx: 1 + dx + cols]
        dist[cur & ~er] = k
        cur = er
        if not cur.any():
            break
    cell = 1.0 / rows                                  # taille d'une case (hauteur = 1)
    t = np.clip((dist - 1) * cell / edge, 0, 1)        # 0 au bord → 1 à l'intérieur
    depth = thick * np.sqrt(1 - (1 - t) ** 2)          # profil arrondi
    gy, gx = np.mgrid[0:rows, 0:cols]
    X = (gx + 0.5) * cell - cols * cell / 2
    Z = (rows - gy - 0.5) * cell - 0.5
    wav = (np.sin(X * 23 + Z * 7) * 0.6 + np.sin(Z * 31 - X * 11) * 0.4) * folds * t

    bm = bmesh.new()
    idx = {}
    for side in (-1, 1):                               # -1 avant, +1 arrière
        for r in range(rows):
            for c in range(cols):
                if not m[r, c]:
                    continue
                d = 0.0 if dist[r, c] <= 1 else depth[r, c] + side * wav[r, c] * 0.5
                key = (r, c, 0 if dist[r, c] <= 1 else side)
                if key not in idx:
                    idx[key] = bm.verts.new((X[r, c], side * d, Z[r, c]))
        for r in range(rows - 1):
            for c in range(cols - 1):
                if not (m[r, c] and m[r, c + 1] and m[r + 1, c + 1] and m[r + 1, c]):
                    continue
                q = [(r, c), (r + 1, c), (r + 1, c + 1), (r, c + 1)]
                vs = [idx[(rr, cc, 0 if dist[rr, cc] <= 1 else side)] for rr, cc in q]
                if side > 0:
                    vs = vs[::-1]
                if len(set(vs)) == 4:
                    try:
                        bm.faces.new(vs)
                    except ValueError:
                        pass
    me = bpy.data.meshes.new("maillot")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("maillot", me)
    bpy.context.scene.collection.objects.link(obj)
    # bord moins crénelé : lissage léger (silhouette arrondie)
    mod = obj.modifiers.new("lisse", "SMOOTH")
    mod.factor = 0.6
    mod.iterations = 10
    return obj


def main(shape, front, back, dst, size, ao_strength, flatten, yaw=0.0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if shape == "silhouette":
        obj = inflate_from_silhouette(front)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier="lisse")
        # zones plates très simplifiables : on garde ~35 % des triangles
        dec = obj.modifiers.new("allege", "DECIMATE")
        dec.ratio = 0.35
        bpy.ops.object.modifier_apply(modifier=dec.name)
    else:
        bpy.ops.import_scene.gltf(filepath=shape)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if shape == "silhouette":
        meshes = [obj]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    if yaw:
        obj.rotation_euler.z += np.radians(yaw)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o is not obj:
            bpy.data.objects.remove(o)

    # aplanit les petits reliefs (logos gravés dans la forme par le générateur) :
    # carte de profondeur de l'avant et de l'arrière, floutée, puis chaque
    # sommet est replacé dessus. Silhouette (X, Z) et grands volumes intacts.
    if flatten > 0:
        me0 = obj.data
        me0.update()
        n_v = len(me0.vertices)
        co = np.empty(n_v * 3); me0.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        nr = np.empty(n_v * 3); me0.vertices.foreach_get("normal", nr); nr = nr.reshape(-1, 3)
        lo3, hi3 = co.min(0), co.max(0)
        G = 256
        gx = np.clip(((co[:, 0] - lo3[0]) / (hi3[0] - lo3[0]) * (G - 1)).round().astype(int), 0, G - 1)
        gz = np.clip(((co[:, 2] - lo3[2]) / (hi3[2] - lo3[2]) * (G - 1)).round().astype(int), 0, G - 1)
        sigma = flatten * G
        r = int(3 * sigma)
        k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
        k /= k.sum()

        def blur(a):
            a = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, a)
            return np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, a)

        y = co[:, 1].copy()
        for side in (-1, 1):                       # -1 = avant (-Y), +1 = arrière
            w = np.clip((side * nr[:, 1] - 0.25) / 0.45, 0, 1)
            sel = w > 0
            num = np.zeros((G, G)); den = np.zeros((G, G))
            np.add.at(num, (gz[sel], gx[sel]), co[sel, 1] * w[sel])
            np.add.at(den, (gz[sel], gx[sel]), w[sel])
            depth = blur(num) / np.maximum(blur(den), 1e-9)
            y[sel] = co[sel, 1] + w[sel] * (depth[gz[sel], gx[sel]] - co[sel, 1])
        co[:, 1] = y
        me0.vertices.foreach_set("co", co.ravel())
        me0.update()

    me = obj.data
    me.materials.clear()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()

    # recentre, hauteur 1
    co = np.array([v.co[:] for v in bm.verts])
    lo, hi = co.min(0), co.max(0)
    span = hi - lo
    center = (lo + hi) / 2
    for v in bm.verts:
        v.co = (v.co - mathutils.Vector(center)) / span[2]
    lo, hi = (lo - center) / span[2], (hi - center) / span[2]
    span = hi - lo

    # côté de chaque face : avant = -Y Blender
    is_back = {f.index: f.normal.y > 0 for f in bm.faces}
    # couture face/dos coupée : chaque côté garde des normales lisses
    seam = [e for e in bm.edges if len(e.link_faces) == 2
            and is_back[e.link_faces[0].index] != is_back[e.link_faces[1].index]]
    bmesh.ops.split_edges(bm, edges=seam)
    bm.faces.ensure_lookup_table()

    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        b = f.normal.y > 0
        for loop in f.loops:
            x, z = loop.vert.co.x, loop.vert.co.z
            u = (x - lo[0]) / span[0]
            if b:
                u = 1 - u                       # vue de dos : gauche ↔ droite
            u = (u * 0.998 + 0.001) * 0.5 + (0.5 if b else 0.0)
            v = (z - lo[2]) / span[2] * 0.998 + 0.001
            loop[uv].uv = (u, v)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()

    # atlas face | dos
    atlas = np.concatenate([silhouette_crop(front, size), silhouette_crop(back, size)], axis=1)

    # occlusion ambiante (Cycles) cuite dans les couleurs de sommets : assombrit
    # plis, col, dessous des manches. (Pas dans la texture : la projection
    # superpose des triangles dans l'atlas, la cuisson y ferait des taches.)
    if ao_strength > 0:
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 96
        if not scene.world:
            scene.world = bpy.data.worlds.new("monde")
        scene.world.light_settings.distance = 0.12      # portée des rayons (maillot = 1 de haut)
        attr = me.color_attributes.new("ao", "FLOAT_COLOR", "POINT")
        me.color_attributes.active_color = attr
        mat = bpy.data.materials.new("bake")
        mat.use_nodes = True
        me.materials.append(mat)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        scene.render.bake.target = "VERTEX_COLORS"
        bpy.ops.object.bake(type="AO")
        ao = np.array([c.color[0] for c in attr.data])
        ao = 1 - ao_strength + ao_strength * ao
        for c, a in zip(attr.data, ao):
            c.color = (a, a, a, 1.0)
        me.materials.clear()

    # matériau final : tissu mat, texture JPEG
    tex_img = Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8))
    tmp = dst + ".atlas.png"
    tex_img.save(tmp)
    img = bpy.data.images.load(tmp)
    img.pack()
    mat = bpy.data.materials.new("tissu")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.extension = "EXTEND"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    me.materials.append(mat)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE" if ao_strength > 0 else "NONE",
    )
    __import__("os").remove(tmp)
    print(f"[maillot] {dst} : {len(me.polygons)} faces")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("shape")
    ap.add_argument("front")
    ap.add_argument("back")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--ao", type=float, default=0.55)
    ap.add_argument("--flatten", type=float, default=0.02, help="flou de la profondeur, en fraction de la taille (0 = forme brute)")
    ap.add_argument("--yaw", type=float, default=0, help="rotation de la forme (degrés) pour tourner sa face vers l'avant")
    o = ap.parse_args(sys.argv[1:])
    main(o.shape, o.front, o.back, o.dst, o.size, o.ao, o.flatten, o.yaw)
