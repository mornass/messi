"""
Retouches après le premier rendu texturé (sans relancer la simulation).

1. Artefacts : les « bouts de tissu » (milieu du bas devant, aisselles) sont
   la coque intérieure du Solidify. Avec « even offset », l'épaisseur est
   divisée par le cosinus de l'angle entre faces : aux jonctions des
   coutures (aisselles) et aux extrémités du repli d'ourlet, elle partait
   jusqu'à 10 cm au lieu de 1,5 mm. Even offset coupé (décalage ≤ 1,5 mm
   partout), et lissage local (Laplacien, sommets non bordure) autour des
   sommets fautifs, pour adoucir les plis aigus qui en étaient la cause.

2. Silhouette : la taille marquée (largeur minimale ~29,5 cm entre poitrine
   ~34 cm et bas 38 cm) est réduite de moitié. Pour chaque côté et chaque
   hauteur, l'enveloppe droite du profil (enveloppe convexe de la demi-
   largeur en fonction de z, sous les aisselles) sert de référence ; les
   sommets du corps sont écartés en x de la moitié de l'écart profil →
   enveloppe, avec un fondu vers 0 sous les aisselles. Seul x change :
   le tissu s'éloigne du corps, aucune collision possible.

Usage : python tools/maillot-tissu/08_retouches.py etape5.blend etape5b.blend
"""
import sys

import bpy  # en premier : rend bmesh importable
import bmesh
import numpy as np

REDUCTION = 0.5          # part de la taille marquée qu'on retire
Z_TOP = 1.16             # au-dessus : aisselles / emmanchures, pas de retouche
FADE = 0.04              # fondu sous Z_TOP


def shell_offsets(ob):
    """Distance coque extérieure ↔ coque intérieure du Solidify, par sommet."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    em = ev.to_mesh()
    n = len(ob.data.vertices)
    co = np.array([v.co[:] for v in em.vertices])
    ev.to_mesh_clear()
    return np.linalg.norm(co[:n] - co[n:2 * n], axis=1)


def fix_artifacts(ob):
    sol = ob.modifiers["Solidify"]
    d = shell_offsets(ob)
    bad = set(np.nonzero(d > 0.003)[0].tolist())
    print(f"[retouches] coque intérieure : max {d.max() * 1000:.1f} mm, {len(bad)} sommets > 3 mm")
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    zone = set(bad)
    for i in bad:                                   # + 1 anneau
        zone |= {e.other_vert(bm.verts[i]).index for e in bm.verts[i].link_edges}
    zone = [bm.verts[i] for i in zone if not bm.verts[i].is_boundary]
    for _ in range(4):
        new = {}
        for v in zone:
            nb = [e.other_vert(v).co for e in v.link_edges]
            mean = sum(nb, v.co * 0) / len(nb)
            new[v] = v.co.lerp(mean, 0.5)
        for v, c in new.items():
            v.co = c
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    sol.use_even_offset = False
    d = shell_offsets(ob)
    print(f"[retouches] lissage local de {len(zone)} sommets ; even offset coupé : max {d.max() * 1000:.1f} mm, "
          f"{int((d > 0.003).sum())} sommets > 3 mm")


def upper_hull(z, w):
    """Enveloppe convexe supérieure de w(z) (z croissant), évaluée en z."""
    pts = sorted(zip(z, w))
    hull = []
    for p in pts:
        while len(hull) >= 2 and (hull[-1][0] - hull[-2][0]) * (p[1] - hull[-2][1]) - \
                (hull[-1][1] - hull[-2][1]) * (p[0] - hull[-2][0]) >= 0:
            hull.pop()
        hull.append(p)
    hz, hw = zip(*hull)
    return np.interp(z, hz, hw)


def straighten(ob):
    me = ob.data
    gi = {g.name: g.index for g in ob.vertex_groups}
    sleeves = {gi["manche_D"], gi["manche_G"]}
    body = np.array([not ({g.group for g in v.groups} & sleeves) for v in me.vertices])
    co = np.array([v.co[:] for v in me.vertices])
    zmin = co[body, 2].min()
    edges = np.arange(zmin, Z_TOP + 0.01, 0.01)
    zc = (edges[:-1] + edges[1:]) / 2
    for side in (1, -1):
        half = np.array([max((side * co[body & (co[:, 2] >= a) & (co[:, 2] < b) & (side * co[:, 0] > 0), 0]).max(initial=0), 0)
                         for a, b in zip(edges[:-1], edges[1:])])
        ok = half > 0
        ref = upper_hull(zc[ok], half[ok])
        target = half[ok] + REDUCTION * (ref - half[ok])
        scale = target / half[ok]
        sel = body & (side * co[:, 0] > 0) & (co[:, 2] < Z_TOP)
        s = np.interp(co[sel, 2], zc[ok], scale)
        fade = np.clip((Z_TOP - co[sel, 2]) / FADE, 0, 1)
        fade = fade * fade * (3 - 2 * fade)
        co[sel, 0] *= 1 + (s - 1) * fade
        k = np.argmin(half[ok])
        print(f"[retouches] côté {'gauche' if side > 0 else 'droit'} : taille z {zc[ok][k]:.2f}, demi-largeur "
              f"{half[ok][k] * 100:.1f} cm, enveloppe droite {ref[k] * 100:.1f} cm → {target[k] * 100:.1f} cm "
              f"(écart {(ref[k] - half[ok][k]) * 100:.1f} → {(ref[k] - target[k]) * 100:.1f} cm)")
    for v, c in zip(me.vertices, co):
        v.co = c
    me.update()


def main(src, dst):
    bpy.ops.wm.open_mainfile(filepath=src)
    ob = bpy.data.objects["Maillot"]
    fix_artifacts(ob)
    straighten(ob)
    d = shell_offsets(ob)
    print(f"[retouches] contrôle final coque intérieure : max {d.max() * 1000:.1f} mm")
    bpy.ops.wm.save_as_mainfile(filepath=dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
