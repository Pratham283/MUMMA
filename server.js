require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const scrypt = promisify(crypto.scrypt);

const app = express();
const rootDirectory = __dirname;
const dataDirectory = path.join(rootDirectory, "data");
const databasePath = process.env.ENQUIRY_DB_PATH || path.join(dataDirectory, "enquiries.sqlite");
const legacySiteContentPath = process.env.SITE_CONTENT_PATH || path.join(dataDirectory, "site-content.json");
const port = Number(process.env.PORT) || 3001;
const maxRequestBytes = 256 * 1024;
const sessionLifetime = 60 * 60 * 1000;
const sessionSecret = process.env.SESSION_SECRET;
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const bootstrapAdminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
const trustProxyHops = process.env.TRUST_PROXY_HOPS;

const publicFiles = new Set([
    "activities.html",
    "activity-finger-painting.jpeg",
    "activity-mystery-box.jpeg",
    "activity-table-manners.jpeg",
    "admin-activities.html",
    "admin-documents.html",
    "admin-events.html",
    "admin-gallery.html",
    "admin-notices.html",
    "admin-slideshow.html",
    "admin.css",
    "admin.html",
    "admin.js",
    "admission.html",
    "events.html",
    "founder-harshita-portrait.jpeg",
    "founder-harshita.jpeg",
    "founder-pankaj.jpeg",
    "gallery.html",
    "index.html",
    "logo.png",
    "notices.html",
    "robots.txt",
    "school-building.jpeg",
    "script.js",
    "style.css",
]);

if (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith("replace-this")) {
    throw new Error("Set SESSION_SECRET to a unique random secret of at least 32 characters.");
}
if (process.env.NODE_ENV === "production") {
    if (sessionSecret.length < 64 || new Set(sessionSecret).size < 16) {
        throw new Error("Production SESSION_SECRET must be generated from at least 48 random bytes.");
    }
    if (!/^[1-9]\d*$/.test(trustProxyHops || "")) {
        throw new Error("Set TRUST_PROXY_HOPS to the exact positive number of trusted HTTPS proxy hops.");
    }
    const trustedProxyCount = Number(trustProxyHops);
    if (!Number.isSafeInteger(trustedProxyCount)) {
        throw new Error("TRUST_PROXY_HOPS must be a safe positive integer.");
    }
    app.set("trust proxy", trustedProxyCount);
} else if (trustProxyHops) {
    if (!/^[1-9]\d*$/.test(trustProxyHops)) {
        throw new Error("TRUST_PROXY_HOPS must be a positive integer.");
    }
    app.set("trust proxy", Number(trustProxyHops));
}

app.disable("x-powered-by");
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            imgSrc: ["'self'", "data:", "https:"],
            mediaSrc: ["'self'", "https:"],
        },
    },
}));
app.use(express.json({ limit: maxRequestBytes, strict: true }));

let database;
let insertEnquiry;
let dummyPasswordHash;
let findAdminByEmail;
let findAdminById;
let findAdminSession;
let insertAdminSession;
let listEnquiries;
let deleteAdminSession;
let deleteExpiredSessions;
let findSiteContent;
let saveSiteContentStatement;
let findHeroSlides;
let findHeroSettings;
let listDocuments;
let findDocument;
let saveDocument;
let deleteDocument;
let findMedia;
let findMediaMeta;
let findMediaRange;
let saveMedia;
let deleteMedia;
let saveHeroSettingsStatement;
let saveHeroSlidesStatement;
const enquiryRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many enquiries. Please try again in a little while." },
});
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please try again later." },
});
const csrfRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many admin session requests. Please try again later." },
});

const enquiryStatement = `
    INSERT INTO enquiries (
        student_name, parent_name, phone, email, grade, address, pin_code, message
    ) VALUES (
        @studentName, @parentName, @phone, @email, @grade, @address, @pinCode, @message
    )
`;

