const loginPanel = document.querySelector("#login-panel");
const dashboardPanel = document.querySelector("#dashboard-panel");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const adminGallery = document.querySelector("#admin-gallery");
const adminActivities = document.querySelector("#admin-activities");
const adminEnquiries = document.querySelector("#admin-enquiries");
const uploadForm = document.querySelector("#upload-form");
const noticeForm = document.querySelector("#notice-form");
const adminNotices = document.querySelector("#admin-notices");
const activityForm = document.querySelector("#activity-form");
let csrfToken = "";
let adminInitialization = null;

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

    const response = await fetch(url, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && url !== "/api/admin/login") {
            csrfToken = "";
            showDashboard(false);
        }
        throw new Error(result.error || "The request could not be completed.");
    }
    return result;
}

function showDashboard(isSignedIn) {
    if (loginPanel) {
        loginPanel.hidden = isSignedIn;
    }
    if (dashboardPanel) {
        dashboardPanel.hidden = !isSignedIn;
    }
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

function renderGallery(images) {
    if (!adminGallery) {
        return;
    }
    adminGallery.replaceChildren();
    if (images.length === 0) {
        adminGallery.append(makeElement("p", "admin-empty", "No photos in the gallery yet."));
        return;
    }

    images.forEach((image) => {
        const card = makeElement("article", "admin-gallery-card");
        const photo = document.createElement("img");
        photo.src = image.imagePath;
        photo.alt = image.title;
        photo.loading = "lazy";
        const details = makeElement("div", "admin-gallery-details");
        details.append(
            makeElement("h3", "", image.title),
            makeElement("p", "", image.caption || "No caption")
        );
        const removeButton = makeElement("button", "admin-danger-button", "Delete photo");
        removeButton.type = "button";
        removeButton.dataset.galleryId = image.id;
        details.append(removeButton);
        card.append(photo, details);
        adminGallery.append(card);
    });
}

function renderActivities(activities) {
    if (!adminActivities) {
        return;
    }
    adminActivities.replaceChildren();
    if (activities.length === 0) {
        adminActivities.append(makeElement("p", "admin-empty", "No activities have been added yet."));
        return;
    }

    activities.forEach((activity) => {
        const card = makeElement("article", "admin-gallery-card");
        const photo = document.createElement("img");
        photo.src = activity.imagePath;
        photo.alt = activity.title;
        photo.loading = "lazy";
        const details = makeElement("div", "admin-gallery-details");
        details.append(
            makeElement("h3", "", activity.title),
            makeElement("p", "", activity.category || "School activity"),
            makeElement("p", "", activity.description)
        );
        const removeButton = makeElement("button", "admin-danger-button", "Delete activity");
        removeButton.type = "button";
        removeButton.dataset.activityId = activity.id;
        details.append(removeButton);
        card.append(photo, details);
        adminActivities.append(card);
    });
}

function renderEnquiries(enquiries) {
    if (!adminEnquiries) {
        return;
    }
    adminEnquiries.replaceChildren();
    if (enquiries.length === 0) {
        adminEnquiries.append(makeElement("p", "admin-empty", "There are no enquiries yet."));
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
            makeElement("p", "", `Class: ${enquiry.grade}`)
        );

        const phone = document.createElement("a");
        phone.href = `tel:${enquiry.phone.replace(/[^\d+]/g, "")}`;
        phone.textContent = enquiry.phone;
        details.append(phone);
        if (enquiry.email) {
            const email = document.createElement("a");
            email.href = `mailto:${enquiry.email}`;
            email.textContent = enquiry.email;
            details.append(email);
        }
        if (enquiry.message) {
            details.append(makeElement("p", "admin-enquiry-note", enquiry.message));
        }

        const statusLabel = makeElement("label", "admin-status-label", "Status");
        const status = document.createElement("select");
        status.dataset.enquiryId = enquiry.id;
        [
            ["new", "New"],
            ["contacted", "Contacted"],
            ["closed", "Closed"],
        ].forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            status.append(option);
        });
        status.value = enquiry.status;
        statusLabel.append(status);
        card.append(heading, details, statusLabel);
        adminEnquiries.append(card);
    });
}

function renderNotices(notices) {
    if (!adminNotices) {
        return;
    }
    adminNotices.replaceChildren();
    if (notices.length === 0) {
        adminNotices.append(makeElement("p", "admin-empty", "No notices have been published yet."));
        return;
    }

    notices.forEach((notice) => {
        const card = makeElement("article", `admin-notice-card admin-notice-card-${notice.priority}`);
        const content = makeElement("div", "admin-notice-content");
        content.append(
            makeElement("h3", "", notice.title),
            makeElement("p", "", notice.body)
        );
        const published = new Date(notice.publishedAt).toLocaleString();
        const expiry = notice.expiresAt
            ? ` · Hides ${new Date(notice.expiresAt).toLocaleString()}`
            : "";
        content.append(makeElement("p", "admin-notice-meta", `${notice.priority} · Posted ${published}${expiry}`));

        const removeButton = makeElement("button", "admin-danger-button", "Delete notice");
        removeButton.type = "button";
        removeButton.dataset.noticeId = notice.id;
        card.append(content, removeButton);
        adminNotices.append(card);
    });
}

