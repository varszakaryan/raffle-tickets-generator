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

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.classList.toggle("error", isError);
};

const withCacheBust = (url) => `${url}?t=${Date.now()}`;

const applyBackgrounds = (payload) => {
  leftThumb.src = withCacheBust(payload.leftUrl);
  rightThumb.src = withCacheBust(payload.rightUrl);
  leftMeta.textContent = payload.leftCustom ? "Custom upload" : "Default";
  rightMeta.textContent = payload.rightCustom ? "Custom upload" : "Default";
};

const readJson = (response) =>
  response.json().then((payload) => {
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Request failed.");
    }
    return payload;
  });

const loadBackgrounds = () =>
  fetch("/api/backgrounds")
    .then(readJson)
    .then(applyBackgrounds);

const uploadBackground = (side, file) => {
  const body = new FormData();
  body.append("image", file);

  return fetch(`/api/backgrounds/${side}`, {
    method: "POST",
    body,
  }).then(readJson);
};

const resetBackgrounds = () =>
  fetch("/api/backgrounds/reset", { method: "POST" }).then(readJson);

const generateTickets = (start, end) =>
  fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  }).then(readJson);

const bindDropzone = (side, input) => {
  const zone = document.querySelector(`.dropzone[data-side="${side}"]`);

  const openPicker = () => input.click();

  const handleFiles = (files) => {
    const file = files && files[0];
    if (!file) return;

    setStatus(`Uploading ${side} background…`);
    uploadBackground(side, file)
      .then((payload) => {
        applyBackgrounds(payload);
        setStatus(`${side[0].toUpperCase()}${side.slice(1)} background updated.`);
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
  setStatus("Restoring default backgrounds…");
  resetBackgrounds()
    .then((payload) => {
      applyBackgrounds(payload);
      setStatus("Default backgrounds restored.");
    })
    .catch((error) => {
      setStatus(error.message, true);
    });
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
      downloadLink.href = `/api/download/${result.batchId}`;
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

loadBackgrounds().catch((error) => {
  setStatus(error.message, true);
});