const defaultSiteContent = {
    notices: [],
    heroSlides: [
        {
            id: "school-welcome",
            type: "image",
            src: "/school-building.jpeg",
            alt: "Mumma's Proud Junior Wing School building in Gwalior",
        },
        {
            id: "learning-together",
            type: "image",
            src: "/activity-table-manners.jpeg",
            alt: "Children learning table manners together at school",
        },
        {
            id: "curious-learners",
            type: "image",
            src: "/activity-mystery-box.jpeg",
            alt: "Children exploring a mystery learning box with their teacher",
        },
    ],
    activities: [
        {
            id: "table-manners",
            title: "Table Manners",
            category: "Everyday life skills",
            description: "Children practise polite mealtime habits, sharing, and using tableware with careâ€”building independence and respect for others.",
            image: "/activity-table-manners.jpeg",
            alt: "Children practising table manners together at school",
        },
        {
            id: "mystery-box",
            title: "Mystery Box",
            category: "Curiosity & discovery",
            description: "Guessing what is inside encourages children to observe, describe what they notice, ask questions, and express their ideas with confidence.",
            image: "/activity-mystery-box.jpeg",
            alt: "Children exploring a mystery learning box with their teacher",
        },
        {
            id: "finger-activity",
            title: "Finger Activity",
            category: "Creative exploration",
            description: "Hands-on finger activities help little learners practise fine motor control and handâ€“eye coordination while exploring colour, texture, and creativity.",
            image: "/activity-finger-painting.jpeg",
            alt: "Children taking part in a colourful finger activity",
        },
    ],
    events: [],
    gallery: [
        {
            id: "school",
            title: "A happy place to grow",
            caption: "Welcome to our school",
            image: "/school-building.jpeg",
            alt: "The Mumma's Proud Junior Wing School building",
        },
        {
            id: "table-manners",
            title: "Table manners",
            caption: "Everyday life skills",
            image: "/activity-table-manners.jpeg",
            alt: "Children learning table manners together at school",
        },
        {
            id: "mystery-box",
            title: "Mystery box",
            caption: "Curiosity in action",
            image: "/activity-mystery-box.jpeg",
            alt: "Children discovering objects in a mystery learning box",
        },
        {
            id: "finger-activity",
            title: "Finger activity",
            caption: "Learning by creating",
            image: "/activity-finger-painting.jpeg",
            alt: "Young children sharing their work during a finger activity",
        },
        {
            id: "republic-day",
            title: "Republic Day",
            caption: "School celebration",
            image: "/founder-harshita.jpeg",
            alt: "A teacher at the school's Republic Day celebration",
        },
    ],
};

const databaseContentSections = ["notices", "activities", "events", "gallery"];
const contentSections = new Set([...databaseContentSections, "heroSlides"]);

function validateContentItems(section, items) {
    const maximumItems = section === "heroSlides" ? 5 : 100;
    if (!contentSections.has(section) || !Array.isArray(items) || items.length > maximumItems) {
        return { error: "The content submitted is not valid." };
    }

    const ids = new Set();
    const content = [];
    for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item) ||
            typeof item.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(item.id) || ids.has(item.id)) {
            return { error: "Each content item must have a unique valid ID." };
        }
        ids.add(item.id);
        const text = (key, maximum, required = true) => {
            if (typeof item[key] !== "string") {
                return null;
            }
            const value = item[key].trim();
            return value && value.length <= maximum ? value : (!required && !value ? "" : null);
        };

        let validated;
        if (section === "notices") {
            const title = text("title", 120);
            const body = text("body", 2000);
            const date = text("date", 10);
            const priority = item.priority;
            const parsedDate = date ? new Date(`${date}T00:00:00Z`) : null;
            if (!title || !body || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date ||
                !["normal", "important", "urgent"].includes(priority)) {
                return { error: "Check each notice title, message, date, and priority." };
            }
            validated = { id: item.id, title, body, date, priority };
        } else if (section === "heroSlides") {
            const src = text("src", 2048) || text("image", 2048);
            const alt = item.alt === undefined ? "" : text("alt", 250, false);
            const imagePattern = /\.(?:jpe?g|png|webp)$/i;
            const videoPattern = /\.(?:mp4|webm)$/i;
            const type = item.type === "video" || (item.type === undefined && src && videoPattern.test(src)) ? "video" : "image";
            const extensionPattern = type === "video" ? videoPattern : imagePattern;
            let isHttpsMedia = false;
            if (src?.startsWith("https://")) {
                try {
                    const mediaUrl = new URL(src);
                    isHttpsMedia = !mediaUrl.username && !mediaUrl.password && extensionPattern.test(mediaUrl.pathname);
                } catch {
                    isHttpsMedia = false;
                }
            }
            const isLocalMedia = src && /^\/(?:slides\/|uploads\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(src) && extensionPattern.test(src);
            if (!src || alt === null || (!isLocalMedia && !isHttpsMedia)) {
                return { error: "Each slide needs a valid photo or video (JPG, PNG, WEBP, MP4 or WEBM)." };
            }
            validated = { id: item.id, type, src, alt };
        } else {
            const title = text("title", 100);
            const captionOrCategory = section === "events" ? text("date", 10) : text(section === "activities" ? "category" : "caption", 120);
            const image = text("image", 2048);
            const alt = text("alt", 250, false);
            let isHttpsImage = false;
            if (image?.startsWith("https://")) {
                try {
                    const imageUrl = new URL(image);
                    isHttpsImage = imageUrl.protocol === "https:" && !imageUrl.username && !imageUrl.password;
                } catch {
                    isHttpsImage = false;
                }
            }
            const isLocalImage = image && /^\/(?:uploads\/)?[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(image);
            if (!title || !captionOrCategory || !image || alt === null || (!isLocalImage && !isHttpsImage)) {
                return { error: "Check each item title, caption/category, and secure image URL." };
            }
            if (section === "activities" || section === "events") {
                const description = text("description", 1500);
                if (!description) {
                    return { error: "Each activity or event needs a description." };
                }
                if (section === "events") {
                    const parsedDate = new Date(`${captionOrCategory}T00:00:00Z`);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(captionOrCategory) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== captionOrCategory) {
                        return { error: "Each event needs a valid date." };
                    }
                    validated = { id: item.id, title, date: captionOrCategory, description, image, alt };
                } else {
                    validated = { id: item.id, title, category: captionOrCategory, description, image, alt };
                }
            } else {
                validated = { id: item.id, title, caption: captionOrCategory, image, alt };
            }
        }
        content.push(validated);
    }
    return { content };
}

