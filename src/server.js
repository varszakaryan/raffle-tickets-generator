const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const express = require("express");
const archiver = require("archiver");
const multer = require("multer");
const {
  UPLOADS,
  SIDES,
  resolveBackgrounds,
  saveSideUpload,
  resetBackgrounds,
  isAllowedImage,
} = require("./backgrounds");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const OUTPUT = path.join(ROOT, "output");
const GENERATOR = path.join(__dirname, "generate-tickets.py");
const PORT = process.env.PORT || 3010;

const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.use(express.static(PUBLIC));
app.use("/assets", express.static(path.join(ROOT, "assets")));
app.use("/uploads", express.static(UPLOADS));

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImage(file)) {
      cb(new Error("Use a PNG, JPG, WEBP, or GIF image."));
      return;
    }
    cb(null, true);
  },
});

const parseRange = ({ start, end }) => {
  const from = Number.parseInt(start, 10);
  const to = Number.parseInt(end, 10);

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return { error: "Enter whole numbers for the ticket range." };
  }
  if (from < 0 || to < 0) {
    return { error: "Ticket numbers must be zero or greater." };
  }
  if (from > to) {
    return { error: "Start must be less than or equal to end." };
  }
  if (to - from > 5000) {
    return { error: "Maximum range is 5000 tickets." };
  }

  return { start: from, end: to };
};

const runGenerator = (start, end, outputDir, leftBg, rightBg) =>
  new Promise((resolve, reject) => {
    const child = spawn("python3", [GENERATOR], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Generator exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Invalid generator response: ${stdout}`));
      }
    });

    child.stdin.write(
      JSON.stringify({
        start,
        end,
        outputDir,
        leftBg,
        rightBg,
      })
    );
    child.stdin.end();
  });

const clearDirectory = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  fs.readdirSync(dir).forEach((name) => {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  });
};

app.get("/api/backgrounds", (_req, res) => {
  res.json({ success: true, ...resolveBackgrounds() });
});

app.post("/api/backgrounds/reset", (_req, res) => {
  res.json({ success: true, ...resetBackgrounds() });
});

app.post("/api/backgrounds/:side", (req, res) => {
  const side = req.params.side;
  if (!SIDES.includes(side)) {
    res.status(400).json({ success: false, error: "Side must be left or right." });
    return;
  }

  upload.single("image")(req, res, (error) => {
    if (error) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }

    try {
      const backgrounds = saveSideUpload(side, req.file);
      res.json({ success: true, ...backgrounds });
    } catch (uploadError) {
      res.status(400).json({ success: false, error: uploadError.message });
    }
  });
});

app.post("/api/generate", (req, res) => {
  const range = parseRange(req.body || {});
  if (range.error) {
    res.status(400).json({ success: false, error: range.error });
    return;
  }

  const batchDir = path.join(
    OUTPUT,
    `batch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  );
  const backgrounds = resolveBackgrounds();

  clearDirectory(batchDir);

  runGenerator(
    range.start,
    range.end,
    batchDir,
    backgrounds.leftPath,
    backgrounds.rightPath
  )
    .then((result) => {
      const batchId = path.basename(batchDir);
      res.json({
        success: true,
        count: result.count,
        pages: result.pages,
        perPage: result.perPage,
        cols: result.cols,
        rows: result.rows,
        ticketHeightCm: result.ticketHeightCm,
        ticketWidthCm: result.ticketWidthCm,
        batchId,
        preview: `/api/preview/${batchId}/${result.preview}`,
        pdf: result.pdf,
      });
    })
    .catch((error) => {
      res.status(500).json({ success: false, error: error.message });
    });
});

app.get("/api/preview/:batchId/:file", (req, res) => {
  const filePath = path.join(OUTPUT, req.params.batchId, req.params.file);
  if (!filePath.startsWith(OUTPUT) || !fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

app.get("/api/download/:batchId", (req, res) => {
  const batchDir = path.join(OUTPUT, req.params.batchId);
  if (!batchDir.startsWith(OUTPUT) || !fs.existsSync(batchDir)) {
    res.status(404).json({ success: false, error: "Batch not found." });
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="raffle-tickets-${req.params.batchId}.zip"`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error) => {
    res.status(500).end(error.message);
  });
  archive.pipe(res);

  fs.readdirSync(batchDir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .forEach((name) => {
      archive.file(path.join(batchDir, name), { name });
    });

  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`Raffle ticket generator running at http://localhost:${PORT}`);
});
