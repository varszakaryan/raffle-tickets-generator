const form = document.getElementById("generator-form");
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const button = document.getElementById("generate-btn");
const status = document.getElementById("status");
const preview = document.getElementById("preview");
const downloadLink = document.getElementById("download-link");
const resetButton = document.getElementById("reset-backgrounds");
const leftThumb = document.getElementById("left-thumb");
const rightThumb = document.getElementById("right-thumb");
const leftMeta = document.getElementById("left-meta");
const rightMeta = document.getElementById("right-meta");
const leftInput = document.getElementById("left-upload");
const rightInput = document.getElementById("right-upload");

const STORAGE_KEYS = {
  left: "raffle-tickets.bg.left",
  right: "raffle-tickets.bg.right",
};
const DEFAULT_BG = "assets/ticket-bg-white.png";
const MAX_STORE_EDGE = 1600;

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.classList.toggle("error", isError);
};

const readStoredBackground = (side) => {
  try {
    return localStorage.getItem(STORAGE_KEYS[side]);
  } catch (error) {
    return null;
  }
};

const writeStoredBackground = (side, dataUrl) => {
  localStorage.setItem(STORAGE_KEYS[side], dataUrl);
};

const clearStoredBackground = (side) => {
  localStorage.removeItem(STORAGE_KEYS[side]);
};

const clearAllStoredBackgrounds = () => {
  clearStoredBackground("left");
  clearStoredBackground("right");
};

const loadImageElement = (source) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = source;
  });

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });

const compressForStorage = (dataUrl) =>
  loadImageElement(dataUrl).then((image) => {
    const scale = Math.min(1, MAX_STORE_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.88);
  });

const dataUrlToFile = (dataUrl, filename) => {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], filename, { type: mime });
};

const paintSide = (side, dataUrl) => {
  const thumb = side === "left" ? leftThumb : rightThumb;
  const meta = side === "left" ? leftMeta : rightMeta;
  if (dataUrl) {
    thumb.src = dataUrl;
    meta.textContent = "Saved locally";
    return;
  }
  thumb.src = DEFAULT_BG;
  meta.textContent = "Default";
};

const restoreFromLocalStorage = () => {
  paintSide("left", readStoredBackground("left"));
  paintSide("right", readStoredBackground("right"));
};

const saveBackgroundLocally = (side, file) =>
  fileToDataUrl(file)
    .then(compressForStorage)
    .then((dataUrl) => {
      try {
        writeStoredBackground(side, dataUrl);
      } catch (error) {
        if (error?.name === "QuotaExceededError") {
          throw new Error("Image too large for local storage. Try a smaller file.");
        }
        throw error;
      }
      paintSide(side, dataUrl);
      return dataUrl;
    });

const readJson = (response) =>
  response.json().then((payload) => {
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Request failed.");
    }
    return payload;
  });

const generateTickets = (start, end) => {
  const body = new FormData();
  body.append("start", start);
  body.append("end", end);

  const leftData = readStoredBackground("left");
  const rightData = readStoredBackground("right");
  if (leftData) {
    body.append("left", dataUrlToFile(leftData, "left.jpg"));
  }
  if (rightData) {
    body.append("right", dataUrlToFile(rightData, "right.jpg"));
  }

  return fetch("api/generate", {
    method: "POST",
    body,
  }).then(readJson);
};

const bindDropzone = (side, input) => {
  const zone = document.querySelector(`.dropzone[data-side="${side}"]`);
  const openPicker = () => input.click();

  const handleFiles = (files) => {
    const file = files && files[0];
    if (!file) return;

    setStatus(`Saving ${side} background locally…`);
    saveBackgroundLocally(side, file)
      .then(() => {
        setStatus(`${side[0].toUpperCase()}${side.slice(1)} background saved in this browser.`);
      })
      .catch((error) => {
        setStatus(error.message, true);
      });
  };

  zone.addEventListener("click", openPicker);
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });

  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("is-dragover");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("is-dragover");
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragover");
    handleFiles(event.dataTransfer.files);
  });

  input.addEventListener("change", () => {
    handleFiles(input.files);
    input.value = "";
  });
};

bindDropzone("left", leftInput);
bindDropzone("right", rightInput);

resetButton.addEventListener("click", () => {
  clearAllStoredBackgrounds();
  restoreFromLocalStorage();
  setStatus("Local backgrounds cleared.");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const start = startInput.value;
  const end = endInput.value;

  button.disabled = true;
  downloadLink.hidden = true;
  setStatus("Generating tickets…");

  generateTickets(start, end)
    .then((result) => {
      preview.src = `${result.preview}?t=${Date.now()}`;
      downloadLink.href = `api/download/${result.batchId}`;
      downloadLink.hidden = false;
      setStatus(
        `Created ${result.count} tickets on ${result.pages} A4 page(s) ` +
          `(${result.cols}×${result.rows} = ${result.perPage}/page, ` +
          `${result.ticketWidthCm}×${result.ticketHeightCm} cm).`
      );
    })
    .catch((error) => {
      setStatus(error.message, true);
    })
    .finally(() => {
      button.disabled = false;
    });
});

restoreFromLocalStorage();
