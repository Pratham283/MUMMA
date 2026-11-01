const loginPanel = document.querySelector("#login-panel");
const dashboardPanel = document.querySelector("#dashboard-panel");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const enquiryList = document.querySelector("#admin-enquiries");
const logoutButton = document.querySelector("#logout-button");
const refreshButton = document.querySelector("#refresh-enquiries");
const siteContent = { heroSlides: [], notices: [], activities: [], events: [], gallery: [] };
const contentForms = {
    heroSlides: document.querySelector("#hero-slide-form"),
    notices: document.querySelector("#notice-form"),
    activities: document.querySelector("#activity-form"),
    events: document.querySelector("#event-form"),
    gallery: document.querySelector("#gallery-form"),
};
let csrfToken = "";

function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("is-error", isError);
    element.classList.toggle("is-success", Boolean(message) && !isError);
}

async function apiRequest(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (csrfToken && options.method && options.method !== "GET") {
        headers.set("X-CSRF-Token", csrfToken);
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || "The request could not be completed.");
    }
    return result;
}

function setSignedIn(signedIn) {
    loginPanel.hidden = signedIn;
    dashboardPanel.hidden = !signedIn;
}

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function addContactLink(container, label, value, href) {
    if (!value) {
        return;
    }
    const link = document.createElement("a");
    link.href = href;
    link.textContent = value;
    link.setAttribute("aria-label", `${label}: ${value}`);
    container.append(link);
}

function renderEnquiries(enquiries) {
    enquiryList.replaceChildren();
    if (enquiries.length === 0) {
        enquiryList.append(makeElement("p", "admin-empty", "There are no admission enquiries yet."));
        return;
    }

    const pageSize = 50;
    let shown = 0;
    const moreButton = makeElement("button", "admin-secondary-button", "");
    moreButton.type = "button";
    moreButton.addEventListener("click", showMore);

    function showMore() {
        const cards = enquiries.slice(shown, shown + pageSize).map(makeEnquiryCard);
        shown += cards.length;
        moreButton.remove();
        enquiryList.append(...cards);
        if (shown < enquiries.length) {
            moreButton.textContent = `Show more (${enquiries.length - shown} remaining)`;
            enquiryList.append(moreButton);
        }
    }

    showMore();
}

function makeEnquiryCard(enquiry) {
    const card = makeElement("article", "admin-enquiry-card");
    const heading = makeElement("div", "admin-enquiry-heading");
    heading.append(
        makeElement("h3", "", enquiry.studentName),
        makeElement("time", "", new Date(enquiry.createdAt).toLocaleString())
    );

    const details = makeElement("div", "admin-enquiry-details");
    details.append(
        makeElement("p", "", `Parent/guardian: ${enquiry.parentName}`),
        makeElement("p", "", `Class of interest: ${enquiry.grade}`),
        makeElement("p", "", `Address: ${enquiry.address}`),
        makeElement("p", "", `PIN code: ${enquiry.pinCode}`)
    );
    addContactLink(details, "Phone", enquiry.phone, `tel:${enquiry.phone.replace(/[^\d+]/g, "")}`);
    addContactLink(details, "Email", enquiry.email, `mailto:${encodeURIComponent(enquiry.email || "")}`);
    if (enquiry.message) {
        details.append(makeElement("p", "admin-enquiry-note", enquiry.message));
    }
    card.append(heading, details);
    return card;
}

async function loadEnquiries() {
    if (!enquiryList) {
        return;
    }
    enquiryList.replaceChildren(makeElement("p", "admin-empty", "Loading enquiries…"));
    const result = await apiRequest("/api/admin/enquiries");
    renderEnquiries(result.enquiries);
    showMessage(dashboardMessage, `${result.enquiries.length} recent enquiries loaded.`);
}

function makeActionButton(label, action, section, id, danger = false) {
    const button = makeElement("button", danger ? "admin-danger-button" : "admin-secondary-button", label);
    button.type = "button";
    button.dataset.action = action;
    button.dataset.section = section;
    button.dataset.id = id;
    return button;
}

