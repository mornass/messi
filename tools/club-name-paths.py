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

Police des noms de club : Kaushan Script (pinceau, licence OFL)
  npm pack @fontsource/kaushan-script → files/kaushan-script-latin-400-normal.woff2
  (une police variable comme Archivo est réglée sur AXES ci-dessous)

Usage :
  python3 tools/club-name-paths.py chemin/kaushan-script-latin-400-normal.woff2 "Newell's"
  → 1re ligne : le viewBox ; ensuite les <path>, à mettre dans
    <svg class="club-name" … data-club-name>
"""
import io
import sys
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

AXES = {"wght": 900, "wdth": 75}  # seulement pour une police variable (Archivo)
SIZE = 180  # corps de référence (unités du viewBox) ; la taille réelle est fixée en CSS


def main(font_path, text):
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
    x = 0.0
    out, bounds = [], [None] * 4
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        ox = x + pos.x_offset * scale
        oy = -pos.y_offset * scale  # ligne de base à y = 0
        # unités de police (y vers le haut) → SVG (y vers le bas)
        t = (scale, 0, 0, -scale, ox, oy)
        pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        glyphs[name].draw(TransformPen(pen, t))
        bp = BoundsPen(glyphs)
        glyphs[name].draw(TransformPen(bp, t))
        if bp.bounds:
            for i, (v, f) in enumerate(zip(bp.bounds, (min, min, max, max))):
                bounds[i] = v if bounds[i] is None else f(bounds[i], v)
            out.append(f'<path d="{pen.getCommands()}" />')
        x += pos.x_advance * scale

    # viewBox ajusté au nom (+ marge pour l'épaisseur du trait)
    m = 6
    x0, y0, x1, y1 = bounds
    print(f'viewBox="{x0 - m:.0f} {y0 - m:.0f} {x1 - x0 + 2 * m:.0f} {y1 - y0 + 2 * m:.0f}"')
    print("\n".join(out))

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