async function loadDashboard() {
    const { images, activities, enquiries, notices } = await apiRequest("/api/admin/dashboard");
    renderGallery(images);
    renderActivities(activities);
    renderEnquiries(enquiries);
    renderNotices(notices);
}

async function loadAdminSession() {
    try {
        const session = await apiRequest("/api/admin/csrf");
        csrfToken = session.csrfToken;
        const { admin } = await apiRequest("/api/admin/me");
        if (!admin) {
            showDashboard(false);
            return true;
        }
        showDashboard(true);
        const identity = document.querySelector("#admin-identity");
        if (identity) {
            identity.textContent = `Signed in as ${admin.email}`;
        }
        await loadDashboard();
        return true;
    } catch (error) {
        console.error(error);
        showMessage(loginMessage, error.message, true);
        showDashboard(false);
        return false;
    }
}

function initializeAdmin() {
    if (!adminInitialization) {
        adminInitialization = loadAdminSession().finally(() => {
            adminInitialization = null;
        });
    }
    return adminInitialization;
}

loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage(loginMessage, "Signing in…");

    try {
        const sessionReady = await initializeAdmin();
        if (!sessionReady || !csrfToken) {
            throw new Error("A secure sign-in session could not be created. Reload the page and try again.");
        }
        const credentials = Object.fromEntries(new FormData(loginForm).entries());
        const result = await apiRequest("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
        });
        csrfToken = result.csrfToken;
        loginForm.reset();
        const identity = document.querySelector("#admin-identity");
        if (identity) {
            identity.textContent = `Signed in as ${result.admin.email}`;
        }
        showDashboard(true);
        await loadDashboard();
    } catch (error) {
        console.error(error);
        showMessage(loginMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

uploadForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage(dashboardMessage, "Uploading and optimizing your photo…");

    try {
        await apiRequest("/api/admin/gallery", {
            method: "POST",
            body: new FormData(form),
        });
        form.reset();
        await loadDashboard();
        showMessage(dashboardMessage, "Photo added to the school gallery.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

activityForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = activityForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage(dashboardMessage, "Adding activity and optimizing its photo…");

    try {
        await apiRequest("/api/admin/activities", {
            method: "POST",
            body: new FormData(activityForm),
        });
        activityForm.reset();
        await loadDashboard();
        showMessage(dashboardMessage, "Activity added to the activities page.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

noticeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = noticeForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage(dashboardMessage, "Publishing school notice…");

    try {
        const notice = Object.fromEntries(new FormData(noticeForm).entries());
        if (notice.expiresAt) {
            const expiryDate = new Date(notice.expiresAt);
            if (Number.isNaN(expiryDate.getTime())) {
                throw new Error("Choose a valid expiry date and time.");
            }
            notice.expiresAt = expiryDate.toISOString();
        }
        await apiRequest("/api/admin/notices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(notice),
        });
        noticeForm.reset();
        await loadDashboard();
        showMessage(dashboardMessage, "Notice published on the school website.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

adminNotices?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-notice-id]");
    if (!button || !window.confirm("Delete this notice from the school website?")) {
        return;
    }

    button.disabled = true;
    try {
        await apiRequest(`/api/admin/notices/${encodeURIComponent(button.dataset.noticeId)}`, {
            method: "DELETE",
        });
        await loadDashboard();
        showMessage(dashboardMessage, "Notice deleted from the school website.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
        button.disabled = false;
    }
});

adminGallery?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-gallery-id]");
    if (!button || !window.confirm("Delete this photo from the school gallery?")) {
        return;
    }

    button.disabled = true;
    try {
        await apiRequest(`/api/admin/gallery/${encodeURIComponent(button.dataset.galleryId)}`, {
            method: "DELETE",
        });
        await loadDashboard();
        showMessage(dashboardMessage, "Photo deleted from the school gallery.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
        button.disabled = false;
    }
});

adminActivities?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-activity-id]");
    if (!button || !window.confirm("Delete this activity and its uploaded photo?")) {
        return;
    }

    button.disabled = true;
    try {
        await apiRequest(`/api/admin/activities/${encodeURIComponent(button.dataset.activityId)}`, {
            method: "DELETE",
        });
        await loadDashboard();
        showMessage(dashboardMessage, "Activity deleted from the school website.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
        button.disabled = false;
    }
});

adminEnquiries?.addEventListener("change", async (event) => {
    const select = event.target.closest("select[data-enquiry-id]");
    if (!select) {
        return;
    }

    select.disabled = true;
    try {
        await apiRequest(`/api/admin/enquiries/${encodeURIComponent(select.dataset.enquiryId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: select.value }),
        });
        showMessage(dashboardMessage, "Enquiry status updated.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
        try {
            await loadDashboard();
        } catch (refreshError) {
            console.error(refreshError);
            showMessage(dashboardMessage, refreshError.message, true);
        }
    } finally {
        select.disabled = false;
    }
});

document.querySelector("#logout-button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await apiRequest("/api/admin/logout", { method: "POST" });
        showDashboard(false);
        csrfToken = "";
        await initializeAdmin();
        showMessage(loginMessage, "You have signed out.");
    } catch (error) {
        console.error(error);
        showMessage(dashboardMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

initializeAdmin();