function readSiteContent() {
    const content = Object.fromEntries(databaseContentSections.map((section) => {
        const row = findSiteContent.get(section);
        if (!row) {
            throw new Error(`The ${section} content is missing from the database.`);
        }
        const items = JSON.parse(row.items_json);
        const { content, error } = validateContentItems(section, items);
        if (error) {
            throw new Error(`The ${section} content in the database is invalid: ${error}`);
        }
        return [section, content];
    }));
    const slideRow = findHeroSlides.get();
    if (!slideRow) {
        throw new Error("The hero slideshow content is missing from the database.");
    }
    const slides = JSON.parse(slideRow.items_json);
    const { content: heroSlides, error } = validateContentItems("heroSlides", slides);
    if (error) {
        throw new Error(`The hero slideshow content in the database is invalid: ${error}`);
    }
    return { ...content, heroSlides, heroSlideSeconds: findHeroSettings.get().seconds };
}

function removeUnusedMedia() {
    const content = readSiteContent();
    const used = new Set(JSON.stringify(content).match(/[a-f0-9]{32}\.(?:jpg|png|webp|mp4|webm)/g) || []);
    const stale = database.prepare("SELECT name FROM media_files WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')").all();
    for (const { name } of stale) {
        if (!used.has(name)) {
            deleteMedia.run(name);
        }
    }
}

function saveContentSection(section, items) {
    if (section === "heroSlides") {
        saveHeroSlidesStatement.run(JSON.stringify(items));
    } else {
        saveSiteContentStatement.run(section, JSON.stringify(items));
    }
    removeUnusedMedia();
    return items;
}

function validateEnquiry(body) {
    const enquiry = {
        studentName: typeof body.studentName === "string" ? body.studentName.trim() : "",
        parentName: typeof body.parentName === "string" ? body.parentName.trim() : "",
        phone: typeof body.phone === "string" ? body.phone.trim() : "",
        email: typeof body.email === "string" ? body.email.trim().toLowerCase() : "",
        grade: typeof body.grade === "string" ? body.grade.trim() : "",
        address: typeof body.address === "string" ? body.address.trim() : "",
        pinCode: typeof body.pinCode === "string" ? body.pinCode.trim() : "",
        message: typeof body.message === "string" ? body.message.trim() : "",
    };

    if (body.consent !== "yes") {
        return { error: "Please tick the consent box so we can use your details to respond." };
    }
    if (!enquiry.studentName || enquiry.studentName.length > 100) {
        return { error: "Enter the student's name (up to 100 characters)." };
    }
    if (!enquiry.parentName || enquiry.parentName.length > 100) {
        return { error: "Enter a parent or guardian name (up to 100 characters)." };
    }
    if (!/^\+?[0-9\s()-]{7,25}$/.test(enquiry.phone)) {
        return { error: "Enter a valid phone number." };
    }
    if (enquiry.email.length > 254 || (enquiry.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiry.email))) {
        return { error: "Enter a valid email address, or leave it blank." };
    }
    if (!["Playgroup", "Nursery", "LKG", "UKG", "Class 1â€“5"].includes(enquiry.grade)) {
        return { error: "Choose a valid class of interest." };
    }
    if (!enquiry.address || enquiry.address.length > 300) {
        return { error: "Enter an address (up to 300 characters)." };
    }
    if (!/^[0-9]{6}$/.test(enquiry.pinCode)) {
        return { error: "Enter a valid 6-digit PIN code." };
    }
    if (enquiry.message.length > 2000) {
        return { error: "Keep your message under 2,000 characters." };
    }
    return { enquiry };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    return scrypt(password, salt, 64).then((hash) => `scrypt$${salt}$${hash.toString("hex")}`);
}

