"""Convert a (subset) woff2 into three.js typeface JSON (the FontLoader format).
three's Font.js reads glyph.o as space-separated commands:
  m x y | l x y | q endX endY ctrlX ctrlY | b endX endY c1X c1Y c2X c2Y

v21.30: the output is a Modified Version of the font under the SIL OFL 1.1, which forbids a
modified font to use the Reserved Font Name ("Plex" for IBM Plex). So "IBM Plex ..." becomes
"DAB Render ..." in the family name, and the outputs are named dab-render-*.typeface.json:
  python3 scripts/woff2_to_typeface.py ../../frontend/public/fonts/plex-mono-500.woff2 assets/dab-render-mono-500.typeface.json
assets/OFL.txt (written by `npm run licenses` at the repo root) carries the licence.
"""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

class OPen(BasePen):
    def __init__(self, gs):
        super().__init__(gs); self.cmds = []
    def _moveTo(self, p): self.cmds += ['m', p[0], p[1]]
    def _lineTo(self, p): self.cmds += ['l', p[0], p[1]]
    def _qCurveToOne(self, c, p): self.cmds += ['q', p[0], p[1], c[0], c[1]]
    def _curveToOne(self, c1, c2, p): self.cmds += ['b', p[0], p[1], c1[0], c1[1], c2[0], c2[1]]
    def _closePath(self): pass
    def _endPath(self): pass

def fmt(v): return str(round(v, 2)).rstrip('0').rstrip('.') if isinstance(v, float) else str(v)

src, dst = sys.argv[1], sys.argv[2]
f = TTFont(src); gs = f.getGlyphSet(); cmap = f.getBestCmap(); hmtx = f['hmtx']
head = f['head']; post = f['post']; name = f['name'].getDebugName(1).replace('IBM Plex', 'DAB Render')
assert 'plex' not in name.lower(), f'reserved font name left in {name!r}'
glyphs = {}
for cp, gname in cmap.items():
    if cp > 0xFFFF: continue
    pen = OPen(gs); gs[gname].draw(pen)
    xs = [c for i, c in enumerate(pen.cmds)]
    nums = [v for v in pen.cmds if not isinstance(v, str)]
    xvals = nums[0::2] if nums else [0]
    glyphs[chr(cp)] = {
        'ha': hmtx[gname][0], 'x_min': min(xvals), 'x_max': max(xvals),
        'o': ' '.join(fmt(v) if not isinstance(v, str) else v for v in pen.cmds),
    }
out = {
    'glyphs': glyphs, 'familyName': name, 'ascender': f['hhea'].ascent, 'descender': f['hhea'].descent,
    'underlinePosition': post.underlinePosition, 'underlineThickness': post.underlineThickness,
    'boundingBox': {'yMin': head.yMin, 'xMin': head.xMin, 'yMax': head.yMax, 'xMax': head.xMax},
    'resolution': head.unitsPerEm,
    # IBM Plex is SIL OFL 1.1: carry the copyright and licence with the redistributed outline data
    'original_font_information': {'format': 0, 'fontFamily': name, 'copyright': f['name'].getDebugName(0), 'license_url': f['name'].getDebugName(14),
                                  'license': 'SIL Open Font License 1.1. Modified Version: renamed, the original family name is reserved. See OFL.txt'},
}
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print(dst, len(glyphs), 'glyphs, upm', head.unitsPerEm)
