import { PDFDocument } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

const TICKET_HEIGHT_MM = 45;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 5;
const GAP_MM = 2;
const PAIR_GAP_MM = 0;
const DPI = 300;
const PT_PER_MM = 72 / 25.4;
const RENDER_SCALE = 2;
const FONT_HEIGHT_RATIO = 0.22;
const STROKE_RATIO = 0.045;
const MARGIN_X_RATIO = 36 / 863;
const MARGIN_Y_RATIO = 28 / 578;
const FONT_URL = "assets/Impact.ttf";
const FONT_FAMILY = "RaffleImpact";

const mmToPt = (mm) => mm * PT_PER_MM;
const mmToPx = (mm) => Math.round((mm / 25.4) * DPI);
const padWidth = (end) => Math.max(1, String(end).length);
const formatNumber = (value, width) => String(value).padStart(width, "0");

let fontReady = null;

const ensureFont = () => {
  if (fontReady) return fontReady;
  fontReady = new FontFace(FONT_FAMILY, `url(${FONT_URL})`)
    .load()
    .then((font) => {
      document.fonts.add(font);
      return FONT_FAMILY;
    });
  return fontReady;
};

const loadImage = (source) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load a background image."));
    image.src = source;
  });

const colorsForCanvas = (canvas) => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const width = canvas.width;
  const height = canvas.height;
  const sample = context.getImageData(
    Math.floor(width * 0.62),
    Math.floor(height * 0.62),
    Math.max(1, width - Math.floor(width * 0.62)),
    Math.max(1, height - Math.floor(height * 0.62))
  );
  const data = sample.data;
  let total = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    total += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    count += 1;
  }
  const avg = count ? total / count : 255;
  if (avg >= 140) {
    return { fill: "#000000", stroke: "#ffffff" };
  }
  return { fill: "#ffffff", stroke: "#141414" };
};

const layoutGrid = (halfAspect) => {
  const halfH = TICKET_HEIGHT_MM;
  const halfW = halfH * halfAspect;
  const pairW = halfW * 2 + PAIR_GAP_MM;
  const pairH = halfH;
  const usableW = PAGE_WIDTH_MM - 2 * MARGIN_MM;
  const usableH = PAGE_HEIGHT_MM - 2 * MARGIN_MM;
  const cols = Math.max(1, Math.floor((usableW + GAP_MM) / (pairW + GAP_MM)));
  const rows = Math.max(1, Math.floor((usableH + GAP_MM) / (pairH + GAP_MM)));
  const gridW = cols * pairW + (cols - 1) * GAP_MM;
  const gridH = rows * pairH + (rows - 1) * GAP_MM;

  return {
    cols,
    rows,
    perPage: cols * rows,
    halfW,
    halfH,
    pairW,
    pairH,
    originX: (PAGE_WIDTH_MM - gridW) / 2,
    originY: (PAGE_HEIGHT_MM - gridH) / 2,
  };
};

const pairRectsMm = (layout, indexOnPage) => {
  const col = indexOnPage % layout.cols;
  const row = Math.floor(indexOnPage / layout.cols);
  const x0 = layout.originX + col * (layout.pairW + GAP_MM);
  const y0 = layout.originY + row * (layout.pairH + GAP_MM);
  const left = { x0, y0, x1: x0 + layout.halfW, y1: y0 + layout.halfH };
  const rightX0 = x0 + layout.halfW + PAIR_GAP_MM;
  const right = {
    x0: rightX0,
    y0,
    x1: rightX0 + layout.halfW,
    y1: y0 + layout.halfH,
  };
  return { left, right };
};

const drawNumber = (context, text, fontSize, colors) => {
  const strokeWidth = Math.max(2, Math.round(fontSize * STROKE_RATIO));
  context.font = `bold ${fontSize}px ${FONT_FAMILY}, Impact, sans-serif`;
  context.textBaseline = "alphabetic";
  const metrics = context.measureText(text);
  const textW = metrics.width;
  const textH =
    (metrics.actualBoundingBoxAscent || fontSize * 0.8) +
    (metrics.actualBoundingBoxDescent || fontSize * 0.2);
  const marginX = Math.max(8, Math.round(context.canvas.width * MARGIN_X_RATIO));
  const marginY = Math.max(8, Math.round(context.canvas.height * MARGIN_Y_RATIO));
  const x = context.canvas.width - textW - marginX;
  const y = context.canvas.height - marginY - (metrics.actualBoundingBoxDescent || 0);

  context.lineJoin = "round";
  context.lineWidth = strokeWidth;
  context.strokeStyle = colors.stroke;
  context.fillStyle = colors.fill;
  context.strokeText(text, x, y);
  context.fillText(text, x, y);
  return textH;
};

