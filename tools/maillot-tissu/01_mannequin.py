"""
Étape 1 — Mannequin de torse homme (taille M), sans tête ni jambes, en collision.

MPFB2 n'étant pas téléchargeable ici, le torse est construit par coupes
anatomiques (bassin → cou : largeur, profondeur avant / arrière, pectoraux,
omoplates), plus deltoïdes et haut des bras en A-pose ; le tout est fusionné
(remaillage voxel), lissé, allégé, puis mis en collision pour la simulation.

Mesures (mètres, Z en haut, avant = -Y) : épaules à ~1,45 m, carrure ~46 cm,
tour de poitrine ~100 cm, taille ~84 cm.

Usage : python tools/maillot-tissu/01_mannequin.py sortie.blend
"""
import math
import sys

import bpy
import mathutils


# coupes du tronc : hauteur z, demi-largeur, profondeur avant, profondeur arrière,
# exposant de « superellipse » (2 = ovale, plus grand = plus carré)
SECTIONS = [
    (0.95, 0.170, 0.100, 0.115, 2.4),   # bassin
    (1.02, 0.165, 0.095, 0.105, 2.4),
    (1.10, 0.145, 0.095, 0.090, 2.3),   # taille
    (1.18, 0.150, 0.100, 0.095, 2.3),
    (1.25, 0.160, 0.110, 0.100, 2.4),   # côtes
    (1.32, 0.175, 0.120, 0.105, 2.6),   # poitrine
    (1.38, 0.180, 0.115, 0.110, 2.8),   # haut de poitrine
    (1.43, 0.175, 0.090, 0.100, 2.8),   # sous les épaules
    (1.47, 0.140, 0.070, 0.080, 2.4),   # trapèzes
    (1.50, 0.075, 0.055, 0.060, 2.0),   # base du cou
    (1.54, 0.060, 0.050, 0.055, 2.0),   # cou (coupé)
]
N = 72  # points par coupe


def ring(z, a, f, b, n):
    pts = []
    for k in range(N):
        t = 2 * math.pi * k / N
        c, s = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** (2 / n), c)
        y = (b if s > 0 else f) * math.copysign(abs(s) ** (2 / n), s)   # avant = -Y
        # pectoraux : deux bosses douces sur l'avant de la poitrine
        if s < 0:
            for px in (-0.07, 0.07):
                y -= 0.014 * math.exp(-((x - px) / 0.05) ** 2 - ((z - 1.345) / 0.04) ** 2)
        # omoplates : léger relief dans le dos
        if s > 0:
            for px in (-0.08, 0.08):
                y += 0.008 * math.exp(-((x - px) / 0.05) ** 2 - ((z - 1.38) / 0.06) ** 2)
        pts.append((x, y, z))
    return pts


def trunk():
    import bmesh
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in ring(*sec)] for sec in SECTIONS]
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(N):
            bm.faces.new((r0[k], r0[(k + 1) % N], r1[(k + 1) % N], r1[k]))
    bm.faces.new(list(reversed(rings[0])))   # bas fermé
    bm.faces.new(rings[-1])                  # haut du cou fermé
    me = bpy.data.meshes.new("tronc")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("tronc", me)
    bpy.context.scene.collection.objects.link(ob)
    # coupes adoucies verticalement
    sub = ob.modifiers.new("lisse", "SUBSURF")
    sub.levels = 2
    return ob


def limb(p0, p1, r0, r1):
    """Tronc de cône entre deux points (bras), extrémités arrondies."""
    p0, p1 = mathutils.Vector(p0), mathutils.Vector(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=r0, radius2=r1, depth=d.length,
                                    location=(p0 + p1) / 2,
                                    rotation=d.to_track_quat("Z", "Y").to_euler())
    a = bpy.context.active_object
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=r1, location=p1)
    return [a, bpy.context.active_object]


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = [trunk()]
    ang = math.radians(40)                   # A-pose : bras à 40° de la verticale
    for s in (-1, 1):
        sh = (s * 0.185, 0.005, 1.405)
        el = (s * (0.185 + 0.30 * math.sin(ang)), 0.005, 1.405 - 0.30 * math.cos(ang))
        parts += limb(sh, el, 0.056, 0.046)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=20, radius=0.068,
                                             location=(s * 0.185, 0.005, 1.410))   # deltoïde
        parts.append(bpy.context.active_object)

    # tout fusionner : modificateurs appliqués, objets joints, remaillage voxel
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "mannequin"
    m = body.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = 0.005
    s = body.modifiers.new("lisse", "SMOOTH")
    s.factor = 0.9
    s.iterations = 20
    d = body.modifiers.new("allege", "DECIMATE")
    d.ratio = 0.2
    for mod in list(body.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()

    # collision pour la simulation de tissu
    body.modifiers.new("collision", "COLLISION")
    cs = body.collision
    cs.thickness_outer = 0.004
    cs.thickness_inner = 0.004
    cs.cloth_friction = 5.0
    cs.damping = 0.1

    mat = bpy.data.materials.new("argile")
    mat.diffuse_color = (0.62, 0.6, 0.58, 1)
    body.data.materials.append(mat)
    return body


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "etape1.blend"
    b = build()
    dims = b.dimensions
    print(f"[mannequin] {len(b.data.polygons)} faces, {dims.x:.3f} × {dims.y:.3f} × {dims.z:.3f} m, collision : "
          f"{any(m.type == 'COLLISION' for m in b.modifiers)}")
    bpy.ops.wm.save_as_mainfile(filepath=out)
