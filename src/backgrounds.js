const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const UPLOADS = path.join(ROOT, "uploads");
const DEFAULT_BG = path.join(ROOT, "assets", "ticket-bg-white.png");
const DEFAULTS = {
  left: DEFAULT_BG,
  right: DEFAULT_BG,
};
const SIDES = ["left", "right"];
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const ensureUploadsDir = () => {
  if (!fs.existsSync(UPLOADS)) {
    fs.mkdirSync(UPLOADS, { recursive: true });
  }
};

const listSideFiles = (side) => {
  ensureUploadsDir();
  return fs
    .readdirSync(UPLOADS)
    .filter((name) => name.startsWith(`${side}.`));
};

const clearSide = (side) => {
  listSideFiles(side).forEach((name) => {
    fs.rmSync(path.join(UPLOADS, name), { force: true });
  });
};

const findCustomPath = (side) => {
  const match = listSideFiles(side)[0];
  return match ? path.join(UPLOADS, match) : null;
};

const resolveBackgrounds = () => {
  const leftCustom = findCustomPath("left");
  const rightCustom = findCustomPath("right");

  return {
    leftPath: leftCustom || DEFAULTS.left,
    rightPath: rightCustom || DEFAULTS.right,
    leftCustom: Boolean(leftCustom),
    rightCustom: Boolean(rightCustom),
    leftUrl: leftCustom
      ? `uploads/${path.basename(leftCustom)}`
      : "assets/ticket-bg-white.png",
    rightUrl: rightCustom
      ? `uploads/${path.basename(rightCustom)}`
      : "assets/ticket-bg-white.png",
  };
};

const extensionFor = (file) => {
  const fromName = path.extname(file.originalname || "").toLowerCase();
  if (ALLOWED_EXT.has(fromName)) {
    return fromName === ".jpeg" ? ".jpg" : fromName;
  }
  if (file.mimetype === "image/png") return ".png";
  if (file.mimetype === "image/jpeg") return ".jpg";
  if (file.mimetype === "image/webp") return ".webp";
  if (file.mimetype === "image/gif") return ".gif";
  return "";
};

const isAllowedImage = (file) => Boolean(extensionFor(file));

const moveUploadedFile = (fromPath, toPath) => {
  try {
    fs.renameSync(fromPath, toPath);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
    fs.copyFileSync(fromPath, toPath);
    fs.rmSync(fromPath, { force: true });
  }
};

const saveSideUpload = (side, file) => {
  if (!SIDES.includes(side)) {
    throw new Error("Side must be left or right.");
  }
  if (!file) {
    throw new Error("No image file uploaded.");
  }
  if (!isAllowedImage(file)) {
    throw new Error("Use a PNG, JPG, WEBP, or GIF image.");
  }

  ensureUploadsDir();
  clearSide(side);

  const ext = extensionFor(file);
  const dest = path.join(UPLOADS, `${side}${ext}`);
  moveUploadedFile(file.path, dest);
  return resolveBackgrounds();
};

const saveSideUploadToDir = (side, file, dir) => {
  if (!file) {
    return null;
  }
  if (!isAllowedImage(file)) {
    throw new Error("Use a PNG, JPG, WEBP, or GIF image.");
  }
  const ext = extensionFor(file);
  const dest = path.join(dir, `${side}${ext}`);
  moveUploadedFile(file.path, dest);
  return dest;
};

const resetBackgrounds = () => {
  ensureUploadsDir();
  SIDES.forEach(clearSide);
  return resolveBackgrounds();
};

module.exports = {
  UPLOADS,
  SIDES,
  ensureUploadsDir,
  resolveBackgrounds,
  saveSideUpload,
  saveSideUploadToDir,
  resetBackgrounds,
  isAllowedImage,
  extensionFor,
};
