#!/usr/bin/env python3
"""Render numbered raffle ticket pairs onto A4 PDF sheets at exactly 4.5 cm tall."""

import io
import json
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BG_LEFT_PATH = ROOT / "assets" / "ticket-bg-white.png"
BG_RIGHT_PATH = ROOT / "assets" / "ticket-bg-white.png"
FONT_PATH = ROOT / "assets" / "Impact.ttf"

# Physical print layout (mm). Each half-ticket is 4.5 cm tall.
TICKET_HEIGHT_MM = 45.0
PAGE_WIDTH_MM = 210.0
PAGE_HEIGHT_MM = 297.0
MARGIN_MM = 5.0
GAP_MM = 2.0
PAIR_GAP_MM = 0.0
DPI = 300
PT_PER_MM = 72.0 / 25.4

# Ticket art / number styling
RENDER_SCALE = 2
MARGIN_X = 36
MARGIN_Y = 28
FONT_HEIGHT_RATIO = 0.22
STROKE_RATIO = 0.045


def mm_to_pt(mm):
    return mm * PT_PER_MM


def mm_to_px(mm, dpi=DPI):
    return int(round(mm / 25.4 * dpi))


def pad_width(end):
    return max(1, len(str(end)))


def format_number(value, width):
    return str(value).zfill(width)


def load_font(size):
    return ImageFont.truetype(str(FONT_PATH), size=size)


