#!/usr/bin/env python3
"""
Génère le nom d'un club en tracés SVG (un <path> par lettre) pour le panneau
d'ouverture des clubs : chaque lettre a une vraie longueur (getTotalLength),
ce qui permet de la "dessiner" au scroll avec stroke-dashoffset.

Police : Archivo variable italique (axes wght + wdth), réglée comme le CSS
du site (graisse 900, largeur 75 %), crénage appliqué. Le script donne un
viewBox ajusté au nom : la largeur à l'écran est fixée en CSS (.club-name).

Dépendances : pip install fonttools brotli uharfbuzz
Police      : npm pack @fontsource-variable/archivo
              → files/archivo-latin-wdth-italic.woff2

Police des noms de club : Covered By Your Grace (marqueur, licence OFL), la plus
proche du lettrage dessiné à la main d'ousmaneballondor.fr (qui n'est pas une police).
  npm pack @fontsource/covered-by-your-grace
  → files/covered-by-your-grace-latin-400-normal.woff2
Pour l'effet "écrit à la main" : 1re lettre agrandie, lettres penchées, ligne de base irrégulière.
(une police variable comme Archivo est réglée sur AXES ci-dessous)

Usage (Newell's) :
  python3 tools/club-name-paths.py chemin/covered-by-your-grace-latin-400-normal.woff2 "NEWELL'S" \
      --first-scale 1.4 --tilt 5 --wobble 7 --seed 21
  → 1re ligne : le viewBox ; ensuite les <path>, à mettre dans
    <svg class="club-name" … data-club-name>
"""
import argparse
import io
import math
import random
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

AXES = {"wght": 900, "wdth": 75}  # seulement pour une police variable (Archivo)
SIZE = 180  # corps de référence (unités du viewBox) ; la taille réelle est fixée en CSS


def main(font_path, text, first_scale=1.0, tilt=0.0, wobble=0.0, seed=10):
    font = TTFont(font_path)
    variable = "fvar" in font
    inst = instancer.instantiateVariableFont(font, AXES) if variable else font
    upem = inst["head"].unitsPerEm
    glyphs = inst.getGlyphSet()

    # mise en forme (crénage) avec HarfBuzz, sur la police variable aux mêmes axes
    # (HarfBuzz ne lit pas le woff2 : on lui passe la police décompressée en TTF)
    raw = TTFont(font_path)
    raw.flavor = None
    data = io.BytesIO()
    raw.save(data)
    hbfont = hb.Font(hb.Face(data.getvalue()))
    if variable:
        hbfont.set_variations(AXES)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": False})

    order = inst.getGlyphOrder()
    scale = SIZE / upem
    rnd = random.Random(seed)  # même "écriture" à chaque génération
    x = 0.0
    out, bounds = [], [None] * 4
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = order[info.codepoint]
        k = first_scale if i == 0 else 1.0          # 1re lettre agrandie (lettrage à la main)
        a = math.radians(rnd.uniform(-tilt, tilt))  # lettre légèrement penchée
        dy = rnd.uniform(-wobble, wobble)           # ligne de base irrégulière
        w = pos.x_advance * scale * k
        ox = x + pos.x_offset * scale * k
        oy = -pos.y_offset * scale + dy  # ligne de base à y = 0
        # unités de police (y vers le haut) → SVG (y vers le bas), rotation autour
        # du pied de la lettre : M = T(ox + w/2, oy) · R(a) · T(-w/2, 0) · S(k·scale, -k·scale)
        c, sn = math.cos(a), math.sin(a)
        sx = k * scale
        t = (c * sx, sn * sx, sn * sx, -c * sx,
             ox + w / 2 - c * w / 2, oy - sn * w / 2)
        pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        glyphs[name].draw(TransformPen(pen, t))
        bp = BoundsPen(glyphs)
        glyphs[name].draw(TransformPen(bp, t))
        if bp.bounds:
            for i, (v, f) in enumerate(zip(bp.bounds, (min, min, max, max))):
                bounds[i] = v if bounds[i] is None else f(bounds[i], v)
            out.append(f'<path d="{pen.getCommands()}" />')
        x += w

    # viewBox ajusté au nom (+ marge pour l'épaisseur du trait)
    m = 6
    x0, y0, x1, y1 = bounds
    print(f'viewBox="{x0 - m:.0f} {y0 - m:.0f} {x1 - x0 + 2 * m:.0f} {y1 - y0 + 2 * m:.0f}"')
    print("\n".join(out))

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("font")
    ap.add_argument("text")
    ap.add_argument("--first-scale", type=float, default=1.0, help="taille de la 1re lettre (ex. 1.35)")
    ap.add_argument("--tilt", type=float, default=0.0, help="inclinaison aléatoire max par lettre, en degrés")
    ap.add_argument("--wobble", type=float, default=0.0, help="décalage aléatoire max de la ligne de base")
    ap.add_argument("--seed", type=int, default=10, help="graine : change le tirage des inclinaisons")
    o = ap.parse_args()
    main(o.font, o.text, o.first_scale, o.tilt, o.wobble, o.seed)