const renderTicketCanvas = (sourceImage, label, canvasSize, colors) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  const ink = colors || colorsForCanvas(canvas);
  const fontSize = Math.max(48, Math.round(canvas.height * FONT_HEIGHT_RATIO));
  drawNumber(context, label, fontSize, ink);
  return canvas;
};

const canvasToPngBytes = (canvas) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode a ticket image."));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer))).catch(reject);
    }, "image/png");
  });

const embedTicket = async (pdf, page, pngBytes, rectMm) => {
  const image = await pdf.embedPng(pngBytes);
  page.drawImage(image, {
    x: mmToPt(rectMm.x0),
    y: mmToPt(PAGE_HEIGHT_MM - rectMm.y1),
    width: mmToPt(rectMm.x1 - rectMm.x0),
    height: mmToPt(rectMm.y1 - rectMm.y0),
  });
};

export const generateRaffleZip = async ({
  start,
  end,
  leftSource,
  rightSource,
  onProgress,
}) => {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
    throw new Error("Enter a valid ticket range.");
  }
  if (end - start > 5000) {
    throw new Error("Maximum range is 5000 tickets.");
  }

  await ensureFont();
  const leftImage = await loadImage(leftSource);
  const rightImage = await loadImage(rightSource);
  const aspect = leftImage.naturalWidth / leftImage.naturalHeight || 863 / 578;
  const layout = layoutGrid(aspect);
  const halfHpx = mmToPx(TICKET_HEIGHT_MM);
  const halfWpx = Math.round(halfHpx * aspect);
  const canvasSize = {
    width: halfWpx * RENDER_SCALE,
    height: halfHpx * RENDER_SCALE,
  };

  const probeLeft = renderTicketCanvas(leftImage, "0", canvasSize);
  const probeRight = renderTicketCanvas(rightImage, "0", canvasSize);
  const leftColors = colorsForCanvas(probeLeft);
  const rightColors = colorsForCanvas(probeRight);

  const pdf = await PDFDocument.create();
  const widthDigits = padWidth(end);
  const total = end - start + 1;
  let slot = layout.perPage;
  let page = null;
  let pageCount = 0;
  let firstPagePreviewUrl = null;

  for (let number = start, index = 0; number <= end; number += 1, index += 1) {
    if (slot >= layout.perPage) {
      page = pdf.addPage([mmToPt(PAGE_WIDTH_MM), mmToPt(PAGE_HEIGHT_MM)]);
      slot = 0;
      pageCount += 1;
    }

    const label = formatNumber(number, widthDigits);
    const leftCanvas = renderTicketCanvas(leftImage, label, canvasSize, leftColors);
    const rightCanvas = renderTicketCanvas(rightImage, label, canvasSize, rightColors);
    const leftBytes = await canvasToPngBytes(leftCanvas);
    const rightBytes = await canvasToPngBytes(rightCanvas);
    const rects = pairRectsMm(layout, slot);

    await embedTicket(pdf, page, leftBytes, rects.left);
    await embedTicket(pdf, page, rightBytes, rects.right);

    if (!firstPagePreviewUrl && pageCount === 1) {
      // Build a simple preview from the first pair row later via page raster is heavy;
      // use composed left+right strip for UI preview instead.
      const preview = document.createElement("canvas");
      preview.width = leftCanvas.width + rightCanvas.width;
      preview.height = leftCanvas.height;
      const previewCtx = preview.getContext("2d");
      previewCtx.drawImage(leftCanvas, 0, 0);
      previewCtx.drawImage(rightCanvas, leftCanvas.width, 0);
      firstPagePreviewUrl = preview.toDataURL("image/jpeg", 0.85);
    }

    slot += 1;
    if (onProgress) {
      onProgress(index + 1, total);
    }
  }

  const pdfBytes = await pdf.save();
  const zip = new JSZip();
  const pdfName = `raffle-tickets-${start}-${end}.pdf`;
  zip.file(pdfName, pdfBytes);
  const zipBlob = await zip.generateAsync({ type: "blob" });

  return {
    zipBlob,
    pdfName,
    count: total,
    pages: pageCount,
    perPage: layout.perPage,
    cols: layout.cols,
    rows: layout.rows,
    ticketHeightCm: TICKET_HEIGHT_MM / 10,
    ticketWidthCm: Number((layout.halfW / 10).toFixed(2)),
    previewUrl: firstPagePreviewUrl,
  };
};
