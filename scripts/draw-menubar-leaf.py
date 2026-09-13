#!/usr/bin/env python3
"""Draw a fine line-art leaf for the menu bar (template: black on clear)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app/Resources/MenuBarLeaf.png"

# 18pt @3x working size, then downscale for clean strokes.
PT = 18
SCALE = 8
CANVAS = PT * SCALE  # 144


def cubic(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x * SCALE, y * SCALE))
    return pts


def main() -> None:
    im = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    stroke = max(2, round(1.0 * SCALE))
    ink = (0, 0, 0, 255)

    # 18pt canvas, glyph ~12pt tall so it matches neighboring status items.
    tip = (9.0, 3.6)
    stem = (9.0, 14.4)
    left_ctrl_a = (5.6, 5.4)
    left_ctrl_b = (5.3, 10.4)
    right_ctrl_a = (12.7, 10.4)
    right_ctrl_b = (12.4, 5.4)

    outline = (
        cubic(tip, left_ctrl_a, left_ctrl_b, stem)
        + cubic(stem, right_ctrl_a, right_ctrl_b, tip)[1:]
    )
    draw.line(outline, fill=ink, width=stroke, joint="curve")
    cap = stroke / 2
    for x, y in (tip, stem):
        draw.ellipse(
            (x * SCALE - cap, y * SCALE - cap, x * SCALE + cap, y * SCALE + cap),
            fill=ink,
        )

    rib_w = max(2, stroke - 1)
    draw.line(
        [(9.0 * SCALE, 13.4 * SCALE), (9.0 * SCALE, 4.8 * SCALE)],
        fill=ink,
        width=rib_w,
    )

    # Two pairs of veins, angled toward the tip — not a grid.
    vein_w = max(2, stroke - 1)
    veins = [
        ((9.0, 7.4), (7.7, 6.4), (6.6, 6.2)),
        ((9.0, 7.4), (10.3, 6.4), (11.4, 6.2)),
        ((9.0, 10.6), (7.5, 9.6), (6.5, 9.5)),
        ((9.0, 10.6), (10.5, 9.6), (11.5, 9.5)),
    ]
    for a, b, c in veins:
        draw.line(cubic(a, b, b, c, n=18), fill=ink, width=vein_w, joint="curve")

    out = im.resize((PT * 2, PT * 2), Image.Resampling.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, "PNG")
    print(f"wrote {OUT} {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    main()
