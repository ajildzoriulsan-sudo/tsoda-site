const REQUEST_STORAGE_KEY = "tsoda-design-requests";

function getStoredRequests() {
  const saved = localStorage.getItem(REQUEST_STORAGE_KEY);

  if (!saved) {
    return [];
  }

  try {
    return JSON.parse(saved);
  } catch (error) {
    console.error("Failed to parse stored requests", error);
    return [];
  }
}

function saveRequests(requests) {
  localStorage.setItem(REQUEST_STORAGE_KEY, JSON.stringify(requests));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function formatBudget(value) {
  return value && value.trim() ? value.trim() : "Budget not specified";
}

function createRequestCard(request, index) {
  const imageMarkup = request.image
    ? `<img class="request-card-image" src="${request.image}" alt="${request.title} reference image">`
    : `<div class="request-card-placeholder">No image provided</div>`;

  return `
    <article class="request-card">
      <div class="request-card-media">
        ${imageMarkup}
      </div>
      <div class="request-card-content">
        <p class="request-card-label">Request ${index + 1}</p>
        <h3>${request.title}</h3>
        <p class="request-card-budget">${formatBudget(request.budget)}</p>
        <label class="status-control">
          <span>Status</span>
          <select data-request-id="${request.id}" class="status-select">
            <option value="Open"${request.status === "Open" ? " selected" : ""}>Open</option>
            <option value="In Progress"${request.status === "In Progress" ? " selected" : ""}>In Progress</option>
            <option value="Completed"${request.status === "Completed" ? " selected" : ""}>Completed</option>
          </select>
        </label>
      </div>
    </article>
  `;
}

function renderRequestList() {
  const listElement = document.querySelector("#request-list");
  const emptyState = document.querySelector("#request-empty-state");

  if (!listElement || !emptyState) {
    return;
  }

  const requests = getStoredRequests();

  if (!requests.length) {
    listElement.innerHTML = "";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  listElement.innerHTML = requests
    .slice()
    .reverse()
    .map((request, index) => createRequestCard(request, index))
    .join("");

  const statusInputs = listElement.querySelectorAll(".status-select");
  statusInputs.forEach((input) => {
    input.addEventListener("change", (event) => {
      const nextStatus = event.target.value;
      const requestId = event.target.dataset.requestId;
      const currentRequests = getStoredRequests();
      const updated = currentRequests.map((request) =>
        request.id === requestId ? { ...request, status: nextStatus } : request
      );

      saveRequests(updated);
      renderRequestList();
    });
  });
}

function setupRequestForm() {
  const form = document.querySelector("#design-request-form");
  const imageInput = document.querySelector("#request-image");
  const preview = document.querySelector("#upload-preview");
  const previewImage = document.querySelector("#upload-preview-image");
  const message = document.querySelector("#form-message");

  if (!form || !imageInput || !preview || !previewImage || !message) {
    return;
  }

  imageInput.addEventListener("change", async () => {
    const [file] = imageInput.files;

    if (!file) {
      preview.hidden = true;
      previewImage.removeAttribute("src");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      previewImage.src = dataUrl;
      preview.hidden = false;
    } catch (error) {
      console.error(error);
      preview.hidden = true;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const [file] = imageInput.files;
    const image = await readFileAsDataUrl(file);

    const nextRequest = {
      id: crypto.randomUUID(),
      title: String(formData.get("title") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      budget: String(formData.get("budget") || "").trim(),
      image,
      status: "Open",
      createdAt: new Date().toISOString(),
    };

    const requests = getStoredRequests();
    saveRequests([...requests, nextRequest]);

    form.reset();
    preview.hidden = true;
    previewImage.removeAttribute("src");
    message.textContent = "Request saved locally. You can review it in the request list.";
  });
}

setupRequestForm();
renderRequestList();
