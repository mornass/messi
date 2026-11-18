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
  - Manches : mêmes roses et mêmes rayures, dans le sens de la manche,
    bande claire centrée sur la ligne d'épaule.
  - 3 bandes noires d'épaule à cheval sur la couture : une part sur le
    devant, l'autre sur le dos (distance signée à la même couture), puis
    sur le dessus des manches : aucune coupure à la couture.
  - Devant : écusson Inter Miami 8 cm (cœur, côté gauche du porteur),
    3 bandes adidas 7 cm (côté droit), emblème Royal Caribbean centré.
    L'écusson est le PNG d'origine, plaqué en décalque dans le shader à sa
    pleine résolution (256 px/cm), pas rééchantillonné dans la texture.
  - Col : matériau à part « col_cotes », bord-côte rose soutenu (côtes 1×1).
  - Dos : MESSI (lettres de 7 cm) et 10 (25 cm), noir, Bebas Neue, centrés.
    Le dos est vu de derrière : u croît vers la gauche du spectateur, le
    texte est donc écrit en miroir dans la carte UV.

Images annexes :
  masque (RGB) : R = impressions, G = libre, B = hauteur du relief
  maille (normal map tangente, tuilable) : jersey polyester très fin

Matériau « tissu_patron » : Principled BSDF, rugosité 0,65 (tissu) / 0,4
(impressions) / 0,5 (fil brodé), sheen 0,4, normal map maille en tuilage
serré (≈ 7 mm par tuile), relief des impressions par Bump ; écusson brodé
(fil en points lancés, relief ~3× celui des impressions).

