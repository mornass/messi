"""
Relaxation des UV sur le maillot drapé (le maillage n'est pas modifié).

Constat : les UV sont restées celles du patron à plat (grille régulière),
mais après simulation les sommets ne sont plus réguliers dans le plan du
tissu (cassage de grille de l'étape 3 ≤ 2 mm, puis bruit de la simulation :
résidu médian 1,8 mm, p95 5,4 mm). Une ligne droite de la texture devient
donc tremblotante sur la surface (numéro, rayures).

Correction : pour chaque panneau, les UV intérieures sont recalculées comme
une application harmonique de la surface 3D finale (poids cotangents,
négatifs ramenés à 0), les bords étant fixes : ourlets, encolure et
coutures (sommets qui ont plusieurs UV) gardent exactement leurs UV, donc
les raccords entre panneaux ne changent pas. Une ligne droite de la texture
suit alors la géométrie réelle du tissu, sans bruit.

Usage : python tools/maillot-tissu/09_uv_relax.py final.blend sortie.blend
"""
import sys

import bpy
import bmesh
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve


def residual(bm, uvl):
    """Résidu UV par sommet intérieur (mm) : écart à l'application affine locale 3D → UV."""
    du, dp = [], []
    for v in bm.verts:
        if v.is_boundary or len({tuple(l[uvl].uv) for l in v.link_loops}) != 1:
            continue
        nb = [e.other_vert(v) for e in v.link_edges]
        nuv = [next(l[uvl].uv for l in n.link_loops if l.face in v.link_faces) for n in nb]
        du.append(np.array(v.link_loops[0][uvl].uv) - np.mean(np.array(nuv), 0))
        dp.append(np.array(v.co) - np.mean(np.array([n.co for n in nb]), 0))
    du, dp = np.array(du), np.array(dp)
    M, *_ = np.linalg.lstsq(dp, du, rcond=None)
    r = np.linalg.norm(du - dp @ M, axis=1) * 1250
    return np.median(r), np.percentile(r, 95)


def main(src, dst):
    bpy.ops.wm.open_mainfile(filepath=src)
    ob = bpy.data.objects["Maillot"]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    print("[uv] résidu avant : médian %.2f mm, p95 %.2f mm" % residual(bm, uvl))

    # sommets libres : strictement à l'intérieur d'UN panneau ; fixes : bords, coutures (plusieurs
    # panneaux ou plusieurs UV), repli d'ourlet (hors panneau, UV recopiées) et leurs voisins directs
    panels = {ob.vertex_groups[t].index for t in ("devant", "dos", "manche_D", "manche_G")}
    dl = bm.verts.layers.deform.active
    def n_panels(v):
        return len(panels & set(v[dl].keys()))
    fixed = [v.is_boundary or n_panels(v) != 1
             or len({tuple(round(c, 7) for c in l[uvl].uv) for l in v.link_loops}) != 1
             for v in bm.verts]
    fold = [n_panels(v) == 0 for v in bm.verts]
    for v in bm.verts:
        if any(fold[e.other_vert(v).index] for e in v.link_edges):
            fixed[v.index] = True
    free = [i for i, f in enumerate(fixed) if not f and bm.verts[i].link_loops]
    idx = {v: k for k, v in enumerate(free)}
    # poids cotangents (par arête, depuis les triangles) ; l'UV d'un voisin fixe est lue dans la
    # face partagée (un sommet de couture a une UV par panneau : on prend celle du bon panneau)
    W, UVN = {}, {}
    for f in bm.faces:
        ls = list(f.loops)
        n = len(ls)
        for k in range(n):
            la, lb, lc = ls[k], ls[(k + 1) % n], ls[(k + 2) % n]  # angle en b, opposé à l'arête a-c
            u, w = la.vert.co - lb.vert.co, lc.vert.co - lb.vert.co
            cot = u.dot(w) / max(u.cross(w).length, 1e-12)
            a, c = la.vert.index, lc.vert.index
            for p_, q_, lq in ((a, c, lc), (c, a, la)):
                W[(p_, q_)] = W.get((p_, q_), 0.0) + 0.5 * cot
                UVN[(p_, q_)] = np.array(lq[uvl].uv)
    uv0 = np.zeros((len(bm.verts), 2))
    for v in bm.verts:
        if v.link_loops:
            uv0[v.index] = v.link_loops[0][uvl].uv
    rows, cols, vals = [], [], []
    rhs = np.zeros((len(free), 2))
    diag = np.zeros(len(free))
    for (p_, q_), w in W.items():
        if p_ not in idx:
            continue
        w = max(w, 1e-4)                                           # poids négatifs → ~0 (pas de retournement)
        diag[idx[p_]] += w
        if q_ in idx:
            rows.append(idx[p_]); cols.append(idx[q_]); vals.append(-w)
        else:
            rhs[idx[p_]] += w * UVN[(p_, q_)]
    rows += list(range(len(free))); cols += list(range(len(free))); vals += list(diag)
    A = coo_matrix((vals, (rows, cols)), shape=(len(free), len(free))).tocsr()
    sol = np.column_stack([spsolve(A, rhs[:, 0]), spsolve(A, rhs[:, 1])])
    moved = np.linalg.norm(sol - uv0[free], axis=1) * 1250
    for k, i in enumerate(free):
        for l in bm.verts[i].link_loops:
            l[uvl].uv = sol[k]
    print(f"[uv] {len(free)} sommets intérieurs relâchés (bords et coutures fixes : {sum(fixed)}) ; "
          f"déplacement UV moyen {moved.mean():.2f} mm, max {moved.max():.2f} mm")
    print("[uv] résidu après : médian %.2f mm, p95 %.2f mm" % residual(bm, uvl))
    bm.to_mesh(ob.data)
    bm.free()
    bpy.ops.wm.save_as_mainfile(filepath=dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
