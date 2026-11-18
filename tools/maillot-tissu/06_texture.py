"""
Étape 5 — Texture et matériau du maillot Inter Miami (domicile 2025).
Le maillage n'est pas modifié : seules les images et les matériaux changent.

Texture couleur 4096 px peinte dans l'espace UV (1 UV = 1,25 m de tissu,
donc 32,8 px par cm). Tout est placé en coordonnées réelles du patron
(mètres, x = 0 au milieu du panneau, y = 0 à la ligne des points d'encolure).

  - Rayures verticales rose clair / rose soutenu de 11,5 cm, bande claire
    centrée (mesuré sur la référence). Le motif est symétrique en x et les
    coutures de côté sont à x = ±W/2 sur le devant comme sur le dos : les
    rayures se raccordent exactement aux coutures.
  - 3 bandes noires sur les épaules (devant), prolongées sur le dessus des
    manches, côté devant.
  - Devant : écusson Inter Miami 8 cm (cœur, côté gauche du porteur),
    3 bandes adidas 7 cm (côté droit), emblème Royal Caribbean centré.
  - Dos : MESSI (lettres de 7 cm) et 10 (25 cm), noir, Bebas Neue, centrés.
    Le dos est vu de derrière : u croît vers la gauche du spectateur, le
    texte est donc écrit en miroir dans la carte UV.

Images annexes :
  masque (RGB) : R = impressions, G = écusson brodé, B = hauteur du relief
  maille (normal map tangente, tuilable) : jersey polyester très fin

Matériau « tissu_patron » : Principled BSDF, rugosité 0,65 (tissu) / 0,4
(impressions) / 0,5 (fil brodé), sheen 0,4, normal map maille en tuilage
serré (≈ 7 mm par tuile), relief des impressions par Bump (écusson ×3).

Usage : python tools/maillot-tissu/06_texture.py etape5.blend etape6.blend dossier_textures
"""
import os
import sys

import bpy
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGOS = os.path.join(ROOT, "assets", "logos")
FONT = os.path.join(ROOT, "assets", "fonts", "bebas-neue.woff")

RES = 4096
S = 1 / 1.25                     # UV par mètre
PX = RES * S                     # pixels par mètre (3277)

ROSE_CLAIR = (247, 200, 214)     # mesurés sur la référence (bande claire / foncée)
ROSE_FONCE = (240, 160, 186)
NOIR = (24, 22, 23)
RAYURE = 0.115                   # largeur d'une rayure (m)
HALF_W = 0.25                    # demi-largeur du patron (W = 0,50)
# 3 bandes d'épaule : distances à la couture (m)
BANDES = [(0.004, 0.012), (0.018, 0.026), (0.032, 0.040)]
NECK, SHOULDER = (0.085, 0.0), (0.21, -0.045)


def panel_frames(ob):
    """Centre u et haut v de chaque panneau, côté devant des manches."""
    me = ob.data
    uv = me.uv_layers.active.data
    gi = {g.name: g.index for g in ob.vertex_groups}
    pts = {t: [] for t in ("devant", "dos", "manche_D", "manche_G")}
    for p in me.polygons:
        gs = {g.group for g in me.vertices[p.vertices[0]].groups}
        for t in pts:
            if gi[t] in gs:
                pts[t] += [uv[li].uv[:] for li in p.loop_indices]
                break
    fr = {}
    for t, P in pts.items():
        P = np.array(P)
        vmax = P[:, 1].max()
        top = P[P[:, 1] > vmax - 1e-3]
        fr[t] = dict(u0=float(top[:, 0].mean()), v0=float(vmax),
                     umin=float(np.percentile(P[:, 0], 1)), umax=float(np.percentile(P[:, 0], 99)),
                     vmin=float(P[:, 1].min()))
        print(f"[etape5] {t:9s} centre u {fr[t]['u0']:.4f}, haut v {vmax:.4f}")
    return fr


def grid():
    j, i = np.meshgrid(np.arange(RES), np.arange(RES))
    u = (j + 0.5) / RES
    v = 1 - (i + 0.5) / RES
    return u, v