async function verifyPassword(password, encodedHash) {
    const [algorithm, salt, expectedHex] = encodedHash.split("$");
    if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expectedHex)) {
        return false;
    }
    const actual = await scrypt(password, salt, 64);
    const expected = Buffer.from(expectedHex, "hex");
    return crypto.timingSafeEqual(actual, expected);
}

function signSessionId(sessionId) {
    return crypto.createHmac("sha256", sessionSecret).update(sessionId).digest("hex");
}

function safeEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") {
        return false;
    }
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: sessionLifetime,
    };
}

function readSessionCookie(req) {
    const cookie = req.headers.cookie?.split(";").map((part) => part.trim())
        .find((part) => part.startsWith("school_admin="));
    if (!cookie) {
        return null;
    }

    const value = cookie.slice("school_admin=".length);
    const separator = value.lastIndexOf(".");
    if (separator < 1) {
        return null;
    }
    const sessionId = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    if (!/^[a-f0-9]{64}$/.test(sessionId) || !safeEqual(signature, signSessionId(sessionId))) {
        return null;
    }
    return sessionId;
}

function setSessionCookie(res, sessionId) {
    res.cookie("school_admin", `${sessionId}.${signSessionId(sessionId)}`, sessionCookieOptions());
}

function clearSessionCookie(res) {
    res.clearCookie("school_admin", { ...sessionCookieOptions(), maxAge: undefined });
}

function createSession(adminId = null) {
    const sessionId = crypto.randomBytes(32).toString("hex");
    const csrfToken = crypto.randomBytes(32).toString("hex");
    insertAdminSession.run({
        sessionId,
        adminId,
        csrfToken,
        expiresAt: Date.now() + sessionLifetime,
    });
    return { sessionId, csrfToken };
}

function loadAdminSession(req, res, next) {
    const sessionId = readSessionCookie(req);
    req.adminSession = sessionId ? findAdminSession.get(sessionId, Date.now()) || null : null;
    if (req.adminSession) {
        res.cookie("school_admin", `${sessionId}.${signSessionId(sessionId)}`, sessionCookieOptions());
    }
    next();
}

function validateAdminMutation(req, res, next) {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;
    const configuredOrigins = (process.env.ADMIN_ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (!origin || (origin !== expectedOrigin && !configuredOrigins.includes(origin))) {
        return res.status(403).json({ error: "This request is not allowed." });
    }
    if (!req.adminSession || !safeEqual(req.get("x-csrf-token"), req.adminSession.csrf_token)) {
        return res.status(403).json({ error: "Your session expired. Refresh the page and try again." });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.adminSession?.admin_id) {
        return res.status(401).json({ error: "Please sign in to view enquiries." });
    }
    req.admin = findAdminById.get(req.adminSession.admin_id);
    if (!req.admin) {
        return res.status(401).json({ error: "Please sign in to continue." });
    }
    next();
}

app.use("/api/admin", loadAdminSession);

app.get("/api/health", (req, res) => {
    database.prepare("SELECT 1").get();
    res.json({ status: "ok" });
});

const documentKinds = new Set(["book-list", "fee-structure", "admission-form"]);
const maximumDocumentBytes = 10 * 1024 * 1024;
const maximumImageBytes = 15 * 1024 * 1024;
const maximumVideoBytes = 500 * 1024 * 1024;
const startsWith = (file, bytes, offset = 0) => bytes.every((byte, index) => file[offset + index] === byte);
const mediaTypes = {
    "image/jpeg": { kind: "image", extension: "jpg", matches: (file) => startsWith(file, [0xff, 0xd8, 0xff]) },
    "image/png": { kind: "image", extension: "png", matches: (file) => startsWith(file, [0x89, 0x50, 0x4e, 0x47]) },
    "image/webp": { kind: "image", extension: "webp", matches: (file) => startsWith(file, [0x52, 0x49, 0x46, 0x46]) && startsWith(file, [0x57, 0x45, 0x42, 0x50], 8) },
    "video/mp4": { kind: "video", extension: "mp4", matches: (file) => startsWith(file, [0x66, 0x74, 0x79, 0x70], 4) },
    "video/webm": { kind: "video", extension: "webm", matches: (file) => startsWith(file, [0x1a, 0x45, 0xdf, 0xa3]) },
};

app.get("/api/documents", (req, res) => {
    res.set("Cache-Control", "no-store");
    const documents = Object.fromEntries(listDocuments.all().map((row) => [row.kind, { updatedAt: row.updated_at }]));
    res.json({ documents });
});

app.get("/documents/:file", (req, res, next) => {
    const match = /^(book-list|fee-structure|admission-form)\.pdf$/.exec(req.params.file);
    const row = match ? findDocument.get(match[1]) : null;
    if (!row) {
        return next();
    }
    res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${match[1]}.pdf"`,
        "Cache-Control": "no-cache",
    });
    res.send(Buffer.from(row.data));
});

