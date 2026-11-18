"""
Étape 1 — Mannequin (add-on MPFB 2) : homme athlétique ~1,70 m en pose A
(bras ~45° sous l'horizontale), réduit au torse : cou jusqu'à mi-hauteur,
bras jusqu'à mi-biceps, coupé 5 cm sous l'aine (hanches, haut des cuisses),
trous bouchés (Fill), maillage fermé vérifié, en collision.

1. MPFB crée l'humain (homme, musclé, mince, proportions idéales) ;
2. rig « default » : les bras sont tournés à l'épaule jusqu'à 45° sous
   l'horizontale (angle mesuré sur le maillage : centre du haut du bras →
   centre de l'avant-bras), puis la pose est appliquée ;
3. suppression : géométrie d'aide MPFB, tête (au-dessus de neck01),
   avant-bras et mains, tout ce qui est sous la taille ;
4. modificateurs appliqués, modificateur Collision (thickness outer 0,005),
   objet nommé « Mannequin ».

MPFB doit être installé comme extension Blender (bl_ext.user_default.mpfb) :
  BLENDER_USER_RESOURCES=<dossier> avec <dossier>/extensions/user_default/mpfb
  (copie de src/mpfb du dépôt github.com/makehumancommunity/mpfb2).

Usage : python tools/maillot-tissu/01_mannequin.py sortie.blend
"""
import math
import sys

import bpy  # en premier : rend addon_utils / mathutils importables
import addon_utils
import mathutils
import numpy as np

ARM_DEG = 45.0                 # angle des bras sous l'horizontale
HEAD_BONES = ("neck02", "neck03", "head", "jaw", "eye", "oculi", "oris", "levator", "orbicularis",
              "temporalis", "tongue", "special", "risorius", "mandible", "cheek")
FOREARM_BONES = ("lowerarm", "wrist", "finger", "metacarpal", "hand")
LOWER_BONES = ("pelvis", "upperleg", "lowerleg", "foot", "toe", "root")
# groupes MPFB qui ne sont pas des os (à ignorer pour le « groupe dominant »)
NON_BONE = {"body", "Left", "Mid", "Right", "HelperGeometry", "JointCubes", "nippleTip", "nipple", "lips",
            "fingernails", "toenails", "ears", "scalp", "genitals"}


def group_centroid(ob, names, co):
    """Centre des sommets dont le groupe dominant commence par un des noms."""
    idx = {g.index for g in ob.vertex_groups if g.name.startswith(names)}
    bones = {g.index for g in ob.vertex_groups if g.name not in NON_BONE}
    pts = []
    for v in ob.data.vertices:
        gs = [g for g in v.groups if g.group in bones]
        if not gs:
            continue
        g = max(gs, key=lambda x: x.weight)
        if g.group in idx and g.weight > 0.5:
            pts.append(co[v.index])
    return np.mean(pts, axis=0)


