"""
Étape 3 — Simulation de tissu (rien n'est appliqué).

Contrôle préalable : nombre d'arêtes par couture et emmanchures bien reliées
aux manches. Puis Cloth sur l'objet « Maillot » (panneaux déjà joints) :
  masse 0.15 kg ; tension / compression 15 ; shear 5 ; bending 0.3
  Shape : Sewing, force de couture max 0 (illimitée), shrinking 0.02
  Qualité : steps 10, collision quality 5, distance 0.003,
            self-collision (distance 0.002)
  Gravité du tissu : 0 de la frame 1 à 40 (couture), 1 à partir de la 50
  150 frames, cache cuit sur disque (bake).

Réglages v2 (--v2), après la 1re simulation (surface en marches d'escalier) :
  - panneaux de l'étape 2 (frame 1, avant simulation) triangulés (Beauty),
    sommets décalés au hasard de 2 mm max DANS le plan du tissu (pas en
    profondeur) pour casser la grille, Shade Smooth ; coutures et UV gardées
  - bending 1.0, shrinking 0, tension / compression 15, steps 15,
    collision distance 0.005, self-collision 0.003 ; le reste inchangé

Réglages v3 (--v3) : comme v2, mais seuls les sommets intérieurs sont décalés
(ourlets, encolure et bords de couture restent droits), force de couture max
10 (couture progressive), manches plus raides (bending 3 via le groupe
« manches », le corps reste à 1.0).

Usage : python tools/maillot-tissu/03_simulation.py etape2.blend etape3.blend [--v2 | --v3]
"""
import random
import os
import sys
import time

import bpy  # en premier : rend bmesh importable
import bmesh


def check_seams(ob):
    names = list(ob["coutures"])
    me = ob.data
    cid = me.attributes["couture_id"].data
    vg = {g.index: g.name for g in ob.vertex_groups}
    panel = [vg[v.groups[0].group] if v.groups else "?" for v in me.vertices]
    counts, links = {}, {}
    for e in me.edges:
        k = cid[e.index].value
        if not k:
            continue
        name = names[k - 1]
        counts[name] = counts.get(name, 0) + 1
        a, b = e.vertices
        links.setdefault(name, set()).add(tuple(sorted((panel[a], panel[b]))))
    for name in names:
        print(f"[etape3] couture {name:24s} : {counts.get(name, 0):3d} arêtes  "
              f"({', '.join(' ↔ '.join(p) for p in sorted(links.get(name, [])))})")
    ok = all(
        counts.get(f"emmanchure {s} {c}", 0) > 0
        and links.get(f"emmanchure {s} {c}") == {tuple(sorted((c if c == "dos" else "devant", f"manche_{s}")))}
        for s in ("D", "G") for c in ("devant", "dos")
    )
    print(f"[etape3] emmanchures cousues aux manches : {'OUI' if ok else 'NON'} "
          f"(total {sum(counts.values())} arêtes de couture)")
    return ok


V1 = dict(bending=0.3, shrink=0.02, tension=15, steps=10, dist=0.003, self_dist=0.002)
V2 = dict(bending=1.0, shrink=0.0, tension=15, steps=15, dist=0.005, self_dist=0.003)
# v3 : bords droits (seul l'intérieur est décalé), couture progressive (force max 10),
#      manches plus raides (bending 3 via groupe de sommets) ; le reste = v2
V3 = dict(V2, sewing_max=10.0, sleeve_bending=3.0, interior_only=True)


