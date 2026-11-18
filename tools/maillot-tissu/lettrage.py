"""
Lettrage vectoriel du dos (MESSI / 10), style Inter Miami, sans police :
chaque glyphe est une ligne médiane faite de courbes de Bézier cubiques,
épaissie en trait noir (shapely buffer) ; le filet rose au milieu du trait
est l'offset intérieur propre du trait : buffer(-(épaisseur - filet) / 2),
qui suit tout le contour à mi-épaisseur.

Unités : centimètres, y vers le haut, origine en bas à gauche du mot.
Export SVG (chemins remplis, règle evenodd) et rasterisation antialiasée
(suréchantillonnage ×4 puis réduction Lanczos).

Usage autonome : python tools/maillot-tissu/lettrage.py sortie.svg
"""
import sys

import numpy as np
from PIL import Image, ImageDraw
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import unary_union

K = 0.552                       # poignée de Bézier d'un quart de cercle
N_SEG = 48                      # échantillons par segment de Bézier


def bezier(p0, p1, p2, p3, n=N_SEG):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def path(*segs):
    """Concatène des segments : tuple de 2 points = droite, de 4 points = Bézier cubique."""
    pts = []
    for s in segs:
        a = np.array(s if len(s) == 2 else bezier(*s))
        pts.extend(a.tolist() if not pts else a[1:].tolist())
    return pts


def catmull_bezier(points, closed=False):
    """Courbe lisse passant par les points, en segments de Bézier cubiques (Catmull-Rom)."""
    P = [np.array(p, float) for p in points]
    n = len(P)
    segs = []
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = P[i - 1] if (i > 0 or closed) else P[i]
        p1, p2 = P[i], P[(i + 1) % n]
        p3 = P[(i + 2) % n] if (i + 2 < n or closed) else P[i + 1]
        segs.append((p1, p1 + (p2 - p0) / 6, p2 - (p3 - p1) / 6, p2))
    return path(*segs)


def rounded_rect(x0, y0, x1, y1, r, k=0.75):
    """Ligne médiane fermée d'un rectangle à coins arrondis (Bézier, k > 0,552 : plus « carré »)."""
    return path(((x0 + r, y0), (x1 - r, y0)),
                ((x1 - r, y0), (x1 - r + k * r, y0), (x1, y0 + r - k * r), (x1, y0 + r)),
                ((x1, y0 + r), (x1, y1 - r)),
                ((x1, y1 - r), (x1, y1 - r + k * r), (x1 - r + k * r, y1), (x1 - r, y1)),
                ((x1 - r, y1), (x0 + r, y1)),
                ((x0 + r, y1), (x0 + r - k * r, y1), (x0, y1 - r + k * r), (x0, y1 - r)),
                ((x0, y1 - r), (x0, y0 + r)),
                ((x0, y0 + r), (x0, y0 + r - k * r), (x0 + r - k * r, y0), (x0 + r, y0)))


def stroke(lines, w, closed=()):
    """Épaissit des lignes médianes (trait de largeur w, bouts plats, angles en onglet limité)."""
    geoms = []
    for i, pts in enumerate(lines):
        if i in closed:
            ring = Polygon(pts)
            geoms.append(ring.buffer(w / 2, join_style="mitre").difference(ring.buffer(-w / 2, join_style="mitre")))
        else:
            geoms.append(LineString(pts).buffer(w / 2, cap_style="flat", join_style="mitre", mitre_limit=2.0))
    return unary_union(geoms)


# ---------- glyphes (largeur extérieure, hauteur h, trait w) ----------

def g_1(h, w, width):
    s = w / 2
    x = width - s
    flag = [(s, h - s - 0.26 * h), (x, h - s), (x, 0)]        # empattement en diagonale
    return stroke([flag], w), width


def g_0(h, w, width):
    s = w / 2
    r = (width - w) / 2 * 0.92
    return stroke([rounded_rect(s, s, width - s, h - s, r)], w, closed=(0,)), width


def g_M(h, w, width):
    s = w / 2
    return stroke([[(s, 0), (s, h - s), (width / 2, h * 0.28), (width - s, h - s), (width - s, 0)]], w), width


def g_E(h, w, width):
    s = w / 2
    return stroke([[(width, h - s), (s, h - s), (s, s), (width, s)],
                   [(s, h / 2), (width - 0.12 * width, h / 2)]], w), width


