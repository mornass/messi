"""
Étape 2 — Patron du maillot (sans simulation).

1. Quatre panneaux à plat, taille M, quads réguliers ~1 cm :
   - devant : 54 cm de large, 72 cm depuis le haut de l'épaule, épaules en
     pente, emmanchures creusées, encolure ronde creusée de 8 cm ;
   - dos : mêmes dimensions, encolure creusée de 2 cm ;
   - 2 manches : 20 cm de long, tête de manche en cloche, ouverture 36 cm.
   Chaque panneau est un « patch de Coons » : une grille (i, j) posée sur son
   contour ; les bords à coudre sont découpés en tronçons dont le nombre de
   points est fixé (épaule, côté, emmanchure…), identique des deux côtés.
2. UV : projection à plat de chaque panneau (vue de face, orthographique =
   Project from View), même densité, sur une seule carte sans chevauchement.
3. Placement à ~5 cm du mannequin : devant face au torse, dos derrière,
   manches enroulées en cylindre autour des bras.
4. Coutures : arêtes libres entre les points correspondants (épaules, côtés,
   emmanchures ↔ têtes de manche, dessous de manche) ; pas de simulation.

Usage : python tools/maillot-tissu/02_patron.py etape1.blend etape2.blend uv.png
"""
import math
import sys

import bpy  # en premier : rend bmesh / mathutils importables
import bmesh
import mathutils
import numpy as np
from PIL import Image, ImageDraw

STEP = 0.01                      # ~1 cm
W, L = 0.54, 0.72                # largeur, longueur (depuis le haut de l'épaule)
NECK_HALF = 0.085                # demi-largeur d'encolure
SHOULDER = (0.210, -0.045)       # point d'épaule (x, y) : pente ~20°
UNDERARM = (0.270, -0.240)       # dessous de bras (fin d'emmanchure, 24 cm sous l'épaule)
SLEEVE_LEN, SLEEVE_OPEN, CAP_H = 0.20, 0.36, 0.07


# ---------- courbes 2D (x, y), y vers le haut, y = 0 au haut de l'épaule ----------
def resample(pts, n):
    """n segments de longueur égale le long d'une polyligne."""
    pts = np.asarray(pts, float)
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n + 1)
    return np.c_[np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])]


def length(pts):
    pts = np.asarray(pts, float)
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


