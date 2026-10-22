
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

function observeGalleryItems(items) {
    const galleryGrid = document.querySelector(".gallery-grid");
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

const galleryGrid = document.querySelector(".gallery-grid");
if (galleryGrid && !galleryGrid.hasAttribute("data-gallery-preview")) {
    fetch("/api/gallery")
        .then(async (response) => {
            if (!response.ok) {
                throw new Error("Could not load the school gallery.");
            }
            return response.json();
        })
        .then(({ images }) => {
            if (!Array.isArray(images)) {
                throw new Error("The gallery response was invalid.");
            }

            if (images.length === 0) {
                const empty = document.createElement("p");
                empty.className = "gallery-status";
                empty.textContent = "New school memories will be added to the gallery soon.";
                galleryGrid.replaceChildren(empty);
                const headingDescription = document.querySelector(".gallery-heading > p:last-child");
                if (headingDescription) {
                    headingDescription.textContent = "New school moments will be added to the gallery soon.";
                }
                return;
            }

            const cards = images.map((image, index) => {
                const card = document.createElement("figure");
                card.className = "gallery-item";

                const photo = document.createElement("img");
                photo.src = image.imagePath;
                photo.alt = image.title;
                photo.loading = index === 0 ? "eager" : "lazy";
                photo.decoding = "async";

                const caption = document.createElement("figcaption");
                const category = document.createElement("span");
                category.textContent = image.caption || "School memories";
                const title = document.createElement("h3");
                title.textContent = image.title;

                caption.append(category, title);
                card.append(photo, caption);
                return card;
            });

            galleryGrid.replaceChildren(...cards);
            observeGalleryItems(cards);
        })
        .catch((error) => {
            console.error(error);
            const status = document.createElement("p");
            status.className = "gallery-status";
            status.setAttribute("role", "status");
            status.textContent = "School photos could not be loaded. Please try again later.";
            galleryGrid.replaceChildren(status);
            observeGalleryItems([...galleryGrid.querySelectorAll(".gallery-item")]);
        });
} else if (galleryGrid) {
    observeGalleryItems([...galleryGrid.querySelectorAll(".gallery-item")]);
}

function buildActivityCard(activity, index) {
    const card = document.createElement("article");
    card.className = "activity-card";

    const photo = document.createElement("div");
    photo.className = "activity-photo";
    const image = document.createElement("img");
    image.src = activity.imagePath;
    image.alt = activity.title;
    image.loading = index < 3 ? "eager" : "lazy";
    image.decoding = "async";

    const number = document.createElement("span");
    number.className = "activity-number";
    number.textContent = String(index + 1).padStart(2, "0");
    photo.append(image, number);

    const details = document.createElement("div");
    details.className = "activity-info";
    const category = document.createElement("p");
    category.className = "activity-category";
    category.textContent = activity.category || "School activity";
    const title = document.createElement("h3");
    title.textContent = activity.title;
    const description = document.createElement("p");
    description.textContent = activity.description;
    details.append(category, title, description);
    card.append(photo, details);
    return card;
}

const activitiesList = document.querySelector(".activities-page-grid");
const homeActivities = document.querySelector("#home-activities");
const activityGrid = activitiesList || homeActivities;
if (activityGrid) {
    fetch("/api/activities")
        .then(async (response) => {
            if (!response.ok) {
                throw new Error("Could not load school activities.");
            }
            return response.json();
        })
        .then(({ activities }) => {
            if (!Array.isArray(activities)) {
                throw new Error("The activities response was invalid.");
            }

            const visibleActivities = activitiesList ? activities : activities.slice(0, 3);
            if (visibleActivities.length === 0) {
                const empty = document.createElement("p");
                empty.className = "activity-status";
                empty.textContent = "New school activities will be added soon.";
                activityGrid.replaceChildren(empty);
                return;
            }

            activityGrid.replaceChildren(...visibleActivities.map(buildActivityCard));
        })
        .catch((error) => {
            console.error(error);
            const status = document.createElement("p");
            status.className = "activity-status activity-status-error";
            status.setAttribute("role", "status");
            status.textContent = "School activities could not be loaded. Please try again later.";
            activityGrid.replaceChildren(status);
        });
}

function formatNoticeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? ""
        : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function buildNoticeCard(notice) {
    const card = document.createElement("article");
    card.className = `notice-card notice-card-${notice.priority}`;

    const content = document.createElement("div");
    content.className = "notice-card-content";

    const meta = document.createElement("div");
    meta.className = "notice-card-meta";
    const priority = document.createElement("span");
    priority.className = "notice-priority";
    priority.textContent = notice.priority === "urgent"
        ? "Urgent notice"
        : notice.priority === "important" ? "Important notice" : "School notice";
    const date = document.createElement("time");
    date.dateTime = notice.publishedAt;
    date.textContent = formatNoticeDate(notice.publishedAt);
    meta.append(priority, date);

    const title = document.createElement("h3");
    title.textContent = notice.title;
    const body = document.createElement("p");
    body.className = "notice-card-body";
    body.textContent = notice.body;
    content.append(meta, title, body);
    card.append(content);

    if (notice.expiresAt) {
        const expiry = document.createElement("p");
        expiry.className = "notice-expiry";
        expiry.textContent = `Until ${formatNoticeDate(notice.expiresAt)}`;
        card.append(expiry);
    }

    return card;
}

async function loadPublicNotices(element, limit) {
    try {
        const endpoint = limit ? `/api/notices?limit=${limit}` : "/api/notices";
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error("School notices could not be loaded right now.");
        }
        const { notices } = await response.json();
        if (!Array.isArray(notices)) {
            throw new Error("The school notices response was invalid.");
        }

        if (notices.length === 0) {
            const empty = document.createElement("p");
            empty.className = "notice-empty";
            empty.textContent = "There are no current school notices. Please check again soon.";
            element.replaceChildren(empty);
            return;
        }

        const cards = notices.map(buildNoticeCard);
        element.replaceChildren(...cards);
    } catch (error) {
        console.error(error);
        const message = document.createElement("p");
        message.className = "notice-error";
        message.setAttribute("role", "status");
        message.textContent = error.message;
        element.replaceChildren(message);
    }
}