def paint_base(fr):
    u, v = grid()
    col = np.empty((RES, RES, 3), np.float32)
    col[:] = ROSE_CLAIR
    dark = np.zeros((RES, RES), bool)
    black = np.zeros((RES, RES), bool)
    for t in ("devant", "dos"):
        f = fr[t]
        reg = (np.abs(u - f["u0"]) < HALF_W * S + 0.01) & (v > f["vmin"] - 0.01) & (v < f["v0"] + 0.01)
        x = (u - f["u0"]) / S
        k = np.floor((np.abs(x) + RAYURE / 2) / RAYURE)
        dark |= reg & (k % 2 == 1)
        if t == "devant":                      # 3 bandes sur chaque épaule
            y = (v - f["v0"]) / S
            for s in (-1, 1):
                N = np.array((s * NECK[0], NECK[1]))
                P = np.array((s * SHOULDER[0], SHOULDER[1]))
                d = (P - N) / np.linalg.norm(P - N)
                n = np.array((d[1], -d[0])) * (1 if s > 0 else -1)   # vers le bas du panneau
                if n[1] > 0:
                    n = -n
                a = (x - N[0]) * d[0] + (y - N[1]) * d[1]
                tt = (x - N[0]) * n[0] + (y - N[1]) * n[1]
                along = reg & (a > -0.03) & (a < np.linalg.norm(P - N) + 0.04)
                for b0, b1 in BANDES:
                    black |= along & (tt > b0) & (tt < b1)
    for t in ("manche_D", "manche_G"):         # bandes prolongées sur la manche, côté devant (u plus petit)
        f = fr[t]
        reg = (u > f["umin"] - 0.01) & (u < f["umax"] + 0.01) & (v > f["vmin"] - 0.01) & (v < f["v0"] + 0.01)
        xs = -(u - f["u0"]) / S
        for b0, b1 in BANDES:
            black |= reg & (xs > b0) & (xs < b1)
    col[dark] = ROSE_FONCE
    col[black] = NOIR
    print(f"[etape5] rayures {RAYURE * 100:.1f} cm, bande claire centrée ; raccord aux coutures de côté : "
          f"x = ±{HALF_W * 100:.0f} cm tombe dans la même bande sur le devant et le dos "
          f"({'claire' if np.floor((HALF_W + RAYURE / 2) / RAYURE) % 2 == 0 else 'foncée'})")
    return col


def logo(name, color=None):
    im = Image.open(os.path.join(LOGOS, name)).convert("RGBA")
    im = im.crop(im.getbbox())
    if color is not None:
        a = im.getchannel("A")
        im = Image.new("RGBA", im.size, color + (255,))
        im.putalpha(a)
    return im


def text_img(txt, cap_h_px):
    f = ImageFont.truetype(FONT, 1000)
    x0, y0, x1, y1 = f.getbbox(txt)
    size = int(1000 * cap_h_px / (y1 - y0))
    f = ImageFont.truetype(FONT, size)
    x0, y0, x1, y1 = f.getbbox(txt)
    im = Image.new("RGBA", (x1 - x0 + 4, y1 - y0 + 4), NOIR + (0,))
    ImageDraw.Draw(im).text((2 - x0, 2 - y0), txt, font=f, fill=NOIR + (255,))
    return im


class Layers:
    def __init__(self, col):
        self.col = Image.fromarray(col.astype(np.uint8), "RGB").convert("RGBA")
        self.prt = Image.new("L", (RES, RES), 0)
        self.crest = Image.new("L", (RES, RES), 0)
        self.log = []

    def place(self, im, f, x, y, width=None, height=None, mirror=False, crest=False, label=""):
        if width is not None:
            w = width * PX
            h = w * im.height / im.width
        else:
            h = height * PX
            w = h * im.width / im.height
        im = im.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
        if mirror:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        cx = (f["u0"] + x * S) * RES
        cy = (1 - (f["v0"] + y * S)) * RES
        pos = (round(cx - im.width / 2), round(cy - im.height / 2))
        self.col.alpha_composite(im, pos)
        a = im.getchannel("A")
        (self.crest if crest else self.prt).paste(a, pos, a)
        self.log.append(f"{label} : {im.width / PX * 100:.1f} × {im.height / PX * 100:.1f} cm")