def colors_for_background(image):
    """Pick black or white number ink from bottom-right corner brightness."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    sample = rgb.crop(
        (
            int(width * 0.62),
            int(height * 0.62),
            width,
            height,
        )
    )
    pixels = list(sample.getdata())
    if not pixels:
        return (0, 0, 0, 255), (255, 255, 255, 255)

    avg = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in pixels) / len(pixels)
    if avg >= 140:
        return (0, 0, 0, 255), (255, 255, 255, 255)
    return (255, 255, 255, 255), (20, 20, 20, 255)


def draw_number(
    image,
    text,
    font,
    font_size,
    fill=(0, 0, 0, 255),
    stroke=(255, 255, 255, 255),
):
    draw = ImageDraw.Draw(image)
    stroke_width = max(2, int(font_size * STROKE_RATIO))
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    margin_x = max(8, int(image.width * (MARGIN_X / 863)))
    margin_y = max(8, int(image.height * (MARGIN_Y / 578)))
    x = image.width - text_w - margin_x - bbox[0]
    y = image.height - text_h - margin_y - bbox[1]
    draw.text(
        (x, y),
        text,
        font=font,
        fill=tuple(fill),
        stroke_width=stroke_width,
        stroke_fill=tuple(stroke),
    )


def build_ticket_base(path):
    return Image.open(path).convert("RGBA")


def normalize_ticket_base(image, size):
    return image.resize(size, Image.Resampling.LANCZOS)


def render_ticket_png_bytes(base, label, font, font_size, print_size, fill, stroke):
    ticket = base.copy()
    draw_number(ticket, label, font, font_size, fill=fill, stroke=stroke)
    rgb = ticket.convert("RGB").resize(print_size, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    rgb.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def layout_grid(half_aspect):
    half_h = TICKET_HEIGHT_MM
    half_w = half_h * half_aspect
    pair_w = half_w * 2 + PAIR_GAP_MM
    pair_h = half_h

    usable_w = PAGE_WIDTH_MM - 2 * MARGIN_MM
    usable_h = PAGE_HEIGHT_MM - 2 * MARGIN_MM
    cols = max(1, int((usable_w + GAP_MM) // (pair_w + GAP_MM)))
    rows = max(1, int((usable_h + GAP_MM) // (pair_h + GAP_MM)))

    grid_w = cols * pair_w + (cols - 1) * GAP_MM
    grid_h = rows * pair_h + (rows - 1) * GAP_MM
    origin_x = (PAGE_WIDTH_MM - grid_w) / 2
    origin_y = (PAGE_HEIGHT_MM - grid_h) / 2

    return {
        "cols": cols,
        "rows": rows,
        "per_page": cols * rows,
        "half_w": half_w,
        "half_h": half_h,
        "pair_w": pair_w,
        "pair_h": pair_h,
        "origin_x": origin_x,
        "origin_y": origin_y,
    }


def pair_origin_mm(layout, index_on_page):
    col = index_on_page % layout["cols"]
    row = index_on_page // layout["cols"]
    x0 = layout["origin_x"] + col * (layout["pair_w"] + GAP_MM)
    y0 = layout["origin_y"] + row * (layout["pair_h"] + GAP_MM)
    return x0, y0


def pair_rects_mm(layout, index_on_page):
    x0, y0 = pair_origin_mm(layout, index_on_page)
    left = (x0, y0, x0 + layout["half_w"], y0 + layout["half_h"])
    right_x0 = x0 + layout["half_w"] + PAIR_GAP_MM
    right = (right_x0, y0, right_x0 + layout["half_w"], y0 + layout["half_h"])
    return left, right


def mm_rect_to_fitz(x0, y0, x1, y1):
    return fitz.Rect(mm_to_pt(x0), mm_to_pt(y0), mm_to_pt(x1), mm_to_pt(y1))


def write_pdf(pairs, layout, pdf_path):
    doc = fitz.open()
    page = None
    slot = 0
    page_count = 0

    for left_png, right_png in pairs:
        if page is None or slot >= layout["per_page"]:
            page = doc.new_page(
                width=mm_to_pt(PAGE_WIDTH_MM),
                height=mm_to_pt(PAGE_HEIGHT_MM),
            )
            slot = 0
            page_count += 1

        left_rect, right_rect = pair_rects_mm(layout, slot)
        page.insert_image(
            mm_rect_to_fitz(*left_rect),
            stream=left_png,
            keep_proportion=False,
        )
        page.insert_image(
            mm_rect_to_fitz(*right_rect),
            stream=right_png,
            keep_proportion=False,
        )
        slot += 1

    doc.save(pdf_path)
    doc.close()
    return page_count


def write_preview(pdf_path, preview_path):
    doc = fitz.open(pdf_path)
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72), alpha=False)
    pix.save(preview_path)
    doc.close()


def generate_tickets(
    start,
    end,
    output_dir,
    left_bg=None,
    right_bg=None,
):
    if start > end:
        raise ValueError("start must be less than or equal to end")
    if end - start > 5000:
        raise ValueError("range too large (max 5000 tickets)")

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    left_path = Path(left_bg) if left_bg else BG_LEFT_PATH
    right_path = Path(right_bg) if right_bg else BG_RIGHT_PATH

    left_raw = build_ticket_base(left_path)
    right_raw = build_ticket_base(right_path)

    # Shared canvas so both halves get identical printed number size.
    aspect = left_raw.width / left_raw.height
    layout = layout_grid(aspect)
    half_h_px = mm_to_px(TICKET_HEIGHT_MM)
    half_w_px = int(round(half_h_px * aspect))
    print_size = (half_w_px, half_h_px)
    canvas_size = (half_w_px * RENDER_SCALE, half_h_px * RENDER_SCALE)

    left_base = normalize_ticket_base(left_raw, canvas_size)
    right_base = normalize_ticket_base(right_raw, canvas_size)
    left_fill, left_stroke = colors_for_background(left_base)
    right_fill, right_stroke = colors_for_background(right_base)

    font_size = max(48, int(canvas_size[1] * FONT_HEIGHT_RATIO))
    font = load_font(font_size)
    width_digits = pad_width(end)

    pairs = []
    for number in range(start, end + 1):
        label = format_number(number, width_digits)
        left_png = render_ticket_png_bytes(
            left_base, label, font, font_size, print_size, left_fill, left_stroke
        )
        right_png = render_ticket_png_bytes(
            right_base, label, font, font_size, print_size, right_fill, right_stroke
        )
        pairs.append((left_png, right_png))

    pdf_name = f"raffle-tickets-{start}-{end}.pdf"
    pdf_path = output_dir / pdf_name
    page_count = write_pdf(pairs, layout, pdf_path)

    preview_name = "preview-page-1.png"
    write_preview(pdf_path, output_dir / preview_name)

    return {
        "success": True,
        "count": len(pairs),
        "pages": page_count,
        "perPage": layout["per_page"],
        "cols": layout["cols"],
        "rows": layout["rows"],
        "ticketHeightCm": TICKET_HEIGHT_MM / 10.0,
        "ticketWidthCm": round(layout["half_w"] / 10.0, 2),
        "pairWidthCm": round(layout["pair_w"] / 10.0, 2),
        "files": [pdf_name],
        "preview": preview_name,
        "pdf": pdf_name,
    }


def main():
    payload = json.loads(sys.stdin.read())
    result = generate_tickets(
        start=int(payload["start"]),
        end=int(payload["end"]),
        output_dir=payload["outputDir"],
        left_bg=payload.get("leftBg"),
        right_bg=payload.get("rightBg"),
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