const noticePreview = document.querySelector("#notice-preview-list");
if (noticePreview) {
    loadPublicNotices(noticePreview, 3);
}

const noticePageList = document.querySelector("#notices-page-list");
if (noticePageList) {
    loadPublicNotices(noticePageList);
}

const enquiryForm = document.querySelector("#enquiry-form");
if (enquiryForm) {
    const enquiryStatus = document.querySelector("#enquiry-status");
    enquiryForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = enquiryForm.querySelector('button[type="submit"]');
        const formData = new FormData(enquiryForm);
        const enquiry = Object.fromEntries(formData.entries());
        submitButton.disabled = true;
        enquiryStatus.className = "enquiry-status";
        enquiryStatus.textContent = "Sending your enquiry…";

        try {
            const response = await fetch("/api/enquiries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(enquiry),
            });
            const responseText = await response.text();
            if (response.status === 405) {
                throw new Error("This page is not connected to the school's Node.js enquiry service. Run `npm start` in the website folder, then open http://localhost:3001/admission.html. For a live site, route /api requests to the Node.js server.");
            }
            let result = {};
            if (responseText) {
                try {
                    result = JSON.parse(responseText);
                } catch {
                    throw new Error(response.ok
                        ? "The server returned an unreadable response. Your enquiry may not have been received; please call the school to confirm."
                        : `The server could not process your enquiry (HTTP ${response.status}). Please try again later.`);
                }
            } else if (response.ok) {
                throw new Error("The server returned an empty response. Your enquiry may not have been received; please call the school to confirm.");
            }
            if (!response.ok) {
                throw new Error(result.error || `Your enquiry could not be sent (HTTP ${response.status}).`);
            }
            if (!result || typeof result.message !== "string") {
                throw new Error("The server response was incomplete. Your enquiry may not have been received; please call the school to confirm.");
            }
            enquiryForm.reset();
            enquiryStatus.classList.add("is-success");
            enquiryStatus.textContent = result.message;
        } catch (error) {
            console.error(error);
            enquiryStatus.classList.add("is-error");
            enquiryStatus.textContent = error.message || "Your enquiry could not be sent. Please try again.";
        } finally {
            submitButton.disabled = false;
        }
    });
}