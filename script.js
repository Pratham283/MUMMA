
const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-navigation");

if (menuToggle && navigation) {
    menuToggle.addEventListener("click", () => {
        const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
        menuToggle.setAttribute("aria-expanded", String(!isExpanded));
        menuToggle.setAttribute("aria-label", isExpanded ? "Open navigation menu" : "Close navigation menu");
        navigation.classList.toggle("is-open", !isExpanded);
    });

    navigation.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.setAttribute("aria-label", "Open navigation menu");
            navigation.classList.remove("is-open");
        }
    });
}

function observeGalleryItems(galleryGrid, items) {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!galleryGrid || !items.length || !("IntersectionObserver" in window) || prefersReducedMotion) {
        items.forEach((item) => item.classList.add("is-visible"));
        return;
    }

    galleryGrid.classList.add("is-observed");
    const galleryObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.14 });

    items.forEach((item) => galleryObserver.observe(item));
}

function renderNoticeList(container, notices) {
    if (!container) {
        return;
    }
    const visibleNotices = container.id === "notice-preview-list" ? notices.slice(0, 3) : notices;
    if (!visibleNotices.length) {
        const empty = document.createElement("p");
        empty.className = "notice-empty";
        empty.textContent = "There are no current school notices.";
        container.replaceChildren(empty);
        return;
    }
    const cards = visibleNotices.map((notice) => {
        const card = document.createElement("article");
        card.className = `notice-card${notice.priority === "normal" ? "" : ` notice-card-${notice.priority}`}`;
        const content = document.createElement("div");
        content.className = "notice-card-content";
        const meta = document.createElement("div");
        meta.className = "notice-card-meta";
        const date = document.createElement("time");
        date.dateTime = notice.date;
        date.textContent = new Date(`${notice.date}T00:00:00`).toLocaleDateString();
        meta.append(date);
        if (notice.priority !== "normal") {
            const priority = document.createElement("span");
            priority.className = "notice-priority";
            priority.textContent = notice.priority;
            meta.append(priority);
        }
        const title = document.createElement("h3");
        title.textContent = notice.title;
        const body = document.createElement("p");
        body.className = "notice-card-body";
        body.textContent = notice.body;
        content.append(meta, title, body);
        card.append(content);
        return card;
    });
    container.replaceChildren(...cards);
}

function makeActivityCard(activity, index, titleTag = "h3") {
    const card = document.createElement("article");
    card.className = "activity-card";
    const photo = document.createElement("div");
    photo.className = "activity-photo";
    const image = document.createElement("img");
    image.src = activity.image;
    image.alt = activity.alt || activity.title;
    image.loading = index === 0 ? "eager" : "lazy";
    image.decoding = "async";
    const number = document.createElement("span");
    number.className = "activity-number";
    number.textContent = String(index + 1).padStart(2, "0");
    photo.append(image, number);
    const info = document.createElement("div");
    info.className = "activity-info";
    const category = document.createElement("p");
    category.className = "activity-category";
    category.textContent = activity.category;
    const title = document.createElement(titleTag);
    title.textContent = activity.title;
    const description = document.createElement("p");
    description.textContent = activity.description;
    info.append(category, title, description);
    card.append(photo, info);
    return card;
}

function makeGalleryCard(image, index) {
    const card = document.createElement("figure");
    card.className = `gallery-item${index === 0 ? " gallery-item-featured" : ""}`;
    const photo = document.createElement("img");
    photo.src = image.image;
    photo.alt = image.alt || image.title;
    photo.loading = index === 0 ? "eager" : "lazy";
    photo.decoding = "async";
    const caption = document.createElement("figcaption");
    const category = document.createElement("span");
    category.textContent = image.caption;
    const title = document.createElement("h3");
    title.textContent = image.title;
    caption.append(category, title);
    card.append(photo, caption);
    return card;
}

function renderActivities(activities) {
    document.querySelectorAll("#home-activities, #activities-page-grid").forEach((container) => {
        if (!activities.length) {
            const empty = document.createElement("p");
            empty.className = "gallery-status";
            empty.textContent = "There are no activities to display right now.";
            container.replaceChildren(empty);
            return;
        }
        const titleTag = container.id === "activities-page-grid" ? "h2" : "h3";
        container.replaceChildren(...activities.map((activity, index) => makeActivityCard(activity, index, titleTag)));
    });
}

function renderGallery(gallery) {
    document.querySelectorAll(".gallery-grid").forEach((container) => {
        if (!gallery.length) {
            const empty = document.createElement("p");
            empty.className = "gallery-status";
            empty.textContent = "There are no gallery photos to display right now.";
            container.replaceChildren(empty);
            return;
        }
        const items = container.hasAttribute("data-gallery-preview") ? gallery.slice(0, 5) : gallery;
        const cards = items.map(makeGalleryCard);
        container.replaceChildren(...cards);
        observeGalleryItems(container, cards);
    });
}

async function loadSiteContent() {
    const noticeLists = [...document.querySelectorAll("#notice-preview-list, #notices-page-list")];
    try {
        const response = await fetch("/api/content");
        if (!response.ok) {
            throw new Error("The school website content could not be loaded.");
        }
        const content = await response.json();
        if (!Array.isArray(content.notices) || !Array.isArray(content.activities) || !Array.isArray(content.gallery)) {
            throw new Error("The school website content is not available.");
        }
        noticeLists.forEach((container) => renderNoticeList(container, content.notices));
        renderActivities(content.activities);
        renderGallery(content.gallery);
    } catch (error) {
        console.error(error);
        noticeLists.forEach((container) => {
            const status = document.createElement("p");
            status.className = "notice-error";
            status.textContent = "School updates are temporarily unavailable. Please try again later.";
            container.replaceChildren(status);
        });
        document.querySelectorAll(".gallery-grid").forEach((container) => {
            const loadingStatus = container.querySelector(".gallery-status");
            if (!loadingStatus || !loadingStatus.textContent.includes("Loading")) {
                return;
            }
            const status = document.createElement("p");
            status.className = "gallery-status";
            status.textContent = "School photos are temporarily unavailable. Please try again later.";
            loadingStatus.replaceWith(status);
        });
    }
}

loadSiteContent();

const enquiryForm = document.querySelector("#enquiry-form");
if (enquiryForm) {
    const enquiryStatus = document.querySelector("#enquiry-status");
    const submitButton = enquiryForm.querySelector('button[type="submit"]');
    enquiryForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const enquiry = Object.fromEntries(new FormData(enquiryForm).entries());
        submitButton.disabled = true;
        enquiryStatus.className = "enquiry-status";
        enquiryStatus.textContent = "Sending your enquiry…";

        try {
            const response = await fetch("/api/enquiries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(enquiry),
            });
            if (!response.headers.get("content-type")?.includes("application/json")) {
                throw new Error("The enquiry service is unavailable. Start the website backend and try again.");
            }
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Your enquiry could not be sent. Please try again.");
            }
            enquiryForm.reset();
            enquiryStatus.classList.add("is-success");
            enquiryStatus.textContent = result.message;
        } catch (error) {
            console.error(error);
            enquiryStatus.classList.add("is-error");
            enquiryStatus.textContent = error instanceof TypeError
                ? "Could not connect to the enquiry service. Start the website backend and try again."
                : error.message;
        } finally {
            submitButton.disabled = false;
        }
    });
}