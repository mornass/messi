"""
Étape 4 — Finitions (la forme simulée n'est pas modifiée).

1. Sauvegarde : copie du .blend simulé et de son cache → jersey_sim_backup.blend ;
   puis Cloth appliqué à la frame 150 (UV intactes) ; les points de couture
   appariés sont soudés (fusion au milieu de chaque paire).
2. Solidify : 1,5 mm vers l'intérieur, rim, matériau intérieur plus sombre.
3. Col : objet « Col », boucle fermée continue sur le bord de l'encolure
   (cassures des coutures d'épaule adoucies), 1 cm devant → 1,5 cm dos,
   inclinée à 60° vers le cou, profil de 3 mm au haut arrondi, base posée sur
   le tissu avec une petite couture en creux, UV propres.
4. Ourlets : repli de 1,5 cm vers l'intérieur au bas des manches et du maillot,
   posé 2,5 mm sous la vraie surface (plus de faces qui traversent).
5. Mannequin caché au rendu et à la caméra (gardé dans la scène).
6. Corrective Smooth 0.3 (lissage seul) limité aux zones sans grands plis
   (groupe « lisse » : écart faible entre la surface et sa version très lissée).

Usage : python tools/maillot-tissu/04_finitions.py etape3.blend etape4.blend
"""
import math
import os
import shutil
import sys

import bpy  # en premier : rend bmesh / mathutils importables
import bmesh
import mathutils
import numpy as np

FRAME = 150


def backup(src):
    d = os.path.dirname(src)
    name = os.path.splitext(os.path.basename(src))[0]
    dst = os.path.join(d, "jersey_sim_backup.blend")
    shutil.copy2(src, dst)
    cache = os.path.join(d, f"blendcache_{name}")
    cache_dst = os.path.join(d, "blendcache_jersey_sim_backup")
    if os.path.isdir(cache):
        shutil.rmtree(cache_dst, ignore_errors=True)
        shutil.copytree(cache, cache_dst)
    print(f"[etape4] sauvegarde : {dst} (+ cache {len(os.listdir(cache_dst))} frames)")


def boundary_loops(bm):
    border = {e for e in bm.edges if e.is_boundary}
    loops = []
    while border:
        e0 = border.pop()
        comp, stack = {e0}, [e0]
        while stack:
            e = stack.pop()
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2 in border:
                        border.discard(e2)
                        comp.add(e2)
                        stack.append(e2)
        # ordre des sommets le long de la boucle
        start = next(iter(comp)).verts[0]
        order, prev, cur = [start], None, start
        while True:
            nxt = [e.other_vert(cur) for e in cur.link_edges if e in comp and e.other_vert(cur) is not prev]
            if not nxt or nxt[0] is start:
                break
            prev, cur = cur, nxt[0]
            order.append(cur)
        loops.append(order)
    return loops


