#!/usr/bin/env python3
"""
Generate per-theme sky/scenery alpha masks for the day/night cycle hub
backgrounds, so the animated sky can show through the baked-sky area of
the existing static PNGs while scenery stays opaque (proper occlusion for
the sun/moon, instead of the interim horizontal-gradient mask).

See docs/cycle-sun-moon-occlusion-fix-report.md §5.

Algorithm
---------
1. Downscale the source image for a tractable flood fill (full-res BFS over
   a ~2500x1700 image is too slow for an interactive tool run; the mask is
   feathered on upscale anyway, so sub-pixel precision at source
   resolution isn't the goal).
2. Seed a queue from every pixel in the top ~3% of rows (the sky).
3. 4-connected BFS/flood fill: a candidate pixel joins the "sky" region if
   its colour distance to the *neighbouring already-filled pixel that
   discovered it* (not a fixed global reference) is within `--tolerance`.
   This follows the sky's own gradient (a dusk sky drifts purple -> orange)
   without leaping across the dark ink linework that outlines scenery in
   this art style.
4. Pixels at/under `--protect-luminance` (near-black ink) or green-dominant
   (`--green-seed-margin`; foliage/lichen rock, never sky in this art
   style) are hard barriers throughout growth, not just at the seed step —
   this keeps thin dark scenery (lantern strings, wires) and rock/foliage
   that reaches the very top edge from being eaten by the fill.
5. Morphological close to drop speckle holes/islands, then feather the
   upscaled edge with a Gaussian blur on alpha.
6. Output: <theme>_cycle_mask.png — black RGB, alpha 255 where scenery
   (shown), alpha 0 where sky (hidden) — same pixel dimensions as the
   source, ready for `mask-image: url(...)` at the same `size`/`position`
   as the element's `background-image`. Also writes a side-by-side JPEG
   preview (source | mask | composited result) for manual inspection
   before a mask is accepted into the CSS.

Dependencies: see scripts/requirements-cycle-masks.txt (Pillow, NumPy,
SciPy). Install with:
    pip install -r scripts/requirements-cycle-masks.txt --break-system-packages

Usage:
    python3 scripts/generate-cycle-masks.py \\
        --theme sunset --src public/assets/backgrounds/sunset_bg.png \\
        --out public/assets/backgrounds/sunset_cycle_mask.png \\
        --preview-dir /tmp/cycle-mask-previews

Status (2026-07-19): accepted for `sunset` (clean silhouette, no leaks after
inspection). Rejected for `sunrise` (eats two lanterns near the top-right
after 2 tuning passes) and `login` (leaks into the grey/green cliff rock at
the left edge after 4 tuning passes) — both themes keep the Fix B hard-edge
CSS gradient mask instead; see the `TODO(cycle-masks)` comments in
frontend/src/styles/modules/hub.css. Re-run with different
--tolerance/--protect-luminance/--green-seed-margin values to retry them.
"""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, gaussian_filter

DEFAULT_TOLERANCE = 18.0  # RGB Euclidean distance, 0-441 range
DEFAULT_PROTECT_LUMINANCE = 30.0  # near-black ink is never filled
DEFAULT_WORKING_WIDTH = 640
DEFAULT_CLOSE_PX = 2  # at working resolution
DEFAULT_FEATHER_PX = 2.5  # at full resolution, after upscaling the mask
DEFAULT_GREEN_SEED_MARGIN = 8.0


def flood_fill_sky(
    rgb: np.ndarray,
    tolerance: float,
    protect_luminance: float,
    green_seed_margin: float,
) -> np.ndarray:
    """Adaptive-tolerance 4-connected BFS flood fill seeded from the top rows.
    Returns a boolean array, True = sky (fill succeeded)."""
    h, w, _ = rgb.shape
    luminance = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

    # Green-dominant pixels (G clearly above both R and B) read as
    # foliage/lichen rock, never sky, in this art style. Some scenes have
    # such scenery reaching the very top edge (e.g. the login art's cliff
    # corners), so this is enforced as a hard barrier throughout growth —
    # not just at the seed step — otherwise a hazy/anti-aliased blend
    # pixel at the true sky/rock boundary lets the tolerance walk from a
    # genuine sky seed straight into the rock's own gradual shading.
    r = rgb[..., 0].astype(np.float64)
    g = rgb[..., 1].astype(np.float64)
    b = rgb[..., 2].astype(np.float64)
    green_dominant = (g > r + green_seed_margin) & (g > b + green_seed_margin)
    protected = (luminance <= protect_luminance) | green_dominant

    filled = np.zeros((h, w), dtype=bool)
    seed_rows = max(1, int(h * 0.03))

    q: deque[tuple[int, int]] = deque()
    for y in range(seed_rows):
        for x in range(w):
            if not protected[y, x] and not filled[y, x]:
                filled[y, x] = True
                q.append((y, x))

    rgb64 = rgb.astype(np.float64)
    while q:
        y, x = q.popleft()
        base = rgb64[y, x]
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if ny < 0 or ny >= h or nx < 0 or nx >= w:
                continue
            if filled[ny, nx] or protected[ny, nx]:
                continue
            dist = np.linalg.norm(rgb64[ny, nx] - base)
            if dist <= tolerance:
                filled[ny, nx] = True
                q.append((ny, nx))
    return filled


