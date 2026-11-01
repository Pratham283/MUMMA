
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

document.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
    const toggle = dropdown.querySelector(".nav-dropdown-toggle");
    const setOpen = (open) => {
        dropdown.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => setOpen(!dropdown.classList.contains("is-open")));
    dropdown.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setOpen(false);
            toggle.focus();
        }
    });
    document.addEventListener("click", (event) => {
        if (!dropdown.contains(event.target)) {
            setOpen(false);
        }
    });
    dropdown.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
            setOpen(false);
        }
    });
});

async function loadAdmissionDocuments() {
    const links = [...document.querySelectorAll("[data-document-kind]")];
    if (!links.length) {
        return;
    }
    let documents = {};
    try {
        const response = await fetch("/api/documents");
        if (response.ok) {
            documents = (await response.json()).documents || {};
        }
    } catch (error) {
        console.error(error);
    }
    links.forEach((link) => {
        const entry = documents[link.dataset.documentKind];
        if (entry) {
            link.href = `/documents/${link.dataset.documentKind}.pdf?v=${encodeURIComponent(entry.updatedAt)}`;
            return;
        }
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.setAttribute("aria-disabled", "true");
        link.title = "This PDF has not been uploaded yet.";
        link.append(" (coming soon)");
    });
}

loadAdmissionDocuments();

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

function renderEvents(events) {
    const containers = document.querySelectorAll("#events-page-grid, #home-events");
    if (!containers.length) {
        return;
    }
    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const upcoming = events.filter((event) => event.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    containers.forEach((container) => {
        const isHome = container.id === "home-events";
        const shown = isHome ? upcoming.slice(0, 3) : upcoming;
        if (!shown.length) {
            const empty = document.createElement("p");
            empty.className = "gallery-status";
            empty.textContent = "There are no upcoming events right now. Please check back soon.";
            container.replaceChildren(empty);
            return;
        }
        container.replaceChildren(...shown.map((event, index) => {
            const label = new Date(`${event.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
            return makeActivityCard({ ...event, category: label }, index, isHome ? "h3" : "h2");
        }));
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

function renderHeroSlideshow(slides, seconds = 3) {
    const track = document.querySelector("#hero-slide-track");
    const dots = document.querySelector("#hero-slider-dots");
    const controls = document.querySelector("#hero-slider-controls");
    if (!track || !dots || !controls) {
        return;
    }
    if (!slides.length) {
        track.replaceChildren();
        dots.replaceChildren();
        controls.hidden = true;
        return;
    }

    let activeIndex = 0;
    let timer;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slideElements = slides.map((slide, index) => {
        const element = document.createElement("article");
        element.className = `hero-slide${index === 0 ? " is-active" : ""}`;
        element.setAttribute("aria-hidden", String(index !== 0));
        const source = slide.src || slide.image;
        let media;
        if (slide.type === "video") {
            media = document.createElement("video");
            media.src = source;
            media.muted = true;
            media.playsInline = true;
            media.preload = index === 0 ? "auto" : "metadata";
            media.setAttribute("aria-label", slide.alt || "School video");
        } else {
            media = document.createElement("img");
            media.src = source;
            media.alt = slide.alt || "";
            media.loading = index === 0 ? "eager" : "lazy";
            media.decoding = "async";
            if (index === 0) {
                media.fetchPriority = "high";
            }
        }
        element.append(media);
        return element;
    });
    const dotButtons = slides.map((slide, index) => {
        const button = document.createElement("button");
        button.className = `hero-slider-dot${index === 0 ? " is-active" : ""}`;
        button.type = "button";
        button.setAttribute("aria-label", `Show slide ${index + 1}`);
        button.setAttribute("aria-current", String(index === 0));
        button.addEventListener("click", () => showSlide(index));
        return button;
    });
    track.replaceChildren(...slideElements);
    dots.replaceChildren(...dotButtons);
    controls.hidden = slides.length < 2;

    function activeVideo() {
        const media = slideElements[activeIndex].querySelector("video");
        return media || null;
    }

    function scheduleNext() {
        window.clearTimeout(timer);
        if (slides.length < 2 || reduceMotion || document.hidden) {
            return;
        }
        if (activeVideo()) {
            timer = window.setTimeout(() => showSlide(activeIndex + 1), 60000);
        } else {
            timer = window.setTimeout(() => showSlide(activeIndex + 1), Math.min(Math.max(Number(seconds) || 3, 2), 30) * 1000);
        }
    }

    function showSlide(index) {
        activeIndex = (index + slides.length) % slides.length;
        slideElements.forEach((element, slideIndex) => {
            const isActive = slideIndex === activeIndex;
            element.classList.toggle("is-active", isActive);
            element.setAttribute("aria-hidden", String(!isActive));
            dotButtons[slideIndex].classList.toggle("is-active", isActive);
            dotButtons[slideIndex].setAttribute("aria-current", String(isActive));
            const video = element.querySelector("video");
            if (video && !isActive) {
                video.pause();
            }
        });
        const video = activeVideo();
        if (video && !reduceMotion) {
            video.loop = slides.length < 2;
            video.currentTime = 0;
            video.play().catch(() => {});
        }
        scheduleNext();
    }

    slideElements.forEach((element, slideIndex) => {
        const video = element.querySelector("video");
        if (!video) {
            return;
        }
        video.addEventListener("ended", () => {
            if (slideIndex === activeIndex && slides.length > 1) {
                showSlide(activeIndex + 1);
            }
        });
        video.addEventListener("error", () => {
            if (slideIndex === activeIndex && slides.length > 1) {
                showSlide(activeIndex + 1);
            }
        });
    });

    controls.querySelectorAll("[data-slide-step]").forEach((button) => {
        button.addEventListener("click", () => showSlide(activeIndex + Number(button.dataset.slideStep)));
    });
    document.addEventListener("visibilitychange", () => {
        const video = activeVideo();
        if (document.hidden) {
            window.clearTimeout(timer);
            video?.pause();
        } else {
            if (video && !reduceMotion) {
                video.play().catch(() => {});
            }
            scheduleNext();
        }
    });
    showSlide(0);
}

async function loadSiteContent() {
    const noticeLists = [...document.querySelectorAll("#notice-preview-list, #notices-page-list")];
    try {
        let response = await fetch("/api/content");
        if (response.status === 404) {
            response = await fetch("/data/site-content.json");
        }
        if (!response.ok) {
            throw new Error("The school website content could not be loaded.");
        }
        const content = await response.json();
        if (!Array.isArray(content.notices) || !Array.isArray(content.activities) ||
            !Array.isArray(content.gallery) || !Array.isArray(content.heroSlides)) {
            throw new Error("The school website content is not available.");
        }
        noticeLists.forEach((container) => renderNoticeList(container, content.notices));
        renderActivities(content.activities);
        renderEvents(Array.isArray(content.events) ? content.events : []);
        renderGallery(content.gallery);
        renderHeroSlideshow(content.heroSlides, content.heroSlideSeconds);
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