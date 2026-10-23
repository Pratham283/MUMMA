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
const siteContentPath = process.env.SITE_CONTENT_PATH || path.join(dataDirectory, "site-content.json");
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
    "admin.css",
    "admin.html",
    "admin.js",
    "admission.html",
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
let siteContent;
let contentWriteQueue = Promise.resolve();
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
    activities: [
        {
            id: "table-manners",
            title: "Table Manners",
            category: "Everyday life skills",
            description: "Children practise polite mealtime habits, sharing, and using tableware with care—building independence and respect for others.",
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
            description: "Hands-on finger activities help little learners practise fine motor control and hand–eye coordination while exploring colour, texture, and creativity.",
            image: "/activity-finger-painting.jpeg",
            alt: "Children taking part in a colourful finger activity",
        },
    ],
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

const contentSections = new Set(["notices", "activities", "gallery"]);

function validateContentItems(section, items) {
    if (!contentSections.has(section) || !Array.isArray(items) || items.length > 100) {
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
        } else {
            const title = text("title", 100);
            const captionOrCategory = text(section === "activities" ? "category" : "caption", 120);
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
            const isLocalImage = image && /^\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(image);
            if (!title || !captionOrCategory || !image || alt === null || (!isLocalImage && !isHttpsImage)) {
                return { error: "Check each item title, caption/category, and secure image URL." };
            }
            if (section === "activities") {
                const description = text("description", 1500);
                if (!description) {
                    return { error: "Each activity needs a description." };
                }
                validated = { id: item.id, title, category: captionOrCategory, description, image, alt };
            } else {
                validated = { id: item.id, title, caption: captionOrCategory, image, alt };
            }
        }
        content.push(validated);
    }
    return { content };
}

function saveContentSection(section, items) {
    const save = async () => {
        const updatedContent = { ...siteContent, [section]: items };
        const temporaryPath = `${siteContentPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
        await fs.writeFile(temporaryPath, `${JSON.stringify(updatedContent, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        await fs.rename(temporaryPath, siteContentPath);
        siteContent = updatedContent;
        return siteContent;
    };
    const pendingSave = contentWriteQueue.then(save);
    contentWriteQueue = pendingSave.catch(() => {});
    return pendingSave;
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
    if (!["Playgroup", "Nursery", "LKG", "UKG", "Kindergarten", "Class 1–5"].includes(enquiry.grade)) {
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

app.get("/api/content", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(siteContent);
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

app.put("/api/admin/content/:section", requireAdmin, async (req, res, next) => {
    const section = req.params.section;
    const { content, error } = validateContentItems(section, req.body?.items);
    if (error) {
        return res.status(400).json({ error });
    }
    try {
        const updatedContent = await saveContentSection(section, content);
        res.json({ items: updatedContent[section], message: "Changes saved and published." });
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
        return res.status(413).json({ error: "The submitted request is too large." });
    }
    if (error.type === "entity.parse.failed") {
        return res.status(400).json({ error: "The submitted request is not valid JSON." });
    }
    console.error("Request failed:", error.message);
    res.status(500).json({ error: "The request could not be completed. Please try again later." });
});

async function startServer() {
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    await fs.mkdir(path.dirname(siteContentPath), { recursive: true });
    const databaseFile = await fs.open(databasePath, "a", 0o600);
    try {
        await databaseFile.chmod(0o600);
    } finally {
        await databaseFile.close();
    }
    try {
        const storedContent = JSON.parse(await fs.readFile(siteContentPath, "utf8"));
        siteContent = {};
        for (const section of contentSections) {
            const { content, error } = validateContentItems(section, storedContent[section]);
            if (error) {
                throw new Error(`Invalid ${section} in ${siteContentPath}: ${error}`);
            }
            siteContent[section] = content;
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
        siteContent = defaultSiteContent;
        await fs.writeFile(siteContentPath, `${JSON.stringify(siteContent, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
    await fs.chmod(siteContentPath, 0o600);
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
            grade TEXT NOT NULL CHECK(grade IN ('Playgroup', 'Nursery', 'LKG', 'UKG', 'Kindergarten', 'Class 1–5')),
            address TEXT NOT NULL CHECK(length(address) BETWEEN 1 AND 300),
            pin_code TEXT NOT NULL CHECK(length(pin_code) = 6 AND pin_code NOT GLOB '*[^0-9]*'),
            message TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 2000),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS enquiries_created_at ON enquiries(created_at DESC);
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
    `);
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
        LIMIT 500
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