def evaluated_coords(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.array([ob.matrix_world @ v.co for v in me.vertices])
    ev.to_mesh_clear()
    return co


def arm_angle(ob, side):
    co = evaluated_coords(ob)
    a = group_centroid(ob, (f"upperarm01.{side}", f"upperarm02.{side}"), co)
    b = group_centroid(ob, (f"lowerarm01.{side}", f"lowerarm02.{side}"), co)
    d = b - a
    return math.degrees(math.atan2(-d[2], abs(d[0])))   # sous l'horizontale, en degrés


def rotate_bone_world(rig, bone, axis, angle):
    pb = rig.pose.bones[bone]
    mw = rig.matrix_world
    head = mw @ pb.head
    rot = (mathutils.Matrix.Translation(head) @ mathutils.Matrix.Rotation(angle, 4, axis)
           @ mathutils.Matrix.Translation(-head))
    pb.matrix = mw.inverted() @ rot @ mw @ pb.matrix
    bpy.context.view_layer.update()


def build(previous=None):
    import os
    # 2. ancien mannequin : ouvert puis supprimé de la scène
    if previous and os.path.exists(previous):
        bpy.ops.wm.open_mainfile(filepath=previous)
        old = [o.name for o in bpy.data.objects]
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o)
        print(f"[etape1] ancienne scène {os.path.basename(previous)} : supprimés {old}")
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    # 1. MPFB activé : version lue dans son manifeste
    mod = addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    manifest = os.path.join(os.path.dirname(mod.__file__), "blender_manifest.toml")
    version = next(l.split("=")[1].strip().strip('"') for l in open(manifest) if l.startswith("version"))
    print(f"[etape1] MPFB activé : {mod.__name__} version {version}")
    from bl_ext.user_default.mpfb.services.humanservice import HumanService

    macro = {"gender": 1.0, "age": 0.5, "muscle": 0.85, "weight": 0.45, "proportions": 0.9,
             "height": 0.45, "cupsize": 0.5, "firmness": 0.5,
             "race": {"asian": 0.33, "caucasian": 0.34, "african": 0.33}}
    body = HumanService.create_human(mask_helpers=True, detailed_helpers=False, extra_vertex_groups=True,
                                     feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
    height = body.dimensions.z
    for mod in list(body.modifiers):          # masque d'aide MPFB : l'aide est supprimée plus bas
        if mod.type == "MASK":
            body.modifiers.remove(mod)
    rig = HumanService.add_builtin_rig(body, "default")

    # pose : bras à 45° sous l'horizontale (rotation à l'épaule, autour de l'axe avant-arrière)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for side, sign in (("L", 1), ("R", -1)):
        for _ in range(4):                               # ajustement par mesure
            cur = arm_angle(body, side)
            delta = math.radians(cur - ARM_DEG)
            if abs(delta) < math.radians(0.5):
                break
            # bras gauche (x > 0) : relever = rotation négative autour de +Y
            rotate_bone_world(rig, f"upperarm01.{side}", mathutils.Vector((0, 1, 0)), -sign * delta)
    angles = {s: round(arm_angle(body, s), 1) for s in ("L", "R")}
    bpy.ops.object.mode_set(mode="OBJECT")

    # cible de forme MPFB figées (sinon le modificateur Armature ne s'applique pas)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    if body.data.shape_keys:
        bpy.ops.object.shape_key_add(from_mix=True)
        mix = body.data.shape_keys.key_blocks[-1]
        co = np.empty(len(body.data.vertices) * 3)
        mix.data.foreach_get("co", co)
        bpy.ops.object.shape_key_remove(all=True)
        body.data.vertices.foreach_set("co", co)
        body.data.update()
    # pose appliquée, masque d'aide retiré (la géométrie d'aide est supprimée plus bas)
    for mod in list(body.modifiers):
        if mod.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=mod.name)
        else:
            body.modifiers.remove(mod)
    bpy.data.objects.remove(rig)
    # une subdivision avant les coupes : bords de coupe plus nets (cou, cuisses, bras)
    sub = body.modifiers.new("subdiv", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=sub.name)

    # repères pour les coupes
    co = np.array([v.co for v in body.data.vertices])
    gi = {g.name: g.index for g in body.vertex_groups}

    def dominant(v):
        gs = [g for g in v.groups if body.vertex_groups[g.group].name not in NON_BONE]
        return body.vertex_groups[max(gs, key=lambda x: x.weight).group].name if gs else ""

    helper = {gi.get("HelperGeometry"), gi.get("JointCubes")} - {None}
    # cou à mi-hauteur : entre le bas du cou (neck01) et le haut (neck03, sous la tête)
    neck_lo = np.percentile([co[v.index][2] for v in body.data.vertices if dominant(v) == "neck01"], 10)
    neck_hi = np.percentile([co[v.index][2] for v in body.data.vertices
                             if dominant(v) in ("neck02", "neck03")], 90)
    print(f"[etape1] cou : bas z={neck_lo:.3f}, haut z={neck_hi:.3f}, coupe à mi-hauteur z={(neck_lo + neck_hi) / 2:.3f}")
    head_z = (neck_lo + neck_hi) / 2
    # aine : point le plus bas de l'entrejambe (sommets du milieu, |x| < 1 cm),
    # coupe 5 cm plus bas → hanches et haut des cuisses conservés
    is_helper = np.array([any(g.group in helper and g.weight > 0 for g in v.groups) for v in body.data.vertices])
    mid = co[(np.abs(co[:, 0]) < 0.01) & (co[:, 2] > 0.5) & ~is_helper]
    groin_z = float(mid[:, 2].min())
    waist_z = groin_z - 0.05
    print(f"[etape1] aine z={groin_z:.3f} → coupe du bas z={waist_z:.3f} (5 cm sous l'aine)")

    # 1) géométrie d'aide MPFB (vêtements d'essai, cubes d'articulation) : supprimée
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    dom = [dominant(v) for v in body.data.vertices]
    helpers = [bm.verts[v.index] for v in body.data.vertices
               if any(g.group in helper and g.weight > 0 for g in v.groups)]
    bmesh.ops.delete(bm, geom=helpers, context="VERTS")

    # 2) coupes nettes par plans (Bisect) au lieu de sommets supprimés
    def cut(geom, point, normal):
        """Coupe le long du plan et supprime le côté vers lequel pointe la normale."""
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=point, plane_no=normal,
                                     clear_outer=True, clear_inner=False)
        return res

    def all_geom():
        return bm.verts[:] + bm.edges[:] + bm.faces[:]

    cut(all_geom(), (0, 0, head_z), (0, 0, 1))          # tête : au-dessus de la base du cou
    cut(all_geom(), (0, 0, waist_z), (0, 0, -1))        # haut des cuisses (5 cm sous l'aine)
    # avant-bras : plan perpendiculaire au bras, au coude, appliqué au bras seul
    lay = bm.verts.layers.deform.verify()
    names = [g.name for g in body.vertex_groups]
    for side in ("L", "R"):
        up = group_centroid(body, (f"upperarm01.{side}",), co)
        up2 = group_centroid(body, (f"upperarm02.{side}",), co)
        lo = group_centroid(body, (f"lowerarm01.{side}",), co)
        elbow = (up + up2) / 2                       # mi-biceps (entre les deux moitiés du haut du bras)
        d = mathutils.Vector(lo - up).normalized()
        arm_v = set()
        for v in bm.verts:
            w = {names[k]: x for k, x in v[lay].items() if names[k] not in NON_BONE}
            if w and max(w, key=w.get).startswith((f"upperarm", f"lowerarm", "wrist", "finger",
                                                   "metacarpal")) and max(w, key=w.get).endswith(side):
                arm_v.add(v)
        faces = [f for f in bm.faces if all(v in arm_v for v in f.verts)]
        edges = list({e for f in faces for e in f.edges})
        cut(list(arm_v) + edges + faces, tuple(elbow), tuple(d))
        print(f"[etape1] bras {side} coupé à mi-biceps : point {tuple(round(float(x), 3) for x in elbow)}")
    # restes de la main / avant-bras détachés : supprimés par la passe « plus grande pièce »
    # petits morceaux isolés (yeux, dents…) : on ne garde que la plus grande pièce
    bm.verts.ensure_lookup_table()
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        parts.append(comp)
    parts.sort(key=len, reverse=True)
    for comp in parts[1:]:
        bmesh.ops.delete(bm, geom=comp, context="VERTS")
    # ouvertures : boucles de bord, une par trou (cou, 2 bras, 2 cuisses)
    border = {e for e in bm.edges if e.is_boundary}
    loops = []
    while border:
        e0 = border.pop()
        loop, stack = {e0}, [e0]
        while stack:
            e = stack.pop()
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2 in border:
                        border.discard(e2)
                        loop.add(e2)
                        stack.append(e2)
        loops.append(loop)
    names = []
    for loop in loops:
        zs = [v.co.z for e in loop for v in e.verts]
        xs = [v.co.x for e in loop for v in e.verts]
        z, x = sum(zs) / len(zs), sum(xs) / len(xs)
        names.append("cou" if z > 1.4 else "cuisse" if z < 1.0 else ("bras G" if x > 0 else "bras D"))
    print(f"[etape1] ouvertures avant Fill : {len(loops)} → {sorted(names)}")
    # Fill (remplissage triangulé de chaque boucle)
    for loop in loops:
        bmesh.ops.triangle_fill(bm, edges=list(loop), use_beauty=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    nm_edges = [e for e in bm.edges if not e.is_manifold]
    nm_verts = [v for v in bm.verts if not v.is_manifold]
    print(f"[etape1] après Fill : bords ouverts {sum(1 for e in bm.edges if e.is_boundary)}, "
          f"arêtes non manifold {len(nm_edges)}, sommets non manifold {len(nm_verts)} → "
          f"{'FERMÉ (manifold)' if not nm_edges and not nm_verts else 'NON FERMÉ'}")
    bm.to_mesh(body.data)
    bm.free()
    body.vertex_groups.clear()
    for mod in list(body.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()

    body.name = "Mannequin"
    body.data.name = "Mannequin"
    body.modifiers.new("Collision", "COLLISION")
    body.collision.thickness_outer = 0.005
    for m in list(body.data.materials):
        pass
    body.data.materials.clear()
    mat = bpy.data.materials.new("argile")
    mat.diffuse_color = (0.62, 0.6, 0.58, 1)
    body.data.materials.append(mat)
    for o in list(bpy.context.scene.objects):
        if o is not body:
            bpy.data.objects.remove(o)
    return body, height, angles, waist_z, head_z


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "etape1.blend"
    b, h, ang, wz, hz = build(previous=out)
    d = b.dimensions
    print(f"[mannequin] humain {h:.3f} m, bras {ang} ° sous l'horizontale, coupe du bas z={wz:.3f}, "
          f"cou z={hz:.3f} ; {b.name} : {len(b.data.polygons)} faces, {d.x:.3f} × {d.y:.3f} × {d.z:.3f} m, "
          f"modificateurs {[m.type for m in b.modifiers]}, thickness_outer={b.collision.thickness_outer}")
    print(f"[etape1] objets dans la scène : {[o.name for o in bpy.context.scene.objects]}")
    print(f"[etape1] OBJET « {b.name} » : {len(b.data.vertices)} sommets, {len(b.data.polygons)} faces")
    bpy.ops.wm.save_as_mainfile(filepath=out)
