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

Usage : python tools/maillot-tissu/03_simulation.py etape2.blend etape3.blend
"""
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


def main(src, dst):
    bpy.ops.wm.open_mainfile(filepath=src)
    ob = bpy.data.objects["Maillot"]
    if not check_seams(ob):
        sys.exit("coutures incomplètes")
    vis = bpy.data.objects.get("coutures_visu")            # aide visuelle de l'étape 2 : inutile ici
    if vis:
        bpy.data.objects.remove(vis)

    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 150

    mod = ob.modifiers.new("Cloth", "CLOTH")
    cs = mod.settings
    cs.mass = 0.15
    cs.tension_stiffness = 15
    cs.compression_stiffness = 15
    cs.shear_stiffness = 5
    cs.bending_stiffness = 0.3
    cs.use_sewing_springs = True
    cs.sewing_force_max = 0.0
    cs.shrink_min = 0.02
    cs.quality = 10
    cc = mod.collision_settings
    cc.collision_quality = 5
    cc.distance_min = 0.003
    cc.use_self_collision = True
    cc.self_distance_min = 0.002

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
    main(sys.argv[1], sys.argv[2])