def g_S(h, w, width):
    s = w / 2
    a, b = s, width - s
    pts = [(b, h - s - 0.16 * h), (b - 0.22 * width, h - s), (a + 0.22 * width, h - s), (a, h * 0.72),
           (width / 2, h * 0.5), (b, h * 0.28), (b - 0.22 * width, s), (a + 0.22 * width, s), (a, s + 0.16 * h)]
    return stroke([catmull_bezier(pts)], w), width


def g_I(h, w, width):
    return stroke([[(width / 2, 0), (width / 2, h)]], w), width


GLYPHS = {"1": g_1, "0": g_0, "M": g_M, "E": g_E, "S": g_S, "I": g_I}


def word(spec, h, w, line, gap):
    """spec : [(caractère, largeur)] → (forme noire avec filet évidé, filet seul, largeur totale)."""
    x = 0.0
    parts = []
    for ch, width in spec:
        g, gw = GLYPHS[ch](h, w, width)
        parts.append(affinity.translate(g, xoff=x))
        x += gw + gap
    black = unary_union(parts)
    inner = black.buffer(-(w - line) / 2, join_style="round")      # filet à mi-épaisseur
    return black.difference(inner), inner, x - gap


def number_10():
    """« 10 » : 25 cm de haut, ~30 cm de large (60 % du dos), trait 3 cm, filet 3 mm."""
    return word([("1", 9.0), ("0", 17.5)], 25.0, 3.0, 0.3, 3.5)


def name_messi():
    """« MESSI » : 6 cm de haut, trait 0,9 cm, filet 1,5 mm, lettres larges et espacées."""
    return word([("M", 6.0), ("E", 4.0), ("S", 4.2), ("S", 4.2), ("I", 0.9)], 6.0, 0.9, 0.15, 2.0)


def polys(g):
    return list(g.geoms) if isinstance(g, MultiPolygon) else [g] if not g.is_empty else []


def to_svg(shapes, path_out):
    """shapes : [(géométrie, décalage y)] → SVG en cm (y retourné)."""
    minx = min(g.bounds[0] for g, dy in shapes)
    maxx = max(g.bounds[2] for g, dy in shapes)
    maxy = max(g.bounds[3] + dy for g, dy in shapes)
    miny = min(g.bounds[1] + dy for g, dy in shapes)
    W, H = maxx - minx, maxy - miny
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.2f}cm" height="{H:.2f}cm" '
           f'viewBox="{minx:.3f} 0 {W:.3f} {H:.3f}">']
    for g, dy in shapes:
        d = []
        for p in polys(g):
            for ring in [p.exterior, *p.interiors]:
                c = [(x, maxy - (y + dy)) for x, y in ring.coords]
                d.append("M" + " L".join(f"{x:.3f},{y:.3f}" for x, y in c) + "Z")
        out.append(f'<path fill="#181617" fill-rule="evenodd" d="{" ".join(d)}"/>')
    out.append("</svg>")
    open(path_out, "w").write("\n".join(out))


def raster(g, px_per_cm, color=(24, 22, 23), ss=4, margin=0.2):
    """Rasterise une forme (cm) en RGBA antialiasé : suréchantillonnage ×ss puis Lanczos."""
    minx, miny, maxx, maxy = g.bounds
    minx, miny, maxx, maxy = minx - margin, miny - margin, maxx + margin, maxy + margin
    k = px_per_cm * ss
    W, H = int(np.ceil((maxx - minx) * k)), int(np.ceil((maxy - miny) * k))
    m = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(m)
    tr = lambda c: [((x - minx) * k, (maxy - y) * k) for x, y in c]
    for p in polys(g):
        dr.polygon(tr(p.exterior.coords), fill=255)
        for hole in p.interiors:
            dr.polygon(tr(hole.coords), fill=0)
    m = m.resize((max(1, round(W / ss)), max(1, round(H / ss))), Image.LANCZOS)
    im = Image.new("RGBA", m.size, color + (0,))
    im.putalpha(m)
    return im


if __name__ == "__main__":
    n, _, nw = number_10()
    m, _, mw = name_messi()
    print(f"10 : {nw:.1f} × 25 cm ; MESSI : {mw:.1f} × 6 cm")
    to_svg([(affinity.translate(m, xoff=(nw - mw) / 2), 25.0 + 10.0), (n, 0.0)], sys.argv[1])