app.get("/api/content", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(readSiteContent());
});

app.post("/api/enquiries", enquiryRateLimit, (req, res, next) => {
    const { enquiry, error } = validateEnquiry(req.body || {});
    if (error) {
        return res.status(400).json({ error });
    }

    try {
        const result = insertEnquiry.run({
            ...enquiry,
            email: enquiry.email || null,
        });
        res.status(201).json({
            message: "Thank you! Your admission enquiry has been received.",
            id: Number(result.lastInsertRowid),
        });
    } catch (databaseError) {
        next(databaseError);
    }
});

app.get("/api/admin/csrf", csrfRateLimit, (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.adminSession) {
        deleteExpiredSessions.run(Date.now());
        const created = createSession();
        setSessionCookie(res, created.sessionId);
        return res.json({ csrfToken: created.csrfToken });
    }
    res.json({ csrfToken: req.adminSession.csrf_token });
});

app.get("/api/admin/me", (req, res) => {
    if (!req.adminSession?.admin_id) {
        return res.json({ admin: null });
    }
    const admin = findAdminById.get(req.adminSession.admin_id);
    res.json({ admin: admin ? { email: admin.email } : null });
});

app.post("/api/admin/login", loginRateLimit, validateAdminMutation, async (req, res, next) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password || email.length > 254 || password.length > 256) {
        return res.status(400).json({ error: "Enter your email and password." });
    }

    try {
        const admin = findAdminByEmail.get(email);
        const passwordIsValid = await verifyPassword(password, admin?.password_hash || dummyPasswordHash);
        if (!admin || !passwordIsValid) {
            return res.status(401).json({ error: "Email or password is incorrect." });
        }

        deleteAdminSession.run(req.adminSession.session_id);
        const created = createSession(admin.id);
        setSessionCookie(res, created.sessionId);
        res.json({ admin: { email: admin.email }, csrfToken: created.csrfToken });
    } catch (error) {
        next(error);
    }
});

app.post("/api/admin/logout", validateAdminMutation, requireAdmin, (req, res) => {
    deleteAdminSession.run(req.adminSession.session_id);
    clearSessionCookie(res);
    res.json({ message: "You have been signed out." });
});

app.get("/api/admin/enquiries", requireAdmin, (req, res) => {
    res.json({
        enquiries: listEnquiries.all(),
        admin: { email: req.admin.email },
    });
});

app.use("/api/admin", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        return next();
    }
    validateAdminMutation(req, res, next);
});

app.put("/api/admin/media", requireAdmin, express.raw({ type: Object.keys(mediaTypes), limit: maximumVideoBytes }), async (req, res, next) => {
    const media = mediaTypes[req.get("content-type")?.split(";")[0].trim().toLowerCase()];
    const file = req.body;
    if (!media || !Buffer.isBuffer(file) || file.length === 0 || !media.matches(file)) {
        return res.status(400).json({ error: "Please choose a JPG, PNG, WEBP photo or an MP4, WEBM video." });
    }
    if (media.kind === "image" && file.length > maximumImageBytes) {
        return res.status(413).json({ error: "Photos must be 15 MB or smaller." });
    }
    try {
        const name = `${crypto.randomBytes(16).toString("hex")}.${media.extension}`;
        saveMedia.run(name, req.get("content-type").split(";")[0].trim().toLowerCase(), file);
        res.status(201).json({ path: `/uploads/${name}`, type: media.kind, message: "File uploaded." });
    } catch (saveError) {
        next(saveError);
    }
});

