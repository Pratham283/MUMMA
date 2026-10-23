const loginPanel = document.querySelector("#login-panel");
const dashboardPanel = document.querySelector("#dashboard-panel");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const enquiryList = document.querySelector("#admin-enquiries");
const logoutButton = document.querySelector("#logout-button");
const refreshButton = document.querySelector("#refresh-enquiries");
const siteContent = { notices: [], activities: [], gallery: [] };
const contentForms = {
    notices: document.querySelector("#notice-form"),
    activities: document.querySelector("#activity-form"),
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

    enquiries.forEach((enquiry) => {
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
        addContactLink(details, "Email", enquiry.email, `mailto:${enquiry.email}`);
        if (enquiry.message) {
            details.append(makeElement("p", "admin-enquiry-note", enquiry.message));
        }
        card.append(heading, details);
        enquiryList.append(card);
    });
}

async function loadEnquiries() {
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
    list.replaceChildren();
    if (!siteContent.notices.length) {
        list.append(makeElement("p", "admin-empty", "No notices yet. Add one using the form above."));
        return;
    }

    siteContent.notices.forEach((notice) => {
        const card = makeElement("article", `admin-notice-card${notice.priority === "normal" ? "" : ` admin-notice-card-${notice.priority}`}`);
        const content = makeElement("div", "admin-notice-content");
        content.append(
            makeElement("h3", "", notice.title),
            makeElement("p", "", notice.body),
            makeElement("p", "admin-notice-meta", `${notice.date} · ${notice.priority}`)
        );
        const actions = makeElement("div", "admin-content-actions");
        actions.append(
            makeActionButton("Edit", "edit", "notices", notice.id),
            makeActionButton("Delete", "delete", "notices", notice.id, true)
        );
        card.append(content, actions);
        list.append(card);
    });
}

function renderContentCards(section) {
    const list = document.querySelector(section === "activities" ? "#admin-activity-list" : "#admin-gallery-list");
    list.replaceChildren();
    const items = siteContent[section];
    if (!items.length) {
        list.append(makeElement("p", "admin-empty", `No ${section} yet. Add one using the form above.`));
        return;
    }

    items.forEach((item) => {
        const card = makeElement("article", section === "gallery" ? "admin-gallery-card" : "admin-notice-card");
        const image = document.createElement("img");
        image.src = item.image;
        image.alt = item.alt || item.title;
        image.loading = "lazy";
        if (section === "activities") {
            image.className = "admin-content-preview";
        }
        const details = makeElement("div", section === "gallery" ? "admin-gallery-details" : "admin-notice-content");
        details.append(
            makeElement("h3", "", item.title),
            makeElement("p", "", section === "activities" ? item.category : item.caption)
        );
        if (section === "activities") {
            details.append(makeElement("p", "", item.description));
        }
        const actions = makeElement("div", "admin-content-actions");
        actions.append(
            makeActionButton("Edit", "edit", section, item.id),
            makeActionButton("Delete", "delete", section, item.id, true)
        );
        card.append(image, details, actions);
        list.append(card);
    });
}

function renderSiteContent() {
    renderNotices();
    renderContentCards("activities");
    renderContentCards("gallery");
}

async function loadSiteContent() {
    const content = await apiRequest("/api/content");
    for (const section of Object.keys(siteContent)) {
        if (!Array.isArray(content[section])) {
            throw new Error(`Could not load the website ${section}.`);
        }
        siteContent[section] = content[section];
    }
    renderSiteContent();
}

function resetContentForm(section) {
    const form = contentForms[section];
    form.reset();
    form.elements.namedItem("id").value = "";
    form.querySelector('button[type="submit"]').textContent = section === "gallery" ? "Add photo" : `Add ${section === "notices" ? "notice" : "activity"}`;
    form.querySelector(`[data-cancel-edit="${section}"]`).hidden = true;
    if (section === "notices") {
        const now = new Date();
        form.elements.namedItem("date").value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
    form.querySelector(`[data-cancel-edit="${section}"]`).hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    form.elements.namedItem("title").focus({ preventScroll: true });
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

for (const [section, form] of Object.entries(contentForms)) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        const item = Object.fromEntries(new FormData(form).entries());
        if (!item.id) {
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

document.querySelector("#admin-notice-list").addEventListener("click", handleContentAction);
document.querySelector("#admin-activity-list").addEventListener("click", handleContentAction);
document.querySelector("#admin-gallery-list").addEventListener("click", handleContentAction);

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
    if (!item || !window.confirm(`Delete "${item.title}"? This will remove it from the public website.`)) {
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
        resetContentForm("notices");
        await Promise.all([loadEnquiries(), loadSiteContent()]);
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
        resetContentForm("notices");
        await Promise.all([loadEnquiries(), loadSiteContent()]);
    } catch (error) {
        console.error(error);
        showMessage(loginMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

refreshButton.addEventListener("click", async () => {
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
