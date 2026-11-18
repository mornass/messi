"""
Captures de contrôle d'un .blend : face, profil, 3/4 (rendu Cycles rapide,
matériau argile, fond gris), assemblées en une planche PNG.

Usage : python tools/maillot-tissu/capture.py scene.blend planche.png [--dos] [--plat]
  --dos  : ajoute une vue de dos
  --plat : éclairage plat (sans ombres portées, lumière d'ambiance seule) pour
           vérifier la géométrie (trous, encoches)
"""
import math
import sys

import bpy
import mathutils
import numpy as np
from PIL import Image


def capture(blend, out, dos=False, plat=False):
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 700
    sc.render.resolution_y = 900
    sc.render.film_transparent = False
    if not sc.world:
        sc.world = bpy.data.worlds.new("monde")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.18, 0.18, 0.2, 1)
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 2.2 if plat else 0.6
    if plat:
        sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.55, 0.57, 1)

    # cadrage sur tous les objets maillés visibles
    pts = []
    for o in sc.objects:
        if o.type == "MESH" and not o.hide_render:
            pts += [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    ctr = (lo + hi) / 2
    size = max(hi - lo)

    sun = bpy.data.lights.new("soleil", "SUN")
    sun.energy = 3.0
    sun.angle = math.radians(30)      # soleil large : ombres douces (pas de fausses « encoches »)
    if plat:
        sun.energy = 0.0
        sun.use_shadow = False
    so = bpy.data.objects.new("soleil", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(so)

    cam = bpy.data.cameras.new("cam")
    cam.lens = 70
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    dist = size * 3.2
    shots = []
    views = [("face", 0), ("profil", 90), ("3/4", 40)] + ([("dos", 180)] if dos else [])
    for name, az in views:
        a = math.radians(az)
        co.location = ctr + mathutils.Vector((math.sin(a) * dist, -math.cos(a) * dist, size * 0.15))
        direction = ctr - co.location
        co.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        sun_rot = so.rotation_euler.copy()
        so.rotation_euler = (math.radians(50), 0, a + math.radians(30))
        path = out + f".{az}.png"
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        shots.append((name, path))
    ims = [Image.open(p).convert("RGB") for _, p in shots]
    w, h = ims[0].size
    sheet = Image.new("RGB", (w * len(ims), h), "white")
    for i, im in enumerate(ims):
        sheet.paste(im, (i * w, 0))
    sheet.save(out)
    print("[capture]", out)


if __name__ == "__main__":
    capture(sys.argv[1], sys.argv[2], dos="--dos" in sys.argv, plat="--plat" in sys.argv)
