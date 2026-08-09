#!/usr/bin/env python3
"""Compose Teams backgrounds (1920x1080) + LinkedIn banners (1584x396) from SoT logos."""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

GOLD = (178, 163, 132, 255)
NAVY = (59, 69, 89, 255)
NAVY_DEEP = (36, 42, 55, 255)
WHITE = (255, 255, 255, 255)
CREAM = (247, 245, 240, 255)

REPO = Path(__file__).resolve().parents[2]
BRAND = REPO / "public" / "brand"
SOT_TEAMS = REPO / "brand" / "marketing-sot" / "teams-backgrounds"
SOT_LI = REPO / "brand" / "marketing-sot" / "linkedin-banners"
DL = Path.home() / "Downloads" / "Brand Collateral"
DL_TEAMS = DL / "Teams Backgrounds"
DL_LI = DL / "LinkedIn Banners"

LOGOS = {
    "ENT-FIRM": BRAND / "ENT-FIRM" / "tagevc-logo-gold-white-on-navy-rectangle.png",
    "ENT-FIRM_LIGHT": BRAND / "ENT-FIRM" / "tagevc-logo-gold-blue-on-white-rectangle.png",
    "ENT-R619": BRAND / "ENT-R619" / "recruit619-logo-gold-on-navy-rectangle.png",
    "ENT-R619_LIGHT": BRAND / "ENT-R619" / "recruit619-logo-gold-on-white-rectangle.png",
    "ENT-SIGNENT": BRAND / "ENT-SIGNENT" / "signent-hr-logo-gold-on-navy-rectangle.png",
    "ENT-SIGNENT_LIGHT": BRAND / "ENT-SIGNENT" / "signent-hr-logo-gold-on-white-rectangle.png",
    "ENT-INDA": BRAND / "ENT-INDA" / "instantnda-logo-horizontal-outlined.png",
    "ENT-INDA_LIGHT": BRAND / "ENT-INDA" / "instantnda-logo-horizontal.png",
}


def load_logo(key: str) -> Image.Image:
    path = LOGOS[key]
    im = Image.open(path).convert("RGBA")
    return im


def fit_height(im: Image.Image, height: int, max_w: int | None = None) -> Image.Image:
    w, h = im.size
    scale = height / h
    nw, nh = int(w * scale), height
    if max_w and nw > max_w:
        scale = max_w / w
        nw, nh = max_w, int(h * scale)
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    w, h = size
    base = Image.new("RGBA", size, bottom)
    top_im = Image.new("RGBA", size, top)
    mask = Image.linear_gradient("L").resize((1, h)).resize((w, h))
    return Image.composite(top_im, base, mask)