def generate_mask(
    src_path: Path,
    tolerance: float,
    protect_luminance: float,
    working_width: int,
    close_px: int,
    feather_px: float,
    green_seed_margin: float,
) -> tuple[Image.Image, Image.Image, dict]:
    src = Image.open(src_path).convert("RGB")
    full_w, full_h = src.size

    working_height = max(1, round(working_width * full_h / full_w))
    small = src.resize((working_width, working_height), Image.LANCZOS)
    small_arr = np.asarray(small)

    sky_small = flood_fill_sky(small_arr, tolerance, protect_luminance, green_seed_margin)

    # Morphological close: fill small non-sky islands inside a mostly-sky
    # area (speckle) and small sky islands inside scenery, so the boundary
    # reads as one clean silhouette line rather than a lace pattern.
    if close_px > 0:
        structure = np.ones((close_px * 2 + 1, close_px * 2 + 1), dtype=bool)
        sky_small = binary_closing(sky_small, structure=structure)

    scenery_small = ~sky_small
    alpha_small = (scenery_small.astype(np.float64)) * 255.0

    alpha_small_img = Image.fromarray(alpha_small.astype(np.uint8), mode="L")
    alpha_full_img = alpha_small_img.resize((full_w, full_h), Image.BILINEAR)
    alpha_full = np.asarray(alpha_full_img).astype(np.float64)

    if feather_px > 0:
        alpha_full = gaussian_filter(alpha_full, sigma=feather_px)
    alpha_full = np.clip(alpha_full, 0, 255).astype(np.uint8)

    mask_rgba = np.zeros((full_h, full_w, 4), dtype=np.uint8)
    mask_rgba[..., 3] = alpha_full  # RGB stays black (0,0,0)
    mask_img = Image.fromarray(mask_rgba, mode="RGBA")

    # Composited preview: source with the sky area punched out (checkerboard
    # showing through), so a leak into scenery or an eaten thin feature is
    # obvious at a glance.
    checker = Image.new("RGB", (full_w, full_h))
    checker_arr = np.asarray(checker).copy()
    cell = 24
    yy, xx = np.mgrid[0:full_h, 0:full_w]
    parity = ((yy // cell) + (xx // cell)) % 2
    checker_arr[parity == 0] = (60, 200, 90)
    checker_arr[parity == 1] = (30, 150, 60)
    checker = Image.fromarray(checker_arr)

    src_rgba = src.convert("RGBA")
    composited = Image.composite(src_rgba, checker.convert("RGBA"), Image.fromarray(alpha_full, mode="L"))

    sky_fraction = float(np.mean(alpha_full < 128))
    stats = {
        "sky_fraction": sky_fraction,
        "working_size": (working_width, working_height),
        "full_size": (full_w, full_h),
    }
    return mask_img, composited.convert("RGB"), stats


def make_preview(src_path: Path, mask_img: Image.Image, composited: Image.Image) -> Image.Image:
    src = Image.open(src_path).convert("RGB")
    w, h = src.size
    mask_vis = Image.merge(
        "RGB",
        [mask_img.split()[3], mask_img.split()[3], mask_img.split()[3]],
    )
    strip = Image.new("RGB", (w * 3 + 20, h), (255, 255, 255))
    strip.paste(src, (0, 0))
    strip.paste(mask_vis, (w + 10, 0))
    strip.paste(composited, (w * 2 + 20, 0))
    return strip


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--theme", required=True, help="Theme name, used only for logging/preview filenames")
    parser.add_argument("--src", required=True, type=Path, help="Source static background PNG")
    parser.add_argument("--out", required=True, type=Path, help="Output mask PNG path")
    parser.add_argument("--preview-dir", type=Path, default=None, help="Directory to write an inspection preview JPEG")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--protect-luminance", type=float, default=DEFAULT_PROTECT_LUMINANCE)
    parser.add_argument("--working-width", type=int, default=DEFAULT_WORKING_WIDTH)
    parser.add_argument("--close-px", type=int, default=DEFAULT_CLOSE_PX)
    parser.add_argument("--feather-px", type=float, default=DEFAULT_FEATHER_PX)
    parser.add_argument(
        "--green-seed-margin", type=float, default=DEFAULT_GREEN_SEED_MARGIN,
        help="Treat green-dominant pixels (G > R+margin and G > B+margin) as a hard fill barrier — "
             "keeps foliage/rock that reaches the top edge from being mistaken for sky.",
    )
    args = parser.parse_args()

    mask_img, composited, stats = generate_mask(
        args.src, args.tolerance, args.protect_luminance,
        args.working_width, args.close_px, args.feather_px,
        args.green_seed_margin,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    mask_img.save(args.out)
    print(f"[{args.theme}] wrote {args.out} ({stats['full_size'][0]}x{stats['full_size'][1]}, "
          f"sky_fraction={stats['sky_fraction']:.1%}, tolerance={args.tolerance}, "
          f"protect_luminance={args.protect_luminance})")

    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)
        preview = make_preview(args.src, mask_img, composited)
        preview_path = args.preview_dir / f"{args.theme}_mask_preview.jpg"
        preview.convert("RGB").save(preview_path, quality=88)
        print(f"[{args.theme}] wrote preview {preview_path}")


if __name__ == "__main__":
    main()