def main(src, dst):
    backup(src)
    bpy.ops.wm.open_mainfile(filepath=src)
    sc = bpy.context.scene
    for f in range(1, FRAME + 1):                        # lecture du cache cuit
        sc.frame_set(f)
    ob = bpy.data.objects["Maillot"]
    man = bpy.data.objects["Mannequin"]
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    uv_before = len(ob.data.uv_layers)
    bpy.ops.object.modifier_apply(modifier="Cloth")      # 1. simulation appliquée à la frame 150
    print(f"[etape4] Cloth appliqué à la frame {sc.frame_current} ; cartes UV : {uv_before} → {len(ob.data.uv_layers)}")

    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # coutures : chaque groupe de points reliés par des arêtes libres est fusionné en son centre
    loose = [e for e in bm.edges if not e.link_faces]
    gaps = [e.calc_length() for e in loose]
    bmesh.ops.collapse(bm, edges=loose, uvs=False)
    print(f"[etape4] coutures soudées : {len(loose)} arêtes (écart max {max(gaps) * 1000:.1f} mm, "
          f"moyen {sum(gaps) / len(gaps) * 1000:.1f} mm)")

    # zone des ourlets lissée (groupe « ourlets » + une rangée) : la fin de manche, très
    # froissée, faisait traverser la face intérieure du Solidify (éclats sombres)
    dl = bm.verts.layers.deform.active
    gi = ob.vertex_groups["ourlets"].index
    hem_zone = {v for v in bm.verts if dl and gi in v[dl]}
    hem_zone |= {e.other_vert(v) for v in list(hem_zone) for e in v.link_edges}
    for _ in range(10):
        bmesh.ops.smooth_vert(bm, verts=list(hem_zone), factor=0.5,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)
    print(f"[etape4] ourlets lissés : {len(hem_zone)} sommets, 10 passes")

    # normales vers l'extérieur (le centre du torse est à l'intérieur)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ctr = sum((v.co for v in bm.verts), mathutils.Vector()) / len(bm.verts)
    out = sum((f.normal.dot(f.calc_center_median() - mathutils.Vector((0, 0, f.calc_center_median().z)) -
                            mathutils.Vector((ctr.x, ctr.y, 0))) for f in bm.faces))
    if out < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.normal_update()

    loops = boundary_loops(bm)
    loops.sort(key=lambda L: sum(v.co.z for v in L) / len(L), reverse=True)
    neck = loops[0]
    hems = [L for L in loops[1:] if len(L) > 20]
    print(f"[etape4] bords libres : {len(loops)} boucles (encolure {len(neck)} pts, ourlets "
          f"{[len(L) for L in hems]} pts)")
    # encolure : les deux cassures (~55°) aux coutures d'épaule sont adoucies
    # (bord de l'encolure seulement, 3 passes) ; le col suivra ce bord exactement
    n_ = len(neck)
    for _ in range(3):
        new_co = [(neck[k - 1].co + neck[(k + 1) % n_].co) * 0.25 + neck[k].co * 0.5 for k in range(n_)]
        for v, c_ in zip(neck, new_co):
            v.co = c_
    bm.normal_update()
    kinks = []
    for k in range(n_):
        a_, b_, c_ = neck[k - 1].co, neck[k].co, neck[(k + 1) % n_].co
        kinks.append(math.degrees((b_ - a_).angle(c_ - b_, 0)))
    print(f"[etape4] encolure adoucie : angle max entre segments {max(kinks):.0f}°")
    neck_co = [v.co.copy() for v in neck]
    neck_n = [v.normal.copy() for v in neck]

    # 4. ourlets : repli de 1,5 cm vers l'intérieur, posé sur la vraie surface intérieure
    #    (point le plus proche du maillot, 2,5 mm sous la surface : pas de traversée)
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromBMesh(bm)
    uvl = bm.loops.layers.uv.active
    FOLD, INSET, ROWS = 0.015, 0.0025, 3
    n_fold = 0
    for L in hems:
        ring = []
        for v in L:
            inner = [e.other_vert(v) for e in v.link_edges if not e.is_boundary]
            up = (sum((x.co - v.co for x in inner), mathutils.Vector()) / max(len(inner), 1)).normalized()
            uv = next((lp[uvl].uv.copy() for lp in v.link_loops), mathutils.Vector((0, 0)))
            ring.append((v, up, uv))
        rows = [[r[0] for r in ring]]
        for k in range(1, ROWS + 1):
            t = k / ROWS
            row = []
            for v, up, _ in ring:
                loc, nrm, _, _ = tree.find_nearest(v.co + up * FOLD * t)
                if nrm.dot(v.normal) < 0:
                    nrm = -nrm
                row.append(bm.verts.new(loc - nrm * INSET * min(1, t * 2)))
            rows.append(row)
        for k in range(ROWS):
            a, b = rows[k], rows[k + 1]
            for i in range(len(a)):
                j = (i + 1) % len(a)
                try:
                    f = bm.faces.new((a[j], a[i], b[i], b[j]))
                except ValueError:
                    continue
                for lp in f.loops:
                    idx = (a + b).index(lp.vert) % len(a)
                    lp[uvl].uv = ring[idx][2]
                n_fold += 1
    print(f"[etape4] ourlets repliés : {len(hems)} bords, {n_fold} faces de repli (1,5 cm, posées 2,5 mm sous la surface)")
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()

    # 2. matériaux : extérieur + intérieur plus sombre ; Solidify 1,5 mm vers l'intérieur, rim
    outer = me.materials[0] if me.materials else bpy.data.materials.new("tissu")
    inner = outer.copy()
    inner.name = "tissu_interieur"
    bsdf = inner.node_tree.nodes.get("Principled BSDF") if inner.use_nodes else None
    if bsdf:
        c = bsdf.inputs["Base Color"].default_value
        bsdf.inputs["Base Color"].default_value = (c[0] * 0.72, c[1] * 0.72, c[2] * 0.72, 1)
    inner.diffuse_color = tuple(x * 0.72 for x in outer.diffuse_color[:3]) + (1,)
    me.materials.append(inner)

    # 6. Corrective Smooth (lissage seul, 0.3) hors grands plis
    co = np.array([v.co for v in me.vertices])
    ed = np.array([e.vertices for e in me.edges])
    deg = np.bincount(ed.ravel(), minlength=len(co)).astype(float)
    deg[deg == 0] = 1
    sm = co.copy()
    for _ in range(40):                                  # version très lissée (grands volumes)
        acc = np.zeros_like(sm)
        np.add.at(acc, ed[:, 0], sm[ed[:, 1]])
        np.add.at(acc, ed[:, 1], sm[ed[:, 0]])
        sm = 0.5 * sm + 0.5 * acc / deg[:, None]
    dev = np.linalg.norm(co - sm, axis=1)                # grands plis = gros écart
    lo, hi = np.percentile(dev, 60), np.percentile(dev, 85)
    w = np.clip(1 - (dev - lo) / (hi - lo), 0, 1)        # 60 % les plus plats : 1 ; 15 % les plus plissés : 0
    print(f"[etape4] écart aux grands volumes : 60e centile {lo * 1000:.1f} mm, 85e {hi * 1000:.1f} mm")
    vg = ob.vertex_groups.new(name="lisse")
    for i, x in enumerate(w):
        if x > 0:
            vg.add([i], float(x), "REPLACE")
    cs = ob.modifiers.new("Corrective Smooth", "CORRECTIVE_SMOOTH")
    cs.factor = 0.3
    cs.iterations = 5
    cs.use_only_smooth = True
    cs.vertex_group = "lisse"
    so = ob.modifiers.new("Solidify", "SOLIDIFY")
    so.thickness = 0.0015
    so.offset = -1.0                                     # vers l'intérieur
    so.use_rim = True
    so.use_even_offset = True                            # épaisseur régulière
    so.use_quality_normals = True                        # normales de qualité (moins de traversées)
    so.material_offset = 1                               # face intérieure → matériau plus sombre
    so.material_offset_rim = 1
    print(f"[etape4] Corrective Smooth 0.3 sur {int((w > 0.5).sum())} / {len(w)} sommets (grands plis exclus) ; "
          f"Solidify {so.thickness * 1000:.1f} mm vers l'intérieur, rim, intérieur plus sombre")

    # 3. col : boucle fermée continue sur le bord de l'encolure, profil arrondi
    #    hauteur 1 cm devant → 1,5 cm dos, inclinée à 60° vers le cou, 3 mm d'épaisseur,
    #    haut arrondi (rayon 1,5 mm), petite couture en creux à 1,5 mm de la base
    P = [mathutils.Vector(p) for p in neck_co]
    n = len(P)
    c = sum(P, mathutils.Vector()) / n
    up = mathutils.Vector((0, 0, 1))
    T_, R_, GROOVE = 0.003, 0.0015, 0.0005
    seg = [(P[(i + 1) % n] - P[i]).length for i in range(n)]
    perim = sum(seg)
    s_acc = [0.0]
    for x in seg[:-1]:
        s_acc.append(s_acc[-1] + x)
    # profil (s le long de la bande, k épaisseur ; k = 0 face extérieure, -T_ face intérieure)
    def profile(h):
        pts = [(0.0, 0.0), (0.0015, -GROOVE), (0.003, 0.0)]
        s_top = h - R_
        for f in np.linspace(0, 1, 4)[1:]:
            pts.append((0.003 + (s_top - 0.003) * f, 0.0))
        for a in np.linspace(0, math.pi, 7)[1:-1]:          # haut arrondi (bevel)
            pts.append((s_top + R_ * math.sin(a), -R_ + R_ * math.cos(a)))
        pts.append((s_top, -T_))
        for f in np.linspace(1, 0, 4)[1:]:
            pts.append((s_top * f, -T_))
        return pts
    cbm = bmesh.new()
    cuv = cbm.loops.layers.uv.new("UVMap")
    rings, heights = [], []
    for i, p in enumerate(P):
        inward = mathutils.Vector((c.x - p.x, c.y - p.y, 0)).normalized()
        d = (inward * math.cos(math.radians(60)) + up * math.sin(math.radians(60))).normalized()
        tang = (P[(i + 1) % n] - P[i - 1]).normalized()
        nout = tang.cross(d).normalized()
        if nout.dot(-inward) < 0:
            nout = -nout
        back = max(0.0, min(1.0, 0.5 + (p.y - c.y) / (2 * max(abs(q.y - c.y) for q in P))))
        h = 0.010 + 0.005 * back                              # 1 cm devant → 1,5 cm dos
        heights.append(h)
        rings.append([cbm.verts.new(p + d * sv + nout * kv) for sv, kv in profile(h)])
    m = len(rings[0])
    for i in range(n):
        j = (i + 1) % n                                       # boucle fermée : n faces par rang
        for r in range(m - 1):
            f = cbm.faces.new((rings[i][r], rings[j][r], rings[j][r + 1], rings[i][r + 1]))
            for lp in f.loops:
                ii = i if lp.vert in (rings[i][r], rings[i][r + 1]) else j
                rr = r if lp.vert in (rings[i][r], rings[j][r]) else r + 1
                u = s_acc[ii] / perim if not (ii == 0 and i == n - 1) else 1.0
                lp[cuv].uv = (u, rr / (m - 1))
    cme = bpy.data.meshes.new("Col")
    cbm.to_mesh(cme)
    cbm.free()
    for p in cme.polygons:
        p.use_smooth = True
    col = bpy.data.objects.new("Col", cme)
    sc.collection.objects.link(col)
    cme.materials.append(outer)
    cbm2 = bmesh.new()
    cbm2.from_mesh(cme)
    breaks = sum(1 for e in cbm2.edges if e.is_boundary)
    cbm2.free()
    print(f"[etape4] col : boucle fermée de {n} pts (bords libres : {breaks} = base extérieure + base intérieure), "
          f"hauteur {min(heights) * 100:.1f} cm devant → {max(heights) * 100:.1f} cm dos, 60°, 3 mm, haut arrondi, "
          f"couture en creux ; centre {tuple(round(float(x), 3) for x in c)}")

    # 5. mannequin caché au rendu et à la caméra, gardé dans la scène
    man.hide_render = True
    man.visible_camera = False
    print(f"[etape4] mannequin : dans la scène={man.name in sc.objects}, rendu caché={man.hide_render}, "
          f"caméra={man.visible_camera}")
    bpy.ops.wm.save_as_mainfile(filepath=dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