def break_grid(ob, amount=0.002, seed=7, interior_only=False):
    """Triangule (Beauty), décale chaque sommet du tissu au hasard dans son plan
    tangent (≤ amount), lisse l'ombrage. Les arêtes de couture (libres) et les UV
    sont conservées (Triangulate garde les UV ; 2 mm de décalage n'y changent rien)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    faces = bm.faces[:]
    bmesh.ops.triangulate(bm, faces=faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.normal_update()
    rnd = random.Random(seed)
    import mathutils
    moved = 0
    for v in bm.verts:
        if not v.link_faces:
            continue
        # bord de panneau (ourlet, encolure, couture) : arête n'ayant qu'une face → laissé droit
        if interior_only and any(len(e.link_faces) == 1 for e in v.link_edges):
            continue
        n = v.normal
        while True:                                  # direction au hasard dans le plan tangent
            r = mathutils.Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
            r -= n * r.dot(n)
            if r.length > 1e-6:
                break
        v.co += r.normalized() * amount * rnd.random() ** 0.5
        moved += 1
    for f in bm.faces:
        f.smooth = True                              # Shade Smooth
    bm.to_mesh(me)
    bm.free()
    tris = sum(1 for p in me.polygons if len(p.vertices) == 3)
    print(f"[etape3] grille cassée : {tris} triangles (Beauty), {moved} sommets décalés ≤ {amount * 1000:.0f} mm "
          f"dans le plan{' (intérieur seulement, bords droits)' if interior_only else ''}, Shade Smooth ; "
          f"UV : {len(me.uv_layers)} carte(s)")


def main(src, dst, v2=False, v3=False):
    bpy.ops.wm.open_mainfile(filepath=src)
    ob = bpy.data.objects["Maillot"]
    if not check_seams(ob):
        sys.exit("coutures incomplètes")
    cfg = V3 if v3 else V2 if v2 else V1
    if v2 or v3:
        break_grid(ob, interior_only=cfg.get("interior_only", False))
        check_seams(ob)                              # les coutures doivent être intactes
    vis = bpy.data.objects.get("coutures_visu")            # aide visuelle de l'étape 2 : inutile ici
    if vis:
        bpy.data.objects.remove(vis)

    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 150

    mod = ob.modifiers.new("Cloth", "CLOTH")
    cs = mod.settings
    cs.mass = 0.15
    cs.tension_stiffness = cfg["tension"]
    cs.compression_stiffness = cfg["tension"]
    cs.shear_stiffness = 5
    cs.bending_stiffness = cfg["bending"]
    cs.use_sewing_springs = True
    cs.sewing_force_max = cfg.get("sewing_max", 0.0)
    if cfg.get("sleeve_bending"):
        # manches plus raides : groupe « manches » (poids 1) → bending_stiffness_max
        vg = ob.vertex_groups.new(name="manches")
        for tag in ("manche_D", "manche_G"):
            g = ob.vertex_groups[tag]
            idx = [v.index for v in ob.data.vertices if any(x.group == g.index for x in v.groups)]
            vg.add(idx, 1.0, "REPLACE")
        cs.vertex_group_bending = "manches"
        cs.bending_stiffness_max = cfg["sleeve_bending"]
    cs.shrink_min = cfg["shrink"]
    cs.quality = cfg["steps"]
    cc = mod.collision_settings
    cc.collision_quality = 5
    cc.distance_min = cfg["dist"]
    cc.use_self_collision = True
    cc.self_distance_min = cfg["self_dist"]
    print(f"[etape3] réglages : masse {cs.mass}, tension/compression {cs.tension_stiffness}, shear "
          f"{cs.shear_stiffness}, bending {cs.bending_stiffness} (manches {cs.bending_stiffness_max if cs.vertex_group_bending else '='}), "
          f"sewing force max {cs.sewing_force_max}, "
          f"shrinking {cs.shrink_min}, steps {cs.quality}, collision quality {cc.collision_quality}, "
          f"distance {cc.distance_min}, self-collision {cc.use_self_collision} ({cc.self_distance_min})")

    # gravité du tissu : 0 jusqu'à la frame 40, remonte à 1 à la frame 50
    ew = cs.effector_weights
    for f, g in ((1, 0.0), (40, 0.0), (50, 1.0)):
        ew.gravity = g
        ew.keyframe_insert("gravity", frame=f)
    act = sc.animation_data.action if sc.animation_data else None
    for fc in (act.fcurves if act else []):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

    pc = mod.point_cache
    pc.frame_start, pc.frame_end = 1, 150
    bpy.ops.wm.save_as_mainfile(filepath=dst)          # le cache disque a besoin d'un .blend enregistré
    pc.use_disk_cache = True
    t0 = time.time()
    with bpy.context.temp_override(scene=sc, active_object=ob, object=ob, point_cache=pc):
        bpy.ops.ptcache.bake(bake=True)
    print(f"[etape3] bake : 150 frames en {time.time() - t0:.0f} s, cache cuit : {pc.is_baked}")
    bpy.ops.wm.save_as_mainfile(filepath=dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], v2="--v2" in sys.argv, v3="--v3" in sys.argv)