Usage : python tools/maillot-tissu/06_texture.py etape5.blend etape6.blend dossier_textures
"""
import os
import sys

import bpy
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGOS = os.path.join(ROOT, "assets", "logos")
FONT = os.path.join(ROOT, "assets", "fonts", "bebas-neue.woff")
FONT_FIN = os.path.join(ROOT, "assets", "fonts", "big-shoulders-{}.woff")   # fine, condensée (OFL)

RES = 4096
S = 1 / 1.25                     # UV par mètre
PX = RES * S                     # pixels par mètre (3277)

ROSE_CLAIR = (247, 200, 214)     # mesurés sur la référence (bande claire / foncée)
ROSE_FONCE = (240, 160, 186)
NOIR = (24, 22, 23)
RAYURE = 0.07                    # largeur d'une rayure (m), d'après la photo de face
HALF_W = 0.25                    # demi-largeur du patron (W = 0,50)
ROSE_DOS = (240, 195, 206)       # dos uni (mesuré sur la référence de dos)
ROSE_PALE = (243, 221, 226)      # panneaux latéraux et dessous des manches (référence)
# 3 bandes d'épaule (12 mm, intervalles 8 mm) côté devant, du col vers l'avant de la manche :
# distance à la couture d'épaule (m), > 0 côté devant ; rien sur le panneau du dos
BANDES = [(0.015, 0.027), (0.035, 0.047), (0.055, 0.067)]
OR_PATCH = (226, 196, 128)       # patch Club World Cup : disque doré
BLEU_PATCH = (38, 86, 168)       # patch « Football Unites the World »
# panneau latéral clair : largeur depuis la couture de côté, 4,5 cm sous le bras → 0 à 52 cm
LAT_Y0, LAT_Y1, LAT_W = -0.24, -0.52, 0.045
SOUS_MANCHE = 0.12               # dessous de manche clair au-delà de 12 cm de la ligne d'épaule
ROSE_COL = (238, 164, 190)       # bord-côte du col : rose soutenu, comme sur la référence
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
    dos = np.zeros((RES, RES), bool)
    pale = np.zeros((RES, RES), bool)
    for t in ("devant", "dos"):
        f = fr[t]
        reg = (np.abs(u - f["u0"]) < HALF_W * S + 0.01) & (v > f["vmin"] - 0.01) & (v < f["v0"] + 0.01)
        x = (u - f["u0"]) / S
        y = (v - f["v0"]) / S
        if t == "devant":                              # rayures sur le devant seulement
            k = np.floor((np.abs(x) + RAYURE / 2) / RAYURE)
            dark |= reg & (k % 2 == 1)
        else:                                          # dos : rose uni
            dos |= reg
        # panneau latéral clair sous le bras, contre la couture de côté (devant et dos)
        r = np.clip((y - LAT_Y1) / (LAT_Y0 - LAT_Y1), 0, 1)
        pale |= reg & (y < LAT_Y0 + 0.01) & (r > 0) & (np.abs(x) > HALF_W - LAT_W * np.sqrt(r))
        if t == "dos":
            continue
        # 3 bandes sur chaque épaule, côté devant, le long de la couture
        for s in (-1, 1):
            N = np.array((s * NECK[0], NECK[1]))
            P = np.array((s * SHOULDER[0], SHOULDER[1]))
            d = (P - N) / np.linalg.norm(P - N)
            n = np.array((-d[1], d[0]))
            if n[1] > 0:                               # normale vers l'intérieur du panneau
                n = -n
            a = (x - N[0]) * d[0] + (y - N[1]) * d[1]
            tt = (x - N[0]) * n[0] + (y - N[1]) * n[1]
            along = reg & (a > -0.03) & (a < np.linalg.norm(P - N) + 0.04)
            for b0, b1 in BANDES:
                black |= along & (tt > b0) & (tt < b1)
    for t in ("manche_D", "manche_G"):
        # mêmes rayures que le devant, dans le sens de la manche, bande claire centrée sur
        # la ligne d'épaule ; les 3 bandes continuent côté devant ; dessous de manche clair
        f = fr[t]
        reg = (u > f["umin"] - 0.01) & (u < f["umax"] + 0.01) & (v > f["vmin"] - 0.01) & (v < f["v0"] + 0.01)
        xs = -(u - f["u0"]) / S                        # > 0 côté devant
        k = np.floor((np.abs(xs) + RAYURE / 2) / RAYURE)
        dark |= reg & (k % 2 == 1) & (xs > 0)          # moitié avant : rayures du devant
        dos |= reg & (xs <= -RAYURE / 2)               # moitié arrière : rose uni du dos
        pale |= reg & (np.abs(xs) > SOUS_MANCHE)
        for b0, b1 in BANDES:
            black |= reg & (xs > b0) & (xs < b1)
    dark &= ~pale
    dos &= ~pale
    col[dark] = ROSE_FONCE
    col[dos] = ROSE_DOS
    col[pale] = ROSE_PALE
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


def stroke_distance(a):
    """Distance (px) de chaque pixel du trait au bord le plus proche (KD-tree mathutils)."""
    from mathutils.kdtree import KDTree
    inside = a
    er = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 127
    edge = np.argwhere(inside & ~er)
    kd = KDTree(len(edge))
    for k, (y, x) in enumerate(edge):
        kd.insert((float(x), float(y), 0.0), k)
    kd.balance()
    d = np.zeros(a.shape, np.float32)
    for y, x in np.argwhere(inside):
        d[y, x] = kd.find((float(x), float(y), 0.0))[2] + 0.5
    return d


def text_inline(txt, cap_h_px, weight, track=0.15, ligne=0.07):
    """Lettrage style Inter Miami : trait noir fin et condensé, fendu d'une ligne intérieure
    (couleur du tissu, transparente) exactement au milieu du trait : là où la distance au bord
    est proche de son maximum local (= demi-épaisseur du trait). ligne : demi-épaisseur de la
    ligne en fraction de l'épaisseur du trait. track : interlettrage (fraction de la hauteur)."""
    big = int(max(400, cap_h_px * 1.5))
    f = ImageFont.truetype(FONT_FIN.format(weight), 1000)
    x0, y0, x1, y1 = f.getbbox("H")
    f = ImageFont.truetype(FONT_FIN.format(weight), int(1000 * big / (y1 - y0)))
    top = f.getbbox("H")[1]
    glyphs = []
    for ch in txt:
        bx0, by0, bx1, by1 = f.getbbox(ch)
        g = Image.new("L", (bx1 - bx0 + 8, big + 8), 0)
        ImageDraw.Draw(g).text((4 - bx0, 4 - top), ch, font=f, fill=255)
        glyphs.append(g)
    gap = track * big
    m = Image.new("L", (int(sum(g.width for g in glyphs) + gap * (len(glyphs) - 1)), big + 8), 0)
    x = 0.0
    for g in glyphs:
        m.paste(g, (int(x), 0))
        x += g.width + gap
    a = np.asarray(m) > 127
    d = stroke_distance(a)
    half = float(d.max())
    win = 2 * int(half * 1.2) + 1
    dq = Image.fromarray(np.clip(d / half * 250, 0, 255).astype(np.uint8))
    loc = np.asarray(dq.filter(ImageFilter.MaxFilter(win)), np.float32) / 250 * half
    inner = a & (d >= loc - ligne * 2 * half) & (loc > 0.5 * half)
    inner = np.asarray(Image.fromarray((inner * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))) > 127
    alpha = (a & ~inner).astype(np.uint8) * 255
    scale = cap_h_px / (big + 8)
    im = Image.new("RGBA", m.size, NOIR + (0,))
    im.putalpha(Image.fromarray(alpha))
    return im.resize((max(1, round(m.width * scale)), max(1, round(m.height * scale))), Image.LANCZOS)