app.put("/api/admin/documents/:kind", requireAdmin, express.raw({ type: "application/pdf", limit: maximumDocumentBytes }), (req, res, next) => {
    const kind = req.params.kind;
    const file = req.body;
    if (!documentKinds.has(kind)) {
        return res.status(404).json({ error: "Unknown document." });
    }
    if (!Buffer.isBuffer(file) || file.length === 0 || file.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return res.status(400).json({ error: "Please choose a valid PDF file." });
    }
    try {
        saveDocument.run(kind, file);
        res.json({ message: "PDF saved and published." });
    } catch (saveError) {
        next(saveError);
    }
});

app.delete("/api/admin/documents/:kind", requireAdmin, (req, res, next) => {
    if (!documentKinds.has(req.params.kind)) {
        return res.status(404).json({ error: "Unknown document." });
    }
    try {
        deleteDocument.run(req.params.kind);
        res.json({ message: "PDF removed from the website." });
    } catch (deleteError) {
        next(deleteError);
    }
});

app.put("/api/admin/hero-settings", requireAdmin, (req, res, next) => {
    const seconds = req.body?.seconds;
    if (!Number.isInteger(seconds) || seconds < 2 || seconds > 30) {
        return res.status(400).json({ error: "Choose a slide time between 2 and 30 seconds." });
    }
    try {
        saveHeroSettingsStatement.run(seconds);
        res.json({ seconds, message: "Slide time saved and published." });
    } catch (saveError) {
        next(saveError);
    }
});