function renderNotices() {
    const list = document.querySelector("#admin-notice-list");
    if (!list) {
        return;
    }
    list.replaceChildren();
    if (!siteContent.notices.length) {
        list.append(makeElement("p", "admin-empty", "No notices yet. Add one using the form above."));
        return;
    }

    siteContent.notices.forEach((notice) => {
        const card = makeElement("article", `admin-notice-card${notice.priority === "normal" ? "" : ` admin-notice-card-${notice.priority}`}`);
        card.dataset.contentId = notice.id;
        card.draggable = true;
        const content = makeElement("div", "admin-notice-content");
        content.append(
            makeElement("h3", "", notice.title),
            makeElement("p", "", notice.body),
            makeElement("p", "admin-notice-meta", `${notice.date} · ${notice.priority}`)
        );
        const actions = makeElement("div", "admin-content-actions");
        actions.append(makeElement("span", "admin-drag-handle", "↕ Drag to reorder"));
        actions.append(
            makeActionButton("Edit", "edit", "notices", notice.id),
            makeActionButton("Delete", "delete", "notices", notice.id, true)
        );
        card.append(content, actions);
        list.append(card);
    });
}

function renderContentCards(section) {
    const listSelector = {
        heroSlides: "#admin-hero-slides-list",
        activities: "#admin-activity-list",
        events: "#admin-event-list",
        gallery: "#admin-gallery-list",
    }[section];
    const list = document.querySelector(listSelector);
    if (!list) {
        return;
    }
    list.replaceChildren();
    const items = siteContent[section];
    const isTextCard = section === "activities" || section === "events";
    if (!items.length) {
        list.append(makeElement("p", "admin-empty", `No ${section} yet. Add one using the form above.`));
        return;
    }

    items.forEach((item) => {
        const card = makeElement("article", isTextCard ? "admin-notice-card" : "admin-gallery-card");
        card.dataset.contentId = item.id;
        card.draggable = true;
        const isVideo = section === "heroSlides" && item.type === "video";
        const image = document.createElement(isVideo ? "video" : "img");
        if (isVideo) {
            image.src = item.src;
            image.muted = true;
            image.preload = "metadata";
            image.draggable = false;
        } else {
            image.src = section === "heroSlides" ? (item.src || item.image) : item.image;
            image.alt = item.alt || item.title || "";
            image.loading = "lazy";
        }
        if (isTextCard) {
            image.className = "admin-content-preview";
        }
        const details = makeElement("div", isTextCard ? "admin-notice-content" : "admin-gallery-details");
        if (section === "heroSlides") {
            details.append(makeElement("h3", "", isVideo ? "Video" : "Photo"));
        } else {
            details.append(
                makeElement("h3", "", item.title),
                makeElement("p", "", section === "activities" ? item.category : section === "events" ? item.date : item.caption)
            );
        }
        if (isTextCard) {
            details.append(makeElement("p", "", item.description));
        }
        const actions = makeElement("div", "admin-content-actions");
        actions.append(makeElement("span", "admin-drag-handle", "↕ Drag to reorder"));
        actions.append(
            makeActionButton("Edit", "edit", section, item.id),
            makeActionButton("Delete", "delete", section, item.id, true)
        );
        card.append(image, details, actions);
        list.append(card);
    });
}

function renderSiteContent() {
    renderContentCards("heroSlides");
    renderNotices();
    renderContentCards("activities");
    renderContentCards("events");
    renderContentCards("gallery");
    updateHeroSlideLimit();
}

function updateHeroSlideLimit() {
    if (!contentForms.heroSlides) {
        return;
    }
    const atLimit = siteContent.heroSlides.length >= 5;
    const editingSlide = Boolean(contentForms.heroSlides.elements.namedItem("id").value);
    const addButton = contentForms.heroSlides.querySelector('button[type="submit"]');
    addButton.disabled = atLimit && !editingSlide;
    document.querySelector("#hero-slide-limit").textContent =
        `${siteContent.heroSlides.length} of 5 slideshow photos used.${atLimit ? " Delete a photo before adding another." : ""}`;
}

async function loadSiteContent() {
    const content = await apiRequest("/api/content");
    const timingForm = document.querySelector("#hero-timing-form");
    if (timingForm) {
        timingForm.elements.namedItem("seconds").value = content.heroSlideSeconds || 3;
    }
    for (const section of Object.keys(siteContent)) {
        if (!Array.isArray(content[section])) {
            throw new Error(`Could not load the website ${section}.`);
        }
        siteContent[section] = content[section];
    }
    renderSiteContent();
}

