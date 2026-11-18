"""
Étape 5 — Rendu test Cycles, éclairage neutre (studio gris, lumières douces) :
face, dos, 3/4, et gros plan sur l'écusson. Planche PNG + images séparées.

Le gros plan vise le point 3D dont les UV sont le centre de l'écusson
(retrouvé sur le maillage évalué, face extérieure tournée vers l'avant).

Usage : python tools/maillot-tissu/07_rendu.py etape6.blend sortie.png [--samples N] [--vues face,dos,3-4,3-4dos,ecusson]
"""
import math
import sys

import bpy
import mathutils
from PIL import Image

S = 1 / 1.25
CREST = (0.105, -0.16)          # centre de l'écusson dans le patron (m), cf. 06_texture.py


def studio(sc, samples):
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 800, 1000
    sc.view_settings.view_transform = "Standard"      # couleurs fidèles à la texture
    sc.view_settings.look = "None"
    sc.view_settings.exposure = -0.2
    if not sc.world:
        sc.world = bpy.data.worlds.new("monde")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.42, 0.42, 0.43, 1)
    bg.inputs[1].default_value = 0.55
    lights = []
    for name, energy, size, loc in (("cle", 260, 1.6, (-1.6, -2.2, 2.3)),
                                    ("debouche", 120, 2.0, (1.9, -1.6, 1.5)),
                                    ("contre", 140, 1.5, (0.4, 2.4, 2.4))):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = energy, size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lights.append(lo)
        sc.collection.objects.link(lo)
    return lights


def aim(cam, target, lights=None):
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()


def crest_point(ob):
    """Point 3D (monde) et normale de la surface extérieure au centre de l'écusson."""
    me = ob.data
    gi = ob.vertex_groups["devant"].index
    uv = me.uv_layers.active.data
    top = max(uv[li].uv[1] for p in me.polygons if any(g.group == gi for g in me.vertices[p.vertices[0]].groups)
              for li in p.loop_indices)
    tops = [uv[li].uv[0] for p in me.polygons if any(g.group == gi for g in me.vertices[p.vertices[0]].groups)
            for li in p.loop_indices if uv[li].uv[1] > top - 1e-3]
    target = mathutils.Vector((sum(tops) / len(tops) + CREST[0] * S, top + CREST[1] * S))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    em = ev.to_mesh()
    em.calc_loop_triangles()
    euv = em.uv_layers.active.data
    best = None
    for t in em.loop_triangles:
        a, b, c = (mathutils.Vector(euv[li].uv) for li in t.loops)
        bc = mathutils.geometry.barycentric_transform(target.to_3d(), a.to_3d(), b.to_3d(), c.to_3d(),
                                                      mathutils.Vector((1, 0, 0)), mathutils.Vector((0, 1, 0)),
                                                      mathutils.Vector((0, 0, 1)))
        if min(bc) < -1e-6:
            continue
        n = ev.matrix_world.to_3x3() @ t.normal
        if n.y > 0:                                # face intérieure (Solidify) : ignorée
            continue
        p = sum((em.vertices[v].co * w for v, w in zip(t.vertices, bc)), mathutils.Vector())
        best = (ev.matrix_world @ p, n.normalized())
        break
    ev.to_mesh_clear()
    return best


VUES = {"face": 0, "dos": 180, "3-4": 40, "3-4dos": 140}


def main(blend, out, samples=96, vues=("face", "dos", "3-4", "ecusson")):
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    studio(sc, samples)
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in sc.objects:
        if o.type == "MESH" and not o.hide_render:
            ev = o.evaluated_get(dg)
            pts += [ev.matrix_world @ mathutils.Vector(c) for c in ev.bound_box]
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    ctr, size = (lo + hi) / 2, max(hi - lo)

    cd = bpy.data.cameras.new("cam")
    cd.lens = 70
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    dist = size * 3.2
    shots = []
    for name in [v for v in vues if v in VUES]:
        a = math.radians(VUES[name])
        cam.location = ctr + mathutils.Vector((math.sin(a) * dist, -math.cos(a) * dist, size * 0.15))
        aim(cam, ctr)
        sc.render.filepath = f"{out}.{name}.png"
        bpy.ops.render.render(write_still=True)
        shots.append(sc.render.filepath)

    hit = crest_point(bpy.data.objects["Maillot"]) if "ecusson" in vues else None
    if hit:
        p, n = hit
        print(f"[rendu] écusson : point {tuple(round(x, 3) for x in p)}, normale {tuple(round(x, 2) for x in n)}")
        cd.lens = 100
        frame = 0.16                                   # largeur de cadre (m)
        d = frame * cd.lens / cd.sensor_width          # distance pour ce cadrage
        dirv = (n + mathutils.Vector((-0.25, 0, 0.2))).normalized()
        cam.location = p + dirv * d
        aim(cam, p)
        sc.render.resolution_x = sc.render.resolution_y = 1000
        sc.render.filepath = f"{out}.ecusson.png"
        bpy.ops.render.render(write_still=True)
        shots.append(sc.render.filepath)
    elif "ecusson" in vues:
        print("[rendu] écusson introuvable dans les UV")

    ims = [Image.open(s).convert("RGB") for s in shots]
    h = 1000
    ims = [im.resize((round(im.width * h / im.height), h)) for im in ims]
    sheet = Image.new("RGB", (sum(im.width for im in ims), h), "white")
    x = 0
    for im in ims:
        sheet.paste(im, (x, 0))
        x += im.width
    sheet.save(out)
    print("[rendu]", out)


if __name__ == "__main__":
    n = int(sys.argv[sys.argv.index("--samples") + 1]) if "--samples" in sys.argv else 96
    v = sys.argv[sys.argv.index("--vues") + 1].split(",") if "--vues" in sys.argv else ("face", "dos", "3-4", "ecusson")
    main(sys.argv[1], sys.argv[2], n, v)