app.put("/api/admin/content/:section", requireAdmin, (req, res, next) => {
    const section = req.params.section;
    const { content, error } = validateContentItems(section, req.body?.items);
    if (error) {
        return res.status(400).json({ error });
    }
    try {
        const items = saveContentSection(section, content);
        res.json({ items, message: "Changes saved and published." });
    } catch (saveError) {
        next(saveError);
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(rootDirectory, "index.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(rootDirectory, "admin.html"));
});

app.use("/slides", express.static(path.join(rootDirectory, "slides"), {
    index: false,
    dotfiles: "ignore",
    redirect: false,
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
}));

app.get("/uploads/:file", (req, res, next) => {
    const meta = /^[a-f0-9]{32}\.(?:jpg|png|webp|mp4|webm)$/.test(req.params.file) ? findMediaMeta.get(req.params.file) : null;
    if (!meta) {
        return next();
    }
    const size = meta.size;
    res.set({
        "Content-Type": meta.content_type,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Content-Type-Options": "nosniff",
    });
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.get("range") || "");
    if (!range || (range[1] === "" && range[2] === "")) {
        return res.send(Buffer.from(findMedia.get(req.params.file).data));
    }
    const start = range[1] === "" ? Math.max(size - Number(range[2]), 0) : Number(range[1]);
    const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start >= size || start > end) {
        res.set("Content-Range", `bytes */${size}`);
        return res.sendStatus(416);
    }
    const part = findMediaRange.get(start + 1, end - start + 1, req.params.file);
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`).send(Buffer.from(part.data));
});

app.get("/:file", (req, res, next) => {
    if (!publicFiles.has(req.params.file)) {
        return next();
    }
    res.sendFile(path.join(rootDirectory, req.params.file), (error) => {
        if (error) {
            next(error);
        }
    });
});

app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "API endpoint not found." });
    }
    res.sendStatus(404);
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }
    if (error.type === "entity.too.large") {
        return res.status(413).json({ error: "The submitted file or request is too large (PDFs up to 10 MB, photos up to 15 MB, videos up to 500 MB)." });
    }
    if (error.type === "entity.parse.failed") {
        return res.status(400).json({ error: "The submitted request is not valid JSON." });
    }
    console.error("Request failed:", error.message);
    res.status(500).json({ error: "The request could not be completed. Please try again later." });
});

async function startServer() {
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const databaseFile = await fs.open(databasePath, "a", 0o600);
    try {
        await databaseFile.chmod(0o600);
    } finally {
        await databaseFile.close();
    }
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS enquiries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_name TEXT NOT NULL CHECK(length(student_name) BETWEEN 1 AND 100),
            parent_name TEXT NOT NULL CHECK(length(parent_name) BETWEEN 1 AND 100),
            phone TEXT NOT NULL CHECK(length(phone) BETWEEN 7 AND 25),
            email TEXT,
            grade TEXT NOT NULL CHECK(grade IN ('Playgroup', 'Nursery', 'LKG', 'UKG', 'Kindergarten', 'Class 1â€“5')),
            address TEXT NOT NULL CHECK(length(address) BETWEEN 1 AND 300),
            pin_code TEXT NOT NULL CHECK(length(pin_code) = 6 AND pin_code NOT GLOB '*[^0-9]*'),
            message TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 2000),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS enquiries_created_at ON enquiries(created_at DESC);
        CREATE TABLE IF NOT EXISTS site_content (
            section TEXT PRIMARY KEY CHECK(section IN ('notices', 'activities', 'events', 'gallery')),
            items_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS hero_slides (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            items_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS hero_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            seconds INTEGER NOT NULL CHECK(seconds BETWEEN 2 AND 30)
        );
        INSERT OR IGNORE INTO hero_settings (id, seconds) VALUES (1, 3);
        CREATE TABLE IF NOT EXISTS admission_documents (
            kind TEXT PRIMARY KEY CHECK(kind IN ('book-list', 'fee-structure', 'admission-form')),
            data BLOB NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS media_files (
            name TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            data BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS admin_sessions (
            session_id TEXT PRIMARY KEY,
            admin_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
            csrf_token TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
        DROP TABLE IF EXISTS admin_password_resets;
    `);
    if (!database.prepare("SELECT sql FROM sqlite_master WHERE name = 'site_content'").get().sql.includes("'events'")) {
        database.exec(`
            BEGIN IMMEDIATE;
            ALTER TABLE site_content RENAME TO site_content_old;
            CREATE TABLE site_content (
                section TEXT PRIMARY KEY CHECK(section IN ('notices', 'activities', 'events', 'gallery')),
                items_json TEXT NOT NULL
            );
            INSERT INTO site_content (section, items_json) SELECT section, items_json FROM site_content_old;
            DROP TABLE site_content_old;
            COMMIT;
        `);
    }
    findSiteContent = database.prepare("SELECT items_json FROM site_content WHERE section = ?");
    saveSiteContentStatement = database.prepare(`
        INSERT INTO site_content (section, items_json) VALUES (?, ?)
        ON CONFLICT(section) DO UPDATE SET items_json = excluded.items_json
    `);
    findHeroSettings = database.prepare("SELECT seconds FROM hero_settings WHERE id = 1");
    listDocuments = database.prepare("SELECT kind, updated_at FROM admission_documents");
    findDocument = database.prepare("SELECT data, updated_at FROM admission_documents WHERE kind = ?");
    saveDocument = database.prepare(`
        INSERT INTO admission_documents (kind, data, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);
    deleteDocument = database.prepare("DELETE FROM admission_documents WHERE kind = ?");
    findMedia = database.prepare("SELECT content_type, data FROM media_files WHERE name = ?");
    findMediaMeta = database.prepare("SELECT content_type, length(data) AS size FROM media_files WHERE name = ?");
    findMediaRange = database.prepare("SELECT substr(data, ?, ?) AS data FROM media_files WHERE name = ?");
    saveMedia = database.prepare("INSERT INTO media_files (name, content_type, data) VALUES (?, ?, ?)");
    deleteMedia = database.prepare("DELETE FROM media_files WHERE name = ?");
    saveHeroSettingsStatement = database.prepare("UPDATE hero_settings SET seconds = ? WHERE id = 1");
    findHeroSlides = database.prepare("SELECT items_json FROM hero_slides WHERE id = 1");
    saveHeroSlidesStatement = database.prepare(`
        INSERT INTO hero_slides (id, items_json) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET items_json = excluded.items_json
    `);
    const storedSections = database.prepare("SELECT COUNT(*) AS count FROM site_content").get().count;
    if (storedSections === 0) {
        let initialContent = defaultSiteContent;
        try {
            const storedContent = JSON.parse(await fs.readFile(legacySiteContentPath, "utf8"));
            initialContent = {};
            for (const section of databaseContentSections) {
                const { content, error } = validateContentItems(section, storedContent[section] ?? defaultSiteContent[section]);
                if (error) {
                    throw new Error(`Invalid ${section} in ${legacySiteContentPath}: ${error}`);
                }
                initialContent[section] = content;
            }
            const legacySlides = Array.isArray(storedContent.heroSlides)
                ? storedContent.heroSlides
                : defaultSiteContent.heroSlides;
            const { content: heroSlides, error } = validateContentItems("heroSlides", legacySlides);
            if (error) {
                throw new Error(`Invalid heroSlides in ${legacySiteContentPath}: ${error}`);
            }
            initialContent.heroSlides = heroSlides;
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }

        database.exec("BEGIN IMMEDIATE;");
        try {
            for (const section of databaseContentSections) {
                saveSiteContentStatement.run(section, JSON.stringify(initialContent[section]));
            }
            saveHeroSlidesStatement.run(JSON.stringify(initialContent.heroSlides));
            database.exec("COMMIT;");
        } catch (error) {
            database.exec("ROLLBACK;");
            throw error;
        }
    }
    if (!findHeroSlides.get()) {
        let initialSlides = defaultSiteContent.heroSlides;
        try {
            const storedContent = JSON.parse(await fs.readFile(legacySiteContentPath, "utf8"));
            if (Array.isArray(storedContent.heroSlides)) {
                const { content, error } = validateContentItems("heroSlides", storedContent.heroSlides);
                if (error) {
                    throw new Error(`Invalid heroSlides in ${legacySiteContentPath}: ${error}`);
                }
                initialSlides = content;
            }
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
        saveHeroSlidesStatement.run(JSON.stringify(initialSlides));
    }
    if (!findSiteContent.get("events")) {
        saveSiteContentStatement.run("events", "[]");
    }
    readSiteContent();
    insertEnquiry = database.prepare(enquiryStatement);
    findAdminByEmail = database.prepare("SELECT id, email, password_hash FROM admin_users WHERE email = ?");
    findAdminById = database.prepare("SELECT id, email FROM admin_users WHERE id = ?");
    findAdminSession = database.prepare("SELECT * FROM admin_sessions WHERE session_id = ? AND expires_at > ?");
    insertAdminSession = database.prepare(`
        INSERT INTO admin_sessions (session_id, admin_id, csrf_token, expires_at)
        VALUES (@sessionId, @adminId, @csrfToken, @expiresAt)
    `);
    deleteAdminSession = database.prepare("DELETE FROM admin_sessions WHERE session_id = ?");
    deleteExpiredSessions = database.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?");
    listEnquiries = database.prepare(`
        SELECT id, student_name AS studentName, parent_name AS parentName, phone, email,
               grade, address, pin_code AS pinCode, message, created_at AS createdAt
        FROM enquiries
        ORDER BY created_at DESC, id DESC
        LIMIT 5000
    `);

    const adminCount = database.prepare("SELECT COUNT(*) AS count FROM admin_users").get().count;
    if (adminCount === 0 && adminEmail && bootstrapAdminPasswordHash) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) ||
            !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(bootstrapAdminPasswordHash)) {
            throw new Error("ADMIN_EMAIL or ADMIN_PASSWORD_HASH in .env is invalid.");
        }
        database.prepare("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)")
            .run(adminEmail, bootstrapAdminPasswordHash);
        console.log(`Created the initial enquiry admin account for ${adminEmail}.`);
    } else if (adminCount === 0) {
        console.warn("No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH in .env, then restart.");
    }
    const resetPassword = process.env.ADMIN_RESET_PASSWORD;
    if (resetPassword) {
        if (!adminEmail || resetPassword.length < 12 || resetPassword.length > 256) {
            throw new Error("ADMIN_RESET_PASSWORD needs ADMIN_EMAIL and a password of 12 to 256 characters.");
        }
        const existing = findAdminByEmail.get(adminEmail);
        if (!existing) {
            database.prepare("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)")
                .run(adminEmail, await hashPassword(resetPassword));
            console.log(`Created the admin account for ${adminEmail} from ADMIN_RESET_PASSWORD.`);
        } else if (!(await verifyPassword(resetPassword, existing.password_hash))) {
            database.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?")
                .run(await hashPassword(resetPassword), existing.id);
            database.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").run(existing.id);
            console.log(`Admin password for ${adminEmail} was reset from ADMIN_RESET_PASSWORD.`);
        }
    }
    deleteExpiredSessions.run(Date.now());
    dummyPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));

    const server = app.listen(port, () => {
        console.log(`School website is running at http://localhost:${port}`);
        console.log(`Admission enquiries are stored in ${databasePath}`);
        console.log(`Enquiry admin panel: http://localhost:${port}/admin`);
    });
    server.on("error", (error) => {
        console.error("Could not start the website:", error.message);
        database.close();
        process.exitCode = 1;
    });
}

startServer().catch((error) => {
    console.error("Could not start the website:", error.message);
    database?.close();
    process.exitCode = 1;
});