function setUploadStatus(form, text) {
    const status = form.querySelector(".upload-status");
    if (status) {
        status.textContent = text;
    }
}

function resetContentForm(section) {
    const form = contentForms[section];
    if (!form) {
        return;
    }
    form.reset();
    form.elements.namedItem("id").value = "";
    setUploadStatus(form, "No file chosen yet.");
    const addLabels = { heroSlides: "Add slide", gallery: "Add photo", notices: "Add notice", activities: "Add activity", events: "Add event" };
    form.querySelector('button[type="submit"]').textContent = addLabels[section];
    form.querySelector(`[data-cancel-edit="${section}"]`).hidden = true;
    if (section === "notices" || section === "events") {
        const now = new Date();
        form.elements.namedItem("date").value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    if (section === "heroSlides") {
        updateHeroSlideLimit();
    }
}

function editContentItem(section, id) {
    const item = siteContent[section].find((entry) => entry.id === id);
    if (!item) {
        return;
    }
    const form = contentForms[section];
    Object.entries(item).forEach(([key, value]) => {
        const field = form.elements.namedItem(key);
        if (field) {
            field.value = value;
        }
    });
    form.querySelector('button[type="submit"]').textContent = "Save changes";
    setUploadStatus(form, "Current file is kept. Choose a new file only to replace it.");
    form.querySelector(`[data-cancel-edit="${section}"]`).hidden = false;
    if (section === "heroSlides") {
        form.elements.namedItem("src").value = item.src || item.image || "";
        updateHeroSlideLimit();
    }
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    (form.elements.namedItem("title") || form.elements.namedItem("src")).focus({ preventScroll: true });
}

async function saveContentSection(section, items) {
    const result = await apiRequest(`/api/admin/content/${section}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
    });
    siteContent[section] = result.items;
    renderSiteContent();
    showMessage(dashboardMessage, result.message);
}

const mediaMimeByExtension = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", webm: "video/webm" };

document.querySelectorAll("[data-choose-upload]").forEach((button) => {
    button.addEventListener("click", () => button.form.querySelector("input[data-upload-target]").click());
});

document.querySelectorAll("input[data-upload-target]").forEach((input) => {
    input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) {
            return;
        }
        const form = input.form;
        const mimeType = mediaMimeByExtension[file.name.split(".").pop().toLowerCase()] || file.type;
        const isVideo = mimeType.startsWith("video/");
        if (!mimeType || !Object.values(mediaMimeByExtension).includes(mimeType)) {
            showMessage(dashboardMessage, "Please choose a JPG, PNG, WEBP photo or an MP4, WEBM video.", true);
            input.value = "";
            return;
        }
        if (file.size > (isVideo ? 500 : 15) * 1024 * 1024) {
            showMessage(dashboardMessage, isVideo ? "Videos must be 500 MB or smaller." : "Photos must be 15 MB or smaller.", true);
            input.value = "";
            return;
        }
        input.disabled = true;
        setUploadStatus(form, `Uploading ${file.name}…`);
        showMessage(dashboardMessage, `Uploading ${file.name}…`);
        try {
            const result = await apiRequest("/api/admin/media", {
                method: "PUT",
                headers: { "Content-Type": mimeType },
                body: file,
            });
            form.elements.namedItem(input.dataset.uploadTarget).value = result.path;
            const typeField = form.elements.namedItem("type");
            if (typeField) {
                typeField.value = result.type;
            }
            setUploadStatus(form, `Ready: ${file.name}`);
            showMessage(dashboardMessage, "File uploaded. Press the save button to publish it.");
        } catch (error) {
            console.error(error);
            setUploadStatus(form, "Upload failed. Please try again.");
            showMessage(dashboardMessage, error.message, true);
        } finally {
            input.disabled = false;
            input.value = "";
        }
    });
});

for (const [section, form] of Object.entries(contentForms).filter(([, form]) => form)) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        const item = Object.fromEntries(new FormData(form).entries());
        const mediaField = item.src === undefined ? "image" : "src";
        if (section !== "notices" && !item[mediaField]) {
            showMessage(dashboardMessage, "Please choose a file from your device first.", true);
            return;
        }
        if (!item.id) {
            if (section === "heroSlides" && siteContent.heroSlides.length >= 5) {
                showMessage(dashboardMessage, "The slideshow can contain no more than 5 photos.", true);
                return;
            }
            item.id = crypto.randomUUID();
        }
        const items = [...siteContent[section]];
        const existingIndex = items.findIndex((entry) => entry.id === item.id);
        if (existingIndex >= 0) {
            items[existingIndex] = item;
        } else {
            items.unshift(item);
        }

        submitButton.disabled = true;
        try {
            await saveContentSection(section, items);
            resetContentForm(section);
        } catch (error) {
            console.error(error);
            showMessage(dashboardMessage, error.message, true);
        } finally {
            submitButton.disabled = false;
        }
    });
    form.querySelector(`[data-cancel-edit="${section}"]`).addEventListener("click", () => resetContentForm(section));
}

document.querySelector("#hero-timing-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const result = await apiRequest("/api/admin/hero-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ seconds: Number(form.elements.namedItem("seconds").value) }),
        });
        showMessage(dashboardMessage, result.message);
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

document.querySelector("#admin-notice-list")?.addEventListener("click", handleContentAction);
document.querySelector("#admin-activity-list")?.addEventListener("click", handleContentAction);
document.querySelector("#admin-event-list")?.addEventListener("click", handleContentAction);
document.querySelector("#admin-gallery-list")?.addEventListener("click", handleContentAction);
document.querySelector("#admin-hero-slides-list")?.addEventListener("click", handleContentAction);

async function handleContentAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
        return;
    }
    const { action, section, id } = button.dataset;
    if (action === "edit") {
        editContentItem(section, id);
        return;
    }
    const item = siteContent[section].find((entry) => entry.id === id);
    if (!item || !window.confirm(`Delete "${item.title || (item.type === "video" ? "this video" : "this photo")}"? This will remove it from the public website.`)) {
        return;
    }
    button.disabled = true;
    try {
        await saveContentSection(section, siteContent[section].filter((entry) => entry.id !== id));
        if (contentForms[section].elements.namedItem("id").value === id) {
            resetContentForm(section);
        }
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
}

function enableContentDragAndDrop(list) {
    let draggedCard = null;
    list.addEventListener("dragstart", (event) => {
        const card = event.target.closest("[data-content-id]");
        if (!card) {
            return;
        }
        draggedCard = card;
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.contentId);
    });
    list.addEventListener("dragend", () => {
        draggedCard?.classList.remove("is-dragging");
        draggedCard = null;
        list.querySelectorAll(".is-drop-target").forEach((card) => card.classList.remove("is-drop-target"));
    });
    list.addEventListener("dragover", (event) => {
        if (!draggedCard) {
            return;
        }
        const target = event.target.closest("[data-content-id]");
        if (!target || target === draggedCard) {
            return;
        }
        event.preventDefault();
        const insertAfter = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        list.insertBefore(draggedCard, insertAfter ? target.nextSibling : target);
        list.querySelectorAll(".is-drop-target").forEach((card) => card.classList.remove("is-drop-target"));
        target.classList.add("is-drop-target");
    });
    list.addEventListener("drop", async (event) => {
        if (!draggedCard) {
            return;
        }
        event.preventDefault();
        const section = list.dataset.section;
        const reorderedItems = [...list.querySelectorAll("[data-content-id]")].map((card) =>
            siteContent[section].find((item) => item.id === card.dataset.contentId)
        );
        if (reorderedItems.some((item) => !item)) {
            try {
                await loadSiteContent();
            } catch (error) {
                console.error(error);
                showMessage(dashboardMessage, error.message, true);
            }
            return;
        }
        try {
            await saveContentSection(section, reorderedItems);
            showMessage(dashboardMessage, `${section === "heroSlides" ? "Slideshow" : section} order saved.`);
        } catch (error) {
            console.error(error);
            await loadSiteContent();
            showMessage(dashboardMessage, error.message, true);
        }
    });
}

for (const list of document.querySelectorAll(".admin-sortable-list")) {
    enableContentDragAndDrop(list);
}

const documentRows = [...document.querySelectorAll(".admin-document-row")];

async function loadDocuments() {
    if (!documentRows.length) {
        return;
    }
    const { documents } = await apiRequest("/api/documents");
    documentRows.forEach((row) => {
        const entry = documents[row.dataset.documentKind];
        row.querySelector(".admin-document-status").textContent = entry
            ? `Uploaded ${new Date(entry.updatedAt).toLocaleString()}`
            : "Not uploaded yet";
        const view = row.querySelector("[data-view]");
        view.hidden = !entry;
        if (entry) {
            view.href = `/documents/${row.dataset.documentKind}.pdf?v=${encodeURIComponent(entry.updatedAt)}`;
        }
        row.querySelector("[data-delete]").hidden = !entry;
        row.querySelector(".admin-file-button").textContent = entry ? "Replace PDF" : "Choose PDF";
    });
}

async function uploadDocument(row, file) {
    if (!file) {
        return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        showMessage(dashboardMessage, "Please choose a PDF file.", true);
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showMessage(dashboardMessage, "The PDF must be 10 MB or smaller.", true);
        return;
    }
    showMessage(dashboardMessage, "Uploading PDF…");
    try {
        const result = await apiRequest(`/api/admin/documents/${row.dataset.documentKind}`, {
            method: "PUT",
            headers: { "Content-Type": "application/pdf" },
            body: file,
        });
        showMessage(dashboardMessage, result.message);
        await loadDocuments();
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    }
}

documentRows.forEach((row) => {
    const input = row.querySelector('input[type="file"]');
    const chooseButton = row.querySelector(".admin-file-button");
    chooseButton.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
        await uploadDocument(row, input.files[0]);
        input.value = "";
    });
    row.addEventListener("dragover", (event) => {
        if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            row.classList.add("is-drop-target");
        }
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
    row.addEventListener("drop", async (event) => {
        event.preventDefault();
        row.classList.remove("is-drop-target");
        await uploadDocument(row, event.dataTransfer.files[0]);
    });
    row.querySelector("[data-delete]").addEventListener("click", async () => {
        const name = row.querySelector("h3").textContent;
        if (!window.confirm(`Delete the ${name} PDF? It will be removed from the website.`)) {
            return;
        }
        try {
            const result = await apiRequest(`/api/admin/documents/${row.dataset.documentKind}`, { method: "DELETE" });
            showMessage(dashboardMessage, result.message);
            await loadDocuments();
        } catch (error) {
            console.error(error);
            showMessage(dashboardMessage, error.message, true);
        }
    });
});

async function initializeAdmin() {
    try {
        const csrf = await apiRequest("/api/admin/csrf");
        csrfToken = csrf.csrfToken;
        const { admin } = await apiRequest("/api/admin/me");
        if (!admin) {
            setSignedIn(false);
            return;
        }
        document.querySelector("#admin-identity").textContent = `Signed in as ${admin.email}`;
        setSignedIn(true);
        Object.keys(contentForms).forEach(resetContentForm);
        await Promise.all([loadEnquiries(), loadSiteContent(), loadDocuments()]);
    } catch (error) {
        console.error(error);
        setSignedIn(false);
        showMessage(loginMessage, error.message, true);
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage(loginMessage, "Signing in…");
    try {
        const credentials = Object.fromEntries(new FormData(loginForm).entries());
        const result = await apiRequest("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
        });
        csrfToken = result.csrfToken;
        loginForm.reset();
        document.querySelector("#admin-identity").textContent = `Signed in as ${result.admin.email}`;
        setSignedIn(true);
        Object.keys(contentForms).forEach(resetContentForm);
        await Promise.all([loadEnquiries(), loadSiteContent(), loadDocuments()]);
    } catch (error) {
        console.error(error);
        showMessage(loginMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

refreshButton?.addEventListener("click", async () => {
    refreshButton.disabled = true;
    try {
        await loadEnquiries();
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        refreshButton.disabled = false;
    }
});

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
        await apiRequest("/api/admin/logout", { method: "POST" });
        csrfToken = "";
        setSignedIn(false);
        await initializeAdmin();
        showMessage(loginMessage, "You have signed out.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        logoutButton.disabled = false;
    }
});

initializeAdmin();