def bezier(p0, p1, p2, n=200):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2 = map(np.asarray, (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2


def body_curves(neck_depth):
    sx, sy = SHOULDER
    ux, uy = UNDERARM
    # côté gauche (x < 0) : bas → dessous de bras, puis emmanchure jusqu'au point d'épaule
    side = [(-W / 2, -L), (-ux, uy)]
    arm = bezier((-ux, uy), (-0.195, -0.185), (-sx, sy))          # emmanchure creusée
    shoulder = [(-sx, sy), (-NECK_HALF, 0.0)]                     # épaule en pente
    phi = np.linspace(math.pi, 2 * math.pi, 200)
    neck = np.c_[NECK_HALF * np.cos(phi), neck_depth * np.sin(phi)]   # encolure ronde
    return side, arm, shoulder, neck


def coons(bottom, top, left, right):
    """Patch de Coons : bottom/top (N+1 points, gauche→droite), left/right (M+1, bas→haut)."""
    N, M = len(bottom) - 1, len(left) - 1
    P = np.zeros((M + 1, N + 1, 2))
    for j in range(M + 1):
        v = j / M
        for i in range(N + 1):
            u = i / N
            P[j, i] = ((1 - v) * bottom[i] + v * top[i] + (1 - u) * left[j] + u * right[j]
                       - ((1 - u) * (1 - v) * bottom[0] + u * (1 - v) * bottom[-1]
                          + (1 - u) * v * top[0] + u * v * top[-1]))
    return P


def body_panel(neck_depth, n_side, n_arm, n_sh, n_neck):
    side, arm, shoulder, neck = body_curves(neck_depth)
    left = np.r_[resample(side, n_side), resample(arm, n_arm)[1:]]           # bas → épaule
    right = left * [-1, 1]
    top = np.r_[resample(shoulder, n_sh), resample(neck, n_neck)[1:],
                (resample(shoulder, n_sh) * [-1, 1])[::-1][1:]]               # épaule G → épaule D
    N = len(top) - 1
    bottom = resample([(-W / 2, -L), (W / 2, -L)], N)
    return coons(bottom, top, left, right)


def sleeve_panel(cap_half_len, n_arm, n_sl):
    """Manche : tête en cloche (2·n_arm segments), ouverture 36 cm, 20 cm de long."""
    # largeur de tête telle que chaque demi-tête ≈ longueur d'emmanchure (+3 % d'aisance)
    def cap(wc):
        x = np.linspace(-wc / 2, wc / 2, 400)
        return np.c_[x, -CAP_H * np.sin(np.pi * x / wc) ** 2]
    lo, hi = 0.2, 0.8
    for _ in range(60):
        wc = (lo + hi) / 2
        if length(cap(wc)) / 2 < cap_half_len * 1.03:
            lo = wc
        else:
            hi = wc
    c = cap(wc)
    top = np.r_[resample(c[:200], n_arm), resample(c[199:], n_arm)[1:]]      # 2·n_arm segments
    N = len(top) - 1
    y_hem = -SLEEVE_LEN
    bottom = resample([(-SLEEVE_OPEN / 2, y_hem), (SLEEVE_OPEN / 2, y_hem)], N)
    left = resample([(-SLEEVE_OPEN / 2, y_hem), (-wc / 2, -CAP_H)], n_sl)
    right = left * [-1, 1]
    return coons(bottom, top, left, right), wc


# ---------- maillage ----------
def add_grid(bm, P3, uv2, uv_layer, tag, store):
    M1, N1 = P3.shape[:2]
    vs = [[bm.verts.new(P3[j, i]) for i in range(N1)] for j in range(M1)]
    for j in range(M1 - 1):
        for i in range(N1 - 1):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            for loop in f.loops:
                jj, ii = next((a, b) for a in (j, j + 1) for b in (i, i + 1) if vs[a][b] is loop.vert)
                loop[uv_layer].uv = uv2[jj, ii]
    store[tag] = vs
    return vs


def main(src, dst, uv_png):
    bpy.ops.wm.open_mainfile(filepath=src)
    man = bpy.data.objects["Mannequin"]
    co = np.array([man.matrix_world @ v.co for v in man.data.vertices])
    chest = co[(co[:, 2] > 1.15) & (co[:, 2] < 1.40) & (np.abs(co[:, 0]) < 0.15)]
    y_front, y_back = chest[:, 1].min() - 0.05, chest[:, 1].max() + 0.05
    z_top = co[(np.abs(co[:, 0]) > 0.08) & (np.abs(co[:, 0]) < 0.16), 2].max() + 0.05   # 5 cm au-dessus des épaules

    # nombres de points des tronçons (≈ 1 cm), identiques devant / dos
    side, arm, shoulder, _ = body_curves(0.08)
    n_side, n_arm, n_sh = round(length(side) / STEP), round(length(arm) / STEP), round(length(shoulder) / STEP)
    n_neck_f = round(length(body_curves(0.08)[3]) / STEP)
    n_neck_b = round(length(body_curves(0.02)[3]) / STEP)
    front = body_panel(0.08, n_side, n_arm, n_sh, n_neck_f)
    back = body_panel(0.02, n_side, n_arm, n_sh, n_neck_b)
    n_sl = round(SLEEVE_LEN / STEP)          # 20 rangs sur la longueur (dessous de manche : ~0,65 cm)
    sleeve, cap_w = sleeve_panel(length(arm), n_arm, n_sl)

    # ---- UV : projection à plat, même échelle, une carte sans chevauchement ----
    S = 1 / 1.25                                   # 1,25 m de tissu = 1 UV
    def uvmap(P, ox, oy):
        mn = P.reshape(-1, 2).min(0)
        return (P - mn) * S + [ox, oy]
    uv_front = uvmap(front, 0.02, 0.36)
    uv_back = uvmap(back, 0.02 + W * S + 0.04, 0.36)
    sl_w = (sleeve.reshape(-1, 2).max(0) - sleeve.reshape(-1, 2).min(0))[0] * S
    uv_sl = [uvmap(sleeve, 0.02, 0.04), uvmap(sleeve, 0.02 + sl_w + 0.04, 0.04)]

    # ---- placement 3D ----
    def place_body(P, y):
        return np.dstack([P[..., 0], np.full(P.shape[:2], y), z_top + P[..., 1]])

    # bras : axe mesuré sur le mannequin (haut du bras, A-pose)
    def arm_axis(sign):
        # centre du haut du bras (au-delà de l'aisselle) ; direction de la pose A : 45° vers le bas
        pts = co[(sign * co[:, 0] > 0.22) & (co[:, 2] > 1.15)]
        c = pts.mean(0)
        d = np.array([sign * math.cos(math.radians(45)), 0.0, -math.sin(math.radians(45))])
        return c, d

    def place_sleeve(P, sign):
        c, d = arm_axis(sign)
        d = mathutils.Vector(d)
        c = mathutils.Vector(c)
        up = mathutils.Vector((0, 0, 1)) - d * d.z
        up.normalize()                                       # perpendiculaire au bras, vers le haut
        yv = mathutils.Vector((0, 1, 0))                     # avant (-Y) / arrière (+Y)
        R = cap_w / (2 * math.pi)                             # cylindre fermé : périmètre = largeur de tête
        # sommet de la tête face au point d'épaule du patron
        S = mathutils.Vector((sign * SHOULDER[0], c.y, z_top + SHOULDER[1]))
        start = c + d * (S - up * R - c).dot(d)
        out = np.zeros(P.shape[:2] + (3,))
        for j in range(P.shape[0]):
            for i in range(P.shape[1]):
                s, t = P[j, i]
                th = s / R                                    # s < 0 : moitié avant (-Y)
                p = start + d * (-t) + (up * math.cos(th) + yv * math.sin(th)) * R
                out[j, i] = p
        return out, R

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    grids = {}
    add_grid(bm, place_body(front, y_front), uv_front, uvl, "devant", grids)
    add_grid(bm, place_body(back, y_back), uv_back, uvl, "dos", grids)
    radii = {}
    for k, sign, tag in ((0, -1, "manche_D"), (1, 1, "manche_G")):
        P3, radii[tag] = place_sleeve(sleeve, sign)
        add_grid(bm, P3, uv_sl[k], uvl, tag, grids)

    # ---- coutures : listes de points appariés ----
    F, Bk = grids["devant"], grids["dos"]
    nF, nB = len(F[0]) - 1, len(Bk[0]) - 1
    seams = {}
    # épaules : n_sh+1 points (haut, à partir du point d'épaule)
    seams["épaule D"] = list(zip(F[-1][:n_sh + 1], Bk[-1][:n_sh + 1]))
    seams["épaule G"] = list(zip(F[-1][nF - n_sh:], Bk[-1][nB - n_sh:]))
    # côtés : colonne gauche / droite, du bas au dessous de bras
    seams["côté D"] = [(F[j][0], Bk[j][0]) for j in range(n_side + 1)]
    seams["côté G"] = [(F[j][-1], Bk[j][-1]) for j in range(n_side + 1)]
    # emmanchures ↔ têtes de manche (moitié avant ↔ devant, moitié arrière ↔ dos)
    for tag, col in (("manche_D", 0), ("manche_G", -1)):
        Sg = grids[tag]
        top = Sg[-1]                                          # tête : 2·n_arm segments
        armF = [F[j][col] for j in range(n_side, n_side + n_arm + 1)]
        armB = [Bk[j][col] for j in range(n_side, n_side + n_arm + 1)]
        half_front = top[:n_arm + 1]                          # dessous de bras → sommet, côté avant
        half_back = top[n_arm:][::-1]                         # dessous de bras → sommet, côté arrière
        seams[f"emmanchure {tag[-1]} devant"] = list(zip(armF, half_front))
        seams[f"emmanchure {tag[-1]} dos"] = list(zip(armB, half_back))
        # dessous de manche : bord gauche ↔ bord droit
        seams[f"dessous {tag}"] = [(Sg[j][0], Sg[j][-1]) for j in range(len(Sg) - 1)]

    n_edges = 0
    for name, pairs in seams.items():
        for a, b in pairs:
            if a is not b and not any(e for e in a.link_edges if e.other_vert(a) is b):
                bm.edges.new((a, b))
                n_edges += 1

    me = bpy.data.meshes.new("Maillot")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Maillot", me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new("tissu_patron")
    mat.diffuse_color = (0.96, 0.72, 0.80, 1)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.96, 0.62, 0.72, 1)
    me.materials.append(mat)

    # visualisation des coutures (fil rouge fin), pour les captures seulement
    vis = bpy.data.meshes.new("coutures_visu")
    vbm = bmesh.new()
    me.update()
    face_edges = {ek for p in me.polygons for ek in p.edge_keys}
    for e in me.edges:
        if tuple(sorted(e.vertices)) not in face_edges:
            a, b = (me.vertices[i].co for i in e.vertices)
            vbm.verts.new(a); vbm.verts.new(b)
    vbm.verts.ensure_lookup_table()
    for k in range(0, len(vbm.verts), 2):
        vbm.edges.new((vbm.verts[k], vbm.verts[k + 1]))
    vbm.to_mesh(vis)
    vbm.free()
    vo = bpy.data.objects.new("coutures_visu", vis)
    bpy.context.scene.collection.objects.link(vo)
    bpy.context.view_layer.objects.active = vo
    vo.select_set(True)
    bpy.ops.object.convert(target="CURVE")
    vo.data.bevel_depth = 0.0012
    vm = bpy.data.materials.new("fil")
    vm.diffuse_color = (0.85, 0.05, 0.1, 1)
    vm.use_nodes = True
    vm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.85, 0.05, 0.1, 1)
    vo.data.materials.append(vm)

    # ---- rapport ----
    print(f"[etape2] panneaux : devant {len(F[0])}×{len(F)} pts, dos {len(Bk[0])}×{len(Bk)} pts, "
          f"manches {len(grids['manche_D'][0])}×{len(grids['manche_D'])} pts (tête {cap_w * 100:.1f} cm, "
          f"rayon d'enroulement {radii['manche_G'] * 100:.1f} cm)")
    quads = np.array([[(me.vertices[p.vertices[1]].co - me.vertices[p.vertices[0]].co).length,
                       (me.vertices[p.vertices[2]].co - me.vertices[p.vertices[1]].co).length] for p in me.polygons])
    print(f"[etape2] quads : {len(me.polygons)}, côtés moyens {quads.mean() * 100:.2f} cm "
          f"(min {quads.min() * 100:.2f}, max {quads.max() * 100:.2f})")
    for name, pairs in seams.items():
        print(f"[etape2] couture {name:22s} : {len(pairs)} ↔ {len(pairs)} sommets")
    print(f"[etape2] arêtes de couture créées : {n_edges} ; devant à y={y_front:.3f}, dos à y={y_back:.3f}, "
          f"haut z={z_top:.3f}")

    # ---- carte UV (image) ----
    Wpx = 1600
    img = Image.new("RGB", (Wpx, Wpx), (22, 26, 34))
    dr = ImageDraw.Draw(img)
    uvd = me.uv_layers["UVMap"].data
    cols = {"devant": (246, 160, 190), "dos": (190, 200, 246), "manche": (200, 240, 200)}
    for p in me.polygons:
        pts = [(uvd[li].uv[0] * Wpx, (1 - uvd[li].uv[1]) * Wpx) for li in p.loop_indices]
        dr.polygon(pts, outline=(120, 130, 150))
    for g in range(11):
        dr.line([(g * Wpx / 10, 0), (g * Wpx / 10, Wpx)], fill=(40, 46, 58))
        dr.line([(0, g * Wpx / 10), (Wpx, g * Wpx / 10)], fill=(40, 46, 58))
    img.save(uv_png)

    bpy.ops.wm.save_as_mainfile(filepath=dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