def patch_cwc(diam_px):
    """Patch Club World Cup 2025 : disque doré, logo officiel (Wikimedia) en or foncé."""
    lg = Image.open(os.path.join(LOGOS, "club-world-cup-2025.png")).convert("RGBA")
    lg = lg.crop(lg.getbbox())
    d = int(diam_px * 4)
    im = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.ellipse((0, 0, d - 1, d - 1), fill=OR_PATCH + (255,))
    dr.ellipse((d * 0.03, d * 0.03, d * 0.97, d * 0.97), outline=(176, 138, 60, 255), width=max(1, d // 60))
    s = d * 0.72 / max(lg.size)
    lg = lg.resize((round(lg.width * s), round(lg.height * s)), Image.LANCZOS)
    a = lg.getchannel("A")
    dark = Image.new("RGBA", lg.size, (120, 88, 24, 255))
    dark.putalpha(a)
    im.alpha_composite(dark, ((d - lg.width) // 2, (d - lg.height) // 2))
    return im.resize((round(diam_px), round(diam_px)), Image.LANCZOS)


def patch_unites(w_px, h_px):
    """Patch « Football Unites the World » : rectangle bleu, texte blanc."""
    W, H = int(w_px * 4), int(h_px * 4)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle((0, 0, W - 1, H - 1), radius=H // 6, fill=BLEU_PATCH + (255,))
    dr.rounded_rectangle((H * 0.06, H * 0.06, W - H * 0.06, H - H * 0.06), radius=H // 8,
                         outline=(255, 255, 255, 255), width=max(1, H // 30))
    for txt, cap, yc in (("FOOTBALL UNITES", 0.30, 0.36), ("THE WORLD", 0.20, 0.70)):
        t = text_plain(txt, H * cap, 600, track=0.08)
        wt = Image.new("RGBA", t.size, (255, 255, 255, 255))
        wt.putalpha(t.getchannel("A"))
        im.alpha_composite(wt, (int((W - t.width) / 2), int(H * yc - t.height / 2)))
    return im.resize((round(w_px), round(h_px)), Image.LANCZOS)


def text_plain(txt, cap_h_px, weight=600, track=0.0):
    """Petit texte noir, lettre par lettre (track : interlettrage en fraction de la hauteur)."""
    f = ImageFont.truetype(FONT_FIN.format(weight), 1000)
    x0, y0, x1, y1 = f.getbbox("H")
    big = 300
    f = ImageFont.truetype(FONT_FIN.format(weight), int(1000 * big / (y1 - y0)))
    top = f.getbbox("H")[1]
    letters = []
    for ch in txt:
        bx0, by0, bx1, by1 = f.getbbox(ch)
        g = Image.new("RGBA", (bx1 - bx0 + 8, big + 8), NOIR + (0,))
        ImageDraw.Draw(g).text((4 - bx0, 4 - top), ch, font=f, fill=NOIR + (255,))
        letters.append(g)
    gap = track * big
    im = Image.new("RGBA", (int(sum(g.width for g in letters) + gap * (len(letters) - 1)), big + 8), NOIR + (0,))
    x = 0.0
    for g in letters:
        im.alpha_composite(g, (int(x), 0))
        x += g.width + gap
    sc = cap_h_px / (big + 8)
    return im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)


def arched(txt, cap_h_px, radius_px, weight=600, track=1.0):
    """Texte en arc sous le col, bombé vers le haut comme sur la référence."""
    letters = [text_plain(c, cap_h_px, weight) for c in txt]
    gap = cap_h_px * track
    total = sum(l.width for l in letters) + gap * (len(letters) - 1)
    size = int(radius_px * 2 + cap_h_px * 4)
    out = Image.new("RGBA", (size, size), NOIR + (0,))
    cx = cy = size / 2
    pos = -total / 2
    for l in letters:
        ang = (pos + l.width / 2) / radius_px          # radians, 0 = sommet de l'arc
        r = l.rotate(-np.degrees(ang), resample=Image.BICUBIC, expand=True)
        px = cx + radius_px * np.sin(ang)
        py = cy - radius_px * np.cos(ang)
        out.alpha_composite(r, (int(px - r.width / 2), int(py - r.height / 2)))
        pos += l.width + gap
    return out.crop(out.getbbox())


class Layers:
    def __init__(self, col):
        self.col = Image.fromarray(col.astype(np.uint8), "RGB").convert("RGBA")
        self.prt = Image.new("L", (RES, RES), 0)
        self.crest = Image.new("L", (RES, RES), 0)
        self.log = []

    def place(self, im, f, x, y, width=None, height=None, mirror=False, crest=False, label=""):
        if width is None and height is None:           # déjà à la taille finale (px)
            w, h = im.width, im.height
        elif width is not None:
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


def material(name, tex, interior=False, decal=None):
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

    # écusson : le PNG d'origine (2048 px) en décalque, plaqué tel quel par les UV,
    # sans passer par la texture 4096 (où il ne ferait que 262 px et se déformerait)
    du = N.new("ShaderNodeVectorMath")
    du.operation = "SUBTRACT"
    du.inputs[1].default_value = (decal["u"], decal["v"], 0)
    L.new(uvn.outputs["UV"], du.inputs[0])
    dd = N.new("ShaderNodeVectorMath")
    dd.operation = "DIVIDE"
    dd.inputs[1].default_value = (decal["w"], decal["h"], 1)
    L.new(du.outputs["Vector"], dd.inputs[0])
    e = img("ecusson", False)
    e.extension = "CLIP"
    e.interpolation = "Linear"
    L.new(dd.outputs["Vector"], e.inputs["Vector"])
    mixc = N.new("ShaderNodeMix")
    mixc.data_type = "RGBA"
    L.new(e.outputs["Alpha"], mixc.inputs["Factor"])
    L.new(c.outputs["Color"], mixc.inputs["A"])
    L.new(e.outputs["Color"], mixc.inputs["B"])
    L.new(mixc.outputs["Result"], bsdf.inputs["Base Color"])
    # relief de broderie : fil en points lancés diagonaux (~1 mm)
    wv = N.new("ShaderNodeTexWave")
    wv.wave_type = "BANDS"
    wv.bands_direction = "DIAGONAL"
    wv.inputs["Scale"].default_value = 50
    L.new(dd.outputs["Vector"], wv.inputs["Vector"])
    stitch = N.new("ShaderNodeMapRange")
    stitch.inputs["To Min"].default_value = 0.7
    L.new(wv.outputs["Fac"], stitch.inputs["Value"])
    crest_h = N.new("ShaderNodeMath")
    crest_h.operation = "MULTIPLY"
    L.new(e.outputs["Alpha"], crest_h.inputs[0])
    L.new(stitch.outputs["Result"], crest_h.inputs[1])
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
    L.new(e.outputs["Alpha"], r2.inputs["Factor"])
    L.new(r2.outputs["Result"], bsdf.inputs["Roughness"])
    # la maille disparaît sous les impressions (encre / fil lisses)
    cover = N.new("ShaderNodeMath")
    cover.operation = "MAXIMUM"
    L.new(sep.outputs["Red"], cover.inputs[0])
    L.new(e.outputs["Alpha"], cover.inputs[1])
    st = N.new("ShaderNodeMapRange")
    st.inputs["To Min"].default_value = 0.8
    st.inputs["To Max"].default_value = 0.1
    L.new(cover.outputs["Value"], st.inputs["Value"])
    L.new(st.outputs["Result"], nm.inputs["Strength"])
    # relief des impressions (léger) et de l'écusson (broderie, plus marqué)
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.0008
    hsum = N.new("ShaderNodeMath")
    hsum.operation = "ADD"
    hsum.use_clamp = True
    L.new(sep.outputs["Blue"], hsum.inputs[0])
    L.new(crest_h.outputs["Value"], hsum.inputs[1])
    L.new(hsum.outputs["Value"], bump.inputs["Height"])
    L.new(nm.outputs["Normal"], bump.inputs["Normal"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def srgb_to_linear(c):
    c = np.array(c) / 255
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)) + (1.0,)


def collar_material(v_lo, v_hi):
    """Bord-côte du col : rose soutenu, côtes 1×1 perpendiculaires à l'encolure (pas 2 mm),
    liseré noir sur le haut arrondi (profil du col : base → face extérieure → haut arrondi
    → face intérieure ; le haut arrondi occupe 40 → 74 % du paramètre v du profil)."""
    mat = bpy.data.materials.get("col_cotes") or bpy.data.materials.new("col_cotes")
    mat.use_nodes = True
    N, L = mat.node_tree.nodes, mat.node_tree.links
    N.clear()
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    uvn0 = N.new("ShaderNodeUVMap")
    uvn0.uv_map = "UVMap"
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(uvn0.outputs["UV"], sep.inputs["Vector"])
    fr = N.new("ShaderNodeMapRange")                  # v du profil, 0 (base) → 1
    fr.inputs["From Min"].default_value = v_lo
    fr.inputs["From Max"].default_value = v_hi
    L.new(sep.outputs["Y"], fr.inputs["Value"])
    a = N.new("ShaderNodeMath")
    a.operation = "GREATER_THAN"
    a.inputs[1].default_value = 0.40
    b = N.new("ShaderNodeMath")
    b.operation = "LESS_THAN"
    b.inputs[1].default_value = 0.74
    L.new(fr.outputs["Result"], a.inputs[0])
    L.new(fr.outputs["Result"], b.inputs[0])
    band = N.new("ShaderNodeMath")
    band.operation = "MULTIPLY"
    L.new(a.outputs["Value"], band.inputs[0])
    L.new(b.outputs["Value"], band.inputs[1])
    mix = N.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = srgb_to_linear(ROSE_COL)
    mix.inputs["B"].default_value = srgb_to_linear(NOIR)
    L.new(band.outputs["Value"], mix.inputs["Factor"])
    L.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Sheen Weight"].default_value = 0.4
    bsdf.inputs["Sheen Roughness"].default_value = 0.5
    uvn = N.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    wv = N.new("ShaderNodeTexWave")           # u du col = tour d'encolure : côtes à u constant
    wv.wave_type = "BANDS"
    wv.bands_direction = "X"
    wv.inputs["Scale"].default_value = 196    # 1 UV = 1,25 m → période 2 mm
    L.new(uvn.outputs["UV"], wv.inputs["Vector"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = 0.0006
    L.new(wv.outputs["Fac"], bump.inputs["Height"])
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
    crest_png = os.path.join(LOGOS, "inter-miami.png")
    cw, ch = Image.open(crest_png).size
    decal = dict(w=0.08 * S, h=0.08 * S * ch / cw)
    decal["u"] = dv["u0"] + 0.105 * S - decal["w"] / 2
    decal["v"] = dv["v0"] - 0.16 * S - decal["h"] / 2
    print(f"[etape5] écusson : PNG d'origine {cw}×{ch} px en décalque, 8,0 cm "
          f"({cw / 8:.0f} px/cm, contre {PX / 100:.0f} px/cm dans la texture)")
    lay.place(logo("adidas-bandes.png", NOIR), dv, -0.105, -0.16, width=0.07, label="adidas")
    lay.place(logo("royal-caribbean-emblem.png", NOIR), dv, 0.0, -0.31, width=0.15, label="sponsor")
    # dos : écrit en miroir dans la carte UV (lu de derrière)
    # (tailles et positions relevées sur la référence de dos, juste sous le col / centré)
    lay.place(arched("FREEDOM", 0.004 * PX, 0.05 * PX, track=0.9), ds, 0.0, -0.031, mirror=True,
              label="FREEDOM (sous le col)")
    lay.place(text_plain("TO", 0.0035 * PX, track=0.9), ds, 0.0, -0.0385, mirror=True, label="TO")
    lay.place(text_plain("DREAM", 0.004 * PX, track=0.9), ds, 0.0, -0.045, mirror=True, label="DREAM")
    lay.place(text_inline("MESSI", 0.06 * PX, 500, track=0.18), ds, 0.0, -0.084, height=0.06,
              mirror=True, label="MESSI")
    lay.place(text_inline("10", 0.25 * PX, 500, track=0.06), ds, 0.0, -0.285, height=0.25,
              mirror=True, label="10")
    # manche droite du porteur (manche_D), côté extérieur-avant, sous les 3 bandes ;
    # vue de l'extérieur, le devant (u plus petit) est à droite : patchs écrits en miroir
    md = fr["manche_D"]
    lay.place(patch_cwc(0.075 * PX), md, -0.105, -0.075, width=0.075, mirror=True, label="patch Club World Cup")
    lay.place(patch_unites(0.065 * PX, 0.022 * PX), md, -0.105, -0.140, width=0.065, mirror=True,
              label="patch Football Unites the World")
    for line in lay.log:
        print("[etape5]", line)

    col_path = os.path.join(texdir, "miami_couleur.png")
    lay.col.convert("RGB").save(col_path)
    prt = np.asarray(lay.prt, np.float32) / 255
    height = np.clip(prt * 0.35, 0, 1)
    mask = np.dstack((prt, np.zeros_like(prt), height))      # G libre (écusson : décalque)
    mask_path = os.path.join(texdir, "miami_masque.png")
    Image.fromarray((mask * 255).astype(np.uint8)).save(mask_path)
    knit_path = os.path.join(texdir, "maille_normal.png")
    knit_normal(knit_path)
    print(f"[etape5] textures : {col_path} ({RES} px), masque, maille")

    tex = {k: bpy.data.images.load(p) for k, p in
           (("couleur", col_path), ("masque", mask_path), ("maille", knit_path), ("ecusson", crest_png))}
    for im in tex.values():
        im.pack()
    material("tissu_patron", tex, decal=decal)
    material("tissu_interieur", tex, interior=True)
    col = bpy.data.objects["Col"]
    col.data.materials.clear()
    cuv = [d.uv[1] for d in col.data.uv_layers.active.data]
    col.data.materials.append(collar_material(min(cuv), max(cuv)))
    bpy.ops.wm.save_as_mainfile(filepath=dst)
    print("[etape5] matériaux tissu_patron / tissu_interieur prêts ->", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
