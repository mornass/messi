"""
Captures de contrôle d'un .blend : face, profil, 3/4 (rendu Cycles rapide,
matériau argile, fond gris), assemblées en une planche PNG.

Usage : python tools/maillot-tissu/capture.py scene.blend planche.png [--dos] [--plat]
  --dos  : ajoute une vue de dos
  --plat : éclairage plat (sans ombres portées, lumière d'ambiance seule) pour
           vérifier la géométrie (trous, encoches), sur fond sombre
  --zoom x,y,z,taille : gros plan centré sur ce point
  --frame N : rendu à la frame N (simulation cuite)
"""
import math
import sys

import bpy
import mathutils
import numpy as np
from PIL import Image


def capture(blend, out, dos=False, plat=False, zoom=None, frame=None):
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    if frame is not None:                     # simulation : on lit le cache à cette frame
        for f in range(sc.frame_start, frame + 1):
            sc.frame_set(f)
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = int(__import__("os").environ.get("SAMPLES", 24))
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
    dg = bpy.context.evaluated_depsgraph_get()
    for o in sc.objects:
        if o.type == "MESH" and not o.hide_render:
            ev = o.evaluated_get(dg)
            pts += [ev.matrix_world @ mathutils.Vector(c) for c in ev.bound_box]
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    ctr = (lo + hi) / 2
    size = max(hi - lo)
    if zoom:                                   # gros plan : centre x,y,z et taille du cadre
        ctr = mathutils.Vector(zoom[:3])
        size = zoom[3]

    sun = bpy.data.lights.new("soleil", "SUN")
    sun.energy = 3.0
    sun.angle = math.radians(30)      # soleil large : ombres douces (pas de fausses « encoches »)
    if plat:
        sun.energy = 0.0
        sun.use_shadow = False
        sc.render.film_transparent = True     # posé ensuite sur fond sombre : silhouette bien lisible
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
    ims = []
    for _, p in shots:
        im = Image.open(p).convert("RGBA")
        bg = Image.new("RGBA", im.size, (11, 31, 58, 255) if plat else (0, 0, 0, 0))
        ims.append(Image.alpha_composite(bg, im).convert("RGB") if plat else im.convert("RGB"))
    w, h = ims[0].size
    sheet = Image.new("RGB", (w * len(ims), h), "white")
    for i, im in enumerate(ims):
        sheet.paste(im, (i * w, 0))
    sheet.save(out)
    print("[capture]", out)


if __name__ == "__main__":
    zoom = None
    if "--zoom" in sys.argv:
        zoom = [float(x) for x in sys.argv[sys.argv.index("--zoom") + 1].split(",")]
    frame = int(sys.argv[sys.argv.index("--frame") + 1]) if "--frame" in sys.argv else None
    capture(sys.argv[1], sys.argv[2], dos="--dos" in sys.argv, plat="--plat" in sys.argv, zoom=zoom, frame=frame)
