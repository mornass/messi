"""
Étape 5 (préparation) — UV du col placées dans la zone libre de la carte UV
du maillot, pour une seule texture commune. Le maillage n'est pas modifié.

Même densité que les panneaux (1 UV = 1,25 m de tissu) : u = tour du cou
(longueur réelle de la base), v = profil de la bande (longueur réelle,
moyenne devant / dos). Placée dans la bande libre entre le bas du devant /
dos et le haut des manches, centrée en hauteur, sans chevauchement.

Usage : python tools/maillot-tissu/05_uv_col.py etape4.blend etape5.blend
"""
import sys

import bpy

S = 1 / 1.25          # UV par mètre (même échelle que le patron)
MARGIN = 0.02


def main(src, dst):
    bpy.ops.wm.open_mainfile(filepath=src)
    ob, col = bpy.data.objects["Maillot"], bpy.data.objects["Col"]
    # zone libre : entre le haut des manches et le bas du devant / dos
    me = ob.data
    uv = me.uv_layers.active.data
    gi = {g.name: g.index for g in ob.vertex_groups}
    sleeve_top, body_bottom, x_max = 0.0, 1.0, 0.0
    for p in me.polygons:
        gs = {g.group for g in me.vertices[p.vertices[0]].groups}
        vs = [uv[li].uv[1] for li in p.loop_indices]
        x_max = max(x_max, max(uv[li].uv[0] for li in p.loop_indices))
        if gi["manche_D"] in gs or gi["manche_G"] in gs:
            sleeve_top = max(sleeve_top, max(vs))
        elif gi["devant"] in gs or gi["dos"] in gs:
            body_bottom = min(body_bottom, min(vs))

    # dimensions réelles du col (anneaux de m sommets par point d'encolure, dans l'ordre)
    cm = col.data
    cuv = cm.uv_layers.active.data
    m = len({round(cuv[li].uv[1], 6) for p in cm.polygons for li in p.loop_indices})
    n = len(cm.vertices) // m
    base = [cm.vertices[i * m].co for i in range(n)]
    perim = sum((base[(i + 1) % n] - base[i]).length for i in range(n))
    prof = sum(sum((cm.vertices[i * m + r + 1].co - cm.vertices[i * m + r].co).length for r in range(m - 1))
               for i in range(n)) / n
    w, h = perim * S, prof * S
    free_h = body_bottom - sleeve_top
    if w > 1 - 2 * MARGIN or h > free_h - 2 * MARGIN:
        sys.exit(f"zone libre trop petite ({1 - 2 * MARGIN:.3f} × {free_h:.3f}) pour le col ({w:.3f} × {h:.3f})")
    x0 = MARGIN
    y0 = sleeve_top + (free_h - h) / 2
    for li in range(len(cuv)):
        u, v = cuv[li].uv
        cuv[li].uv = (x0 + u * w, y0 + v * h)
    print(f"[etape5] zone libre UV : v {sleeve_top:.3f} → {body_bottom:.3f} ; col {perim * 100:.1f} × "
          f"{prof * 100:.1f} cm → UV x {x0:.3f}–{x0 + w:.3f}, y {y0:.3f}–{y0 + h:.3f} (même densité, sans chevauchement)")
    bpy.ops.wm.save_as_mainfile(filepath=dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