def embroidery(mask):
    """Relief de broderie : points lancés diagonaux (période ~1 mm) + bord surélevé."""
    m = np.asarray(mask, np.float32) / 255
    i, j = np.mgrid[0:RES, 0:RES]
    stitch = 0.5 + 0.5 * np.sin((i + j) * 2 * np.pi / 3.3)
    edge = np.clip(m - np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(
        (RES // 4, RES // 4), Image.BILINEAR).resize((RES, RES), Image.BILINEAR), np.float32) / 255, 0, 1)
    return m * (0.65 + 0.35 * stitch) + edge * 0.5


def knit_normal(path, n=512, wales=8, courses=10):
    """Maille jersey : colonnes de boucles en V, tuilable ; normal map tangente (OpenGL, Y+)."""
    y, x = np.mgrid[0:n, 0:n] / n
    fu = (x * wales) % 1
    fv = (y * courses) % 1
    h = np.zeros((n, n))
    for side in (-1, 1):                       # deux jambes de la boucle, inclinées en V
        c = 0.5 + side * (0.18 + 0.12 * (fv - 0.5))
        h = np.maximum(h, np.exp(-((fu - c) ** 2) / (2 * 0.07 ** 2)))
    h *= 0.75 + 0.25 * np.cos(2 * np.pi * fv)  # creux entre les rangées
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * n / 2 / (wales * 6)
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * n / 2 / (courses * 6)
    nrm = np.dstack((-gx, gy, np.ones_like(h)))
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(path)


def material(name, tex, interior=False):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links

    def img(key, non_color):
        n = N.new("ShaderNodeTexImage")
        n.image = tex[key]
        n.image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
        n.interpolation = "Cubic"
        return n

    uvn = N.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    c = img("couleur", False)
    L.new(uvn.outputs["UV"], c.inputs["Vector"])
    bsdf.inputs["Sheen Weight"].default_value = 0.4
    bsdf.inputs["Sheen Roughness"].default_value = 0.5

    # maille : tuilage serré (≈ 7 mm par tuile)
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (174, 174, 1)
    L.new(uvn.outputs["UV"], mp.inputs["Vector"])
    k = img("maille", True)
    k.interpolation = "Linear"
    L.new(mp.outputs["Vector"], k.inputs["Vector"])
    nm = N.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    L.new(k.outputs["Color"], nm.inputs["Color"])

    if interior:
        dim = N.new("ShaderNodeMix")
        dim.data_type = "RGBA"
        dim.blend_type = "MULTIPLY"
        dim.inputs["Factor"].default_value = 1.0
        dim.inputs["B"].default_value = (0.82, 0.82, 0.82, 1)
        L.new(c.outputs["Color"], dim.inputs["A"])
        L.new(dim.outputs["Result"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.7
        nm.inputs["Strength"].default_value = 0.8
        L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        return mat

    L.new(c.outputs["Color"], bsdf.inputs["Base Color"])
    m = img("masque", True)
    L.new(uvn.outputs["UV"], m.inputs["Vector"])
    sep = N.new("ShaderNodeSeparateColor")
    L.new(m.outputs["Color"], sep.inputs["Color"])
    # rugosité : tissu 0,65 → impressions 0,4 → fil brodé 0,5
    r1 = N.new("ShaderNodeMix")
    r1.inputs["A"].default_value = 0.65
    r1.inputs["B"].default_value = 0.4
    L.new(sep.outputs["Red"], r1.inputs["Factor"])
    r2 = N.new("ShaderNodeMix")
    r2.inputs["B"].default_value = 0.5
    L.new(r1.outputs["Result"], r2.inputs["A"])
    L.new(sep.outputs["Green"], r2.inputs["Factor"])
    L.new(r2.outputs["Result"], bsdf.inputs["Roughness"])
    # la maille disparaît sous les impressions (encre / fil lisses)
    cover = N.new("ShaderNodeMath")
    cover.operation = "MAXIMUM"
    L.new(sep.outputs["Red"], cover.inputs[0])
    L.new(sep.outputs["Green"], cover.inputs[1])
    st = N.new("ShaderNodeMapRange")
    st.inputs["To Min"].default_value = 0.8
    st.inputs["To Max"].default_value = 0.1
    L.new(cover.outputs["Value"], st.inputs["Value"])
    L.new(st.outputs["Result"], nm.inputs["Strength"])
    # relief des impressions (léger) et de l'écusson (broderie, plus marqué)
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.0008
    L.new(sep.outputs["Blue"], bump.inputs["Height"])
    L.new(nm.outputs["Normal"], bump.inputs["Normal"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def main(src, dst, texdir):
    os.makedirs(texdir, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=src)
    ob = bpy.data.objects["Maillot"]
    fr = panel_frames(ob)

    lay = Layers(paint_base(fr))
    dv, ds = fr["devant"], fr["dos"]
    # devant (x > 0 = côté gauche du porteur, à droite sur la vue de face)
    lay.place(logo("inter-miami.png"), dv, 0.105, -0.16, width=0.08, crest=True, label="écusson")
    lay.place(logo("adidas-bandes.png", NOIR), dv, -0.105, -0.16, width=0.07, label="adidas")
    lay.place(logo("royal-caribbean-emblem.png", NOIR), dv, 0.0, -0.31, width=0.15, label="sponsor")
    # dos : écrit en miroir dans la carte UV (lu de derrière)
    lay.place(text_img("MESSI", 0.07 * PX), ds, 0.0, -0.135, height=0.07, mirror=True, label="MESSI")
    lay.place(text_img("10", 0.25 * PX), ds, 0.0, -0.315, height=0.25, mirror=True, label="10")
    for line in lay.log:
        print("[etape5]", line)

    col_path = os.path.join(texdir, "miami_couleur.png")
    lay.col.convert("RGB").save(col_path)
    prt = np.asarray(lay.prt, np.float32) / 255
    crest = np.asarray(lay.crest, np.float32) / 255
    height = np.clip(prt * 0.35 + embroidery(lay.crest), 0, 1)
    mask = np.dstack((prt, crest, height))
    mask_path = os.path.join(texdir, "miami_masque.png")
    Image.fromarray((mask * 255).astype(np.uint8)).save(mask_path)
    knit_path = os.path.join(texdir, "maille_normal.png")
    knit_normal(knit_path)
    print(f"[etape5] textures : {col_path} ({RES} px), masque, maille")

    tex = {k: bpy.data.images.load(p) for k, p in
           (("couleur", col_path), ("masque", mask_path), ("maille", knit_path))}
    for im in tex.values():
        im.pack()
    material("tissu_patron", tex)
    material("tissu_interieur", tex, interior=True)
    bpy.ops.wm.save_as_mainfile(filepath=dst)
    print("[etape5] matériaux tissu_patron / tissu_interieur prêts ->", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