def soft_blob(draw_size, center, radius, color, blur=40):
    layer = Image.new("RGBA", draw_size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = center
    d.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
    return layer.filter(ImageFilter.GaussianBlur(blur))


def try_font(size: int):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


def save_both(im: Image.Image, name: str, sot_dir: Path, dl_dir: Path):
    sot_dir.mkdir(parents=True, exist_ok=True)
    dl_dir.mkdir(parents=True, exist_ok=True)
    sot_path = sot_dir / name
    dl_path = dl_dir / name
    rgb = im.convert("RGB")
    rgb.save(sot_path, "PNG", optimize=True)
    rgb.save(dl_path, "PNG", optimize=True)
    print("wrote", sot_path)
    print("wrote", dl_path)


def teams_firm():
    size = (1920, 1080)
    canvas = gradient(size, NAVY_DEEP, NAVY)
    # subtle gold wash lower-right
    canvas = Image.alpha_composite(
        canvas, soft_blob(size, (1500, 900), 420, (*GOLD[:3], 55), blur=90)
    )
    canvas = Image.alpha_composite(
        canvas, soft_blob(size, (280, 180), 280, (*GOLD[:3], 35), blur=70)
    )
    draw = ImageDraw.Draw(canvas)
    # left accent
    draw.rectangle((0, 0, 12, 1080), fill=GOLD)

    primary = fit_height(load_logo("ENT-FIRM"), 170, max_w=520)
    px = 120
    py = 280
    canvas.alpha_composite(primary, (px, py))

    draw.text((px, py + primary.size[1] + 28), "A portfolio of operating companies", font=try_font(28), fill=GOLD)

    # subsidiary strip on light band for wordmark readability
    strip_y = 700
    draw.text((px, strip_y - 48), "OUR COMPANIES", font=try_font(18), fill=GOLD)
    band = Image.new("RGBA", size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.rounded_rectangle((px - 24, strip_y - 16, 1860, strip_y + 130), radius=12, fill=(*CREAM[:3], 235))
    canvas = Image.alpha_composite(canvas, band)
    draw = ImageDraw.Draw(canvas)

    subs = [
        "ENT-R619_LIGHT",
        "ENT-SIGNENT_LIGHT",
        "ENT-INDA_LIGHT",
    ]
    x = px
    for key in subs:
        logo = fit_height(load_logo(key), 88, max_w=300)
        canvas.alpha_composite(logo, (x, strip_y + 12))
        x += logo.size[0] + 48

    save_both(canvas, "ENT-FIRM-tage-vc-teams-background.png", SOT_TEAMS / "ENT-FIRM", DL_TEAMS / "ENT-FIRM")


def teams_entity(entity_id: str, logo_key: str, tagline: str, outfile: str):
    size = (1920, 1080)
    canvas = gradient(size, NAVY_DEEP, NAVY)
    canvas = Image.alpha_composite(
        canvas, soft_blob(size, (1600, 200), 380, (*GOLD[:3], 45), blur=85)
    )
    canvas = Image.alpha_composite(
        canvas, soft_blob(size, (400, 900), 350, (*GOLD[:3], 30), blur=80)
    )
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 12, 1080), fill=GOLD)
    # bottom gold hairline
    draw.rectangle((0, 1068, 1920, 1080), fill=GOLD)

    logo = fit_height(load_logo(logo_key), 190, max_w=640)
    lx = (1920 - logo.size[0]) // 2
    ly = 380
    canvas.alpha_composite(logo, (lx, ly))
    # tagline centered-ish
    font = try_font(26)
    bbox = draw.textbbox((0, 0), tagline, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((1920 - tw) // 2, ly + logo.size[1] + 36), tagline, font=font, fill=GOLD)

    save_both(canvas, outfile, SOT_TEAMS / entity_id, DL_TEAMS / entity_id)


def linkedin_firm():
    size = (1584, 396)
    canvas = gradient(size, NAVY_DEEP, NAVY)
    canvas = Image.alpha_composite(
        canvas, soft_blob(size, (1300, 200), 260, (*GOLD[:3], 50), blur=60)
    )
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 1584, 6), fill=GOLD)
    draw.rectangle((0, 390, 1584, 396), fill=GOLD)

    primary = fit_height(load_logo("ENT-FIRM"), 110, max_w=360)
    canvas.alpha_composite(primary, (72, 90))
    draw.text((72, 230), "Portfolio family", font=try_font(20), fill=GOLD)

    # Light chip behind sister marks
    chip = Image.new("RGBA", size, (0, 0, 0, 0))
    cd = ImageDraw.Draw(chip)
    cd.rounded_rectangle((500, 132, 1520, 268), radius=10, fill=(*CREAM[:3], 235))
    canvas = Image.alpha_composite(canvas, chip)

    x = 528
    for key in ("ENT-R619_LIGHT", "ENT-SIGNENT_LIGHT", "ENT-INDA_LIGHT"):
        logo = fit_height(load_logo(key), 72, max_w=240)
        canvas.alpha_composite(logo, (x, 164))
        x += logo.size[0] + 28

    save_both(canvas, "ENT-FIRM-tage-vc-linkedin-banner.png", SOT_LI / "ENT-FIRM", DL_LI / "ENT-FIRM")


def linkedin_entity(entity_id: str, logo_key: str, outfile: str, accent_right: bool = True):
    size = (1584, 396)
    canvas = gradient(size, NAVY_DEEP, NAVY)
    canvas = Image.alpha_composite(
        canvas, soft_blob(size, (1350, 180), 240, (*GOLD[:3], 48), blur=55)
    )
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 1584, 6), fill=GOLD)
    draw.rectangle((0, 390, 1584, 396), fill=GOLD)
    if accent_right:
        draw.rectangle((1572, 0, 1584, 396), fill=GOLD)

    logo = fit_height(load_logo(logo_key), 120, max_w=420)
    lx = 96
    ly = (396 - logo.size[1]) // 2
    canvas.alpha_composite(logo, (lx, ly))

    # small parent mark bottom-right for subsidiaries
    if entity_id != "ENT-FIRM":
        parent = fit_height(load_logo("ENT-FIRM"), 36, max_w=120)
        canvas.alpha_composite(parent, (1584 - parent.size[0] - 48, 396 - parent.size[1] - 28))

    save_both(canvas, outfile, SOT_LI / entity_id, DL_LI / entity_id)


def main():
    for d in (SOT_TEAMS, SOT_LI, DL_TEAMS, DL_LI):
        d.mkdir(parents=True, exist_ok=True)

    teams_firm()
    teams_entity("ENT-R619", "ENT-R619", "Recruiting that builds companies", "ENT-R619-recruit-619-teams-background.png")
    teams_entity("ENT-SIGNENT", "ENT-SIGNENT", "HR operations with clarity", "ENT-SIGNENT-signent-hr-teams-background.png")
    teams_entity("ENT-INDA", "ENT-INDA", "NDAs without the wait", "ENT-INDA-instant-nda-teams-background.png")

    linkedin_firm()
    linkedin_entity("ENT-R619", "ENT-R619", "ENT-R619-recruit-619-linkedin-banner.png")
    linkedin_entity("ENT-SIGNENT", "ENT-SIGNENT", "ENT-SIGNENT-signent-hr-linkedin-banner.png")
    linkedin_entity("ENT-INDA", "ENT-INDA", "ENT-INDA-instant-nda-linkedin-banner.png")

    print("done")


if __name__ == "__main__":
    main()
