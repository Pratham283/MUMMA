require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
const MySQLStoreFactory = require("express-mysql-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const multer = require("multer");
const sharp = require("sharp");
const { rateLimit } = require("express-rate-limit");

const app = express();
const rootDirectory = __dirname;
const uploadDirectory = path.join(rootDirectory, "uploads");
const port = Number(process.env.PORT) || 3001;
const sessionSecret = process.env.SESSION_SECRET;
const databaseName = process.env.DB_NAME || "mummas_proud_school";

if (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith("replace-this")) {
    throw new Error("Set SESSION_SECRET in .env to a unique random value of at least 32 characters.");
}

if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error("DB_NAME may contain only letters, numbers, and underscores.");
}

if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: databaseName,
    charset: "utf8mb4",
    timezone: "+00:00",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
    ...(process.env.DB_SSL_CA ? { ssl: { ca: process.env.DB_SSL_CA } } : {}),
});

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 60 * 60 * 1000,
    createDatabaseTable: true,
    schema: {
        tableName: "admin_sessions",
    },
}, pool);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 8 * 1024 * 1024,
        files: 1,
    },
});

app.disable("x-powered-by");
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:"],
        },
    },
}));
app.use(express.json({ limit: "20kb" }));
app.use(session({
    name: "school_admin",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 60 * 60 * 1000,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
    },
}));

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

function validateAdminRequest(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        return next();
    }

    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;

    if (!origin || origin !== expectedOrigin) {
        return res.status(403).json({ error: "This request is not allowed." });
    }

    const token = req.get("x-csrf-token");
    const expectedToken = req.session.csrfToken;
    if (
        typeof token !== "string" ||
        typeof expectedToken !== "string" ||
        token.length !== expectedToken.length ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
    ) {
        return res.status(403).json({ error: "Your session expired. Refresh the page and try again." });
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.adminId) {
        return res.status(401).json({ error: "Please sign in to continue." });
    }

    next();
}

function sendSessionError(res, error) {
    console.error("Session store error:", error.message);
    res.status(503).json({ error: "The sign-in service is temporarily unavailable." });
}

app.get("/api/health", async (req, res, next) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok" });
    } catch (error) {
        next(error);
    }
});

const adminPages = new Map([
    ["/admin", "admin.html"],
    ["/admin/notices", "admin.html"],
    ["/admin/memories", "admin-memories.html"],
    ["/admin/activities", "admin-activities.html"],
    ["/admin/enquiries", "admin-enquiries.html"],
]);

app.get([...adminPages.keys()], (req, res) => {
    const page = adminPages.get(req.path.replace(/\/+$/, ""));
    res.sendFile(path.join(rootDirectory, page));
});

app.get("/gallery", (req, res) => {
    res.sendFile(path.join(rootDirectory, "gallery.html"));
});

app.get("/api/gallery", async (req, res, next) => {
    const limit = Number(req.query.limit);
    const parameters = [];
    let limitClause = "";

    if (Number.isInteger(limit) && limit > 0 && limit <= 30) {
        limitClause = " LIMIT ?";
        parameters.push(limit);
    }

    try {
        const [images] = await pool.execute(
            `SELECT id, title, caption, image_path AS imagePath
             FROM gallery_images ORDER BY sort_order, created_at DESC, id DESC${limitClause}`,
            parameters
        );
        res.json({ images });
    } catch (error) {
        next(error);
    }
});

app.get("/api/activities", async (req, res, next) => {
    try {
        const [activities] = await pool.execute(
            `SELECT id, title, category, description, image_path AS imagePath
             FROM activities ORDER BY sort_order, created_at, id`
        );
        res.json({ activities });
    } catch (error) {
        next(error);
    }
});

app.get("/api/notices", async (req, res, next) => {
    const limit = Number(req.query.limit);
    const parameters = [];
    let limitClause = "";

    if (Number.isInteger(limit) && limit > 0 && limit <= 20) {
        limitClause = " LIMIT ?";
        parameters.push(limit);
    }

    try {
        const [notices] = await pool.execute(
            `SELECT id, title, body, priority, published_at AS publishedAt, expires_at AS expiresAt
             FROM notices
             WHERE published_at <= CURRENT_TIMESTAMP AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
             ORDER BY FIELD(priority, 'urgent', 'important', 'normal'), published_at DESC, id DESC${limitClause}`,
            parameters
        );
        res.json({ notices });
    } catch (error) {
        next(error);
    }
});

app.post("/api/enquiries", enquiryRateLimit, async (req, res, next) => {
    const { studentName, parentName, phone, email, grade, message } = req.body || {};
    const enquiry = {
        studentName: typeof studentName === "string" ? studentName.trim() : "",
        parentName: typeof parentName === "string" ? parentName.trim() : "",
        phone: typeof phone === "string" ? phone.trim() : "",
        email: typeof email === "string" ? email.trim().toLowerCase() : "",
        grade: typeof grade === "string" ? grade.trim() : "",
        message: typeof message === "string" ? message.trim() : "",
    };

    if (!enquiry.studentName || enquiry.studentName.length > 100) {
        return res.status(400).json({ error: "Enter the student's name (up to 100 characters)." });
    }
    if (!enquiry.parentName || enquiry.parentName.length > 100) {
        return res.status(400).json({ error: "Enter a parent or guardian name (up to 100 characters)." });
    }
    if (!/^\+?[0-9\s()-]{7,25}$/.test(enquiry.phone)) {
        return res.status(400).json({ error: "Enter a valid phone number." });
    }
    if (enquiry.email.length > 254 || (enquiry.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiry.email))) {
        return res.status(400).json({ error: "Enter a valid email address, or leave it blank." });
    }
    if (!enquiry.grade || enquiry.grade.length > 50) {
        return res.status(400).json({ error: "Select or enter a class (up to 50 characters)." });
    }
    if (enquiry.message.length > 2000) {
        return res.status(400).json({ error: "Keep your message under 2,000 characters." });
    }

    try {
        const [result] = await pool.execute(
            `INSERT INTO enquiries (student_name, parent_name, phone, email, grade, message)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                enquiry.studentName,
                enquiry.parentName,
                enquiry.phone,
                enquiry.email || null,
                enquiry.grade,
                enquiry.message,
            ]
        );
        res.status(201).json({ message: "Thank you! Your admission enquiry has been received.", id: result.insertId });
    } catch (error) {
        next(error);
    }
});

app.get("/api/admin/csrf", (req, res, next) => {
    req.session.csrfToken ||= crypto.randomBytes(32).toString("hex");
    req.session.save((error) => {
        if (error) {
            return sendSessionError(res, error);
        }
        res.json({ csrfToken: req.session.csrfToken });
    });
});

app.get("/api/admin/me", (req, res) => {
    if (!req.session.adminId) {
        return res.json({ admin: null });
    }
    res.json({ admin: { email: req.session.adminEmail } });
});

app.post("/api/admin/login", loginRateLimit, validateAdminRequest, async (req, res, next) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
        return res.status(400).json({ error: "Enter your email and password." });
    }

    try {
        const [admins] = await pool.execute(
            "SELECT id, email, password_hash FROM admins WHERE email = ? LIMIT 1",
            [email]
        );
        const admin = admins[0];
        const validPassword = admin
            ? await bcrypt.compare(password, admin.password_hash)
            : await bcrypt.compare(password, "$2a$12$wR9nr0dEhLxMJM3JwHMOzeYuxS7fW5jN2gxlz2nB5X1ZFK2AM8JfK");

        if (!admin || !validPassword) {
            return res.status(401).json({ error: "Email or password is incorrect." });
        }

        req.session.regenerate((error) => {
            if (error) {
                return sendSessionError(res, error);
            }

            req.session.adminId = admin.id;
            req.session.adminEmail = admin.email;
            req.session.csrfToken = crypto.randomBytes(32).toString("hex");
            req.session.save((saveError) => {
                if (saveError) {
                    return sendSessionError(res, saveError);
                }
                res.json({
                    admin: { email: admin.email },
                    csrfToken: req.session.csrfToken,
                });
            });
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/admin/logout", validateAdminRequest, requireAdmin, (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return sendSessionError(res, error);
        }
        res.clearCookie("school_admin", {
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
        });
        res.json({ message: "You have been signed out." });
    });
});

app.use("/api/admin", validateAdminRequest, requireAdmin);

app.get("/api/admin/dashboard", async (req, res, next) => {
    try {
        const [[images], [activities], [enquiries], [notices]] = await Promise.all([
            pool.execute(
                "SELECT id, title, caption, image_path AS imagePath, created_at AS createdAt FROM gallery_images ORDER BY sort_order, created_at DESC, id DESC"
            ),
            pool.execute(
                "SELECT id, title, category, description, image_path AS imagePath FROM activities ORDER BY sort_order, created_at, id"
            ),
            pool.execute(
                `SELECT id, student_name AS studentName, parent_name AS parentName, phone, email,
                        grade, message, status, created_at AS createdAt
                 FROM enquiries ORDER BY created_at DESC LIMIT 200`
            ),
            pool.execute(
                `SELECT id, title, body, priority, published_at AS publishedAt, expires_at AS expiresAt
                 FROM notices ORDER BY published_at DESC, id DESC LIMIT 100`
            ),
        ]);
        res.json({ images, activities, enquiries, notices });
    } catch (error) {
        next(error);
    }
});

app.post("/api/admin/notices", async (req, res, next) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const priority = req.body?.priority;
    const expiresAtValue = typeof req.body?.expiresAt === "string" ? req.body.expiresAt.trim() : "";

    if (!title || title.length > 160) {
        return res.status(400).json({ error: "Enter a notice title (up to 160 characters)." });
    }
    if (!body || body.length > 5000) {
        return res.status(400).json({ error: "Enter notice details (up to 5,000 characters)." });
    }
    if (!["normal", "important", "urgent"].includes(priority)) {
        return res.status(400).json({ error: "Choose a valid notice priority." });
    }

    let expiresAt = null;
    if (expiresAtValue) {
        const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
        const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
        if (!localDateTime.test(expiresAtValue) && !isoDateTime.test(expiresAtValue)) {
            return res.status(400).json({ error: "Enter a valid notice expiry date and time." });
        }
        const parsedDate = new Date(expiresAtValue);
        if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
            return res.status(400).json({ error: "The notice expiry must be a future date and time." });
        }
        expiresAt = parsedDate;
    }

    try {
        const [result] = await pool.execute(
            "INSERT INTO notices (title, body, priority, expires_at) VALUES (?, ?, ?, ?)",
            [title, body, priority, expiresAt]
        );
        res.status(201).json({
            notice: {
                id: result.insertId,
                title,
                body,
                priority,
                publishedAt: new Date(),
                expiresAt,
            },
        });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/admin/notices/:id", async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: "Invalid notice." });
    }

    try {
        const [result] = await pool.execute("DELETE FROM notices WHERE id = ?", [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Notice not found." });
        }
        res.json({ message: "Notice deleted." });
    } catch (error) {
        next(error);
    }
});

app.post("/api/admin/gallery", upload.single("image"), async (req, res, next) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";

    if (!title || title.length > 120 || caption.length > 180) {
        return res.status(400).json({ error: "A title is required (up to 120 characters); captions can be up to 180 characters." });
    }
    if (!req.file) {
        return res.status(400).json({ error: "Choose a JPEG, PNG, or WebP image to upload." });
    }

    const imageName = `${crypto.randomUUID()}.webp`;
    const imagePath = path.join(uploadDirectory, imageName);

    try {
        const imageOptions = { limitInputPixels: 40000000 };
        const metadata = await sharp(req.file.buffer, imageOptions).metadata();
        if (!["jpeg", "png", "webp"].includes(metadata.format)) {
            return res.status(400).json({ error: "Only JPEG, PNG, and WebP images are supported." });
        }
    } catch {
        return res.status(400).json({ error: "The selected file is not a supported image." });
    }

    try {
        const encodedImage = await sharp(req.file.buffer, { limitInputPixels: 40000000 })
            .rotate()
            .webp({ quality: 84 })
            .toBuffer();
        const [latest] = await pool.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM gallery_images");
        await fs.mkdir(uploadDirectory, { recursive: true });
        await fs.writeFile(imagePath, encodedImage, { flag: "wx" });

        try {
            const [result] = await pool.execute(
                "INSERT INTO gallery_images (title, caption, image_path, sort_order) VALUES (?, ?, ?, ?)",
                [title, caption, `/uploads/${imageName}`, latest[0].nextOrder]
            );
            res.status(201).json({
                image: {
                    id: result.insertId,
                    title,
                    caption,
                    imagePath: `/uploads/${imageName}`,
                },
            });
        } catch (error) {
            await fs.unlink(imagePath).catch((unlinkError) => {
                if (unlinkError.code !== "ENOENT") {
                    console.error("Could not remove an unlisted gallery upload:", unlinkError.message);
                }
            });
            throw error;
        }
    } catch (error) {
        next(error);
    }
});

app.delete("/api/admin/gallery/:id", async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: "Invalid gallery image." });
    }

    try {
        const [images] = await pool.execute(
            "SELECT image_path FROM gallery_images WHERE id = ? LIMIT 1",
            [req.params.id]
        );
        if (images.length === 0) {
            return res.status(404).json({ error: "Gallery image not found." });
        }

        await pool.execute("DELETE FROM gallery_images WHERE id = ?", [req.params.id]);
        const imagePath = images[0].image_path;
        if (imagePath.startsWith("/uploads/")) {
            const imageName = path.basename(imagePath);
            if (imageName === imagePath.slice("/uploads/".length)) {
                try {
                    await fs.unlink(path.join(uploadDirectory, imageName));
                } catch (error) {
                    if (error.code !== "ENOENT") {
                        console.error("Could not remove deleted gallery upload:", error.message);
                        return res.status(500).json({ error: "The image was removed from the gallery, but its file could not be cleaned up." });
                    }
                }
            }
        }
        res.json({ message: "Gallery image deleted." });
    } catch (error) {
        next(error);
    }
});

app.post("/api/admin/activities", upload.single("image"), async (req, res, next) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";

    if (!title || title.length > 120 || category.length > 80 || !description || description.length > 1200) {
        return res.status(400).json({ error: "Enter an activity title (up to 120 characters), category (up to 80), and description (up to 1,200)." });
    }
    if (!req.file) {
        return res.status(400).json({ error: "Choose a JPEG, PNG, or WebP activity photo." });
    }

    const imageOptions = { limitInputPixels: 40000000 };
    let metadata;
    try {
        metadata = await sharp(req.file.buffer, imageOptions).metadata();
    } catch {
        return res.status(400).json({ error: "The selected file is not a supported image." });
    }
    if (!["jpeg", "png", "webp"].includes(metadata.format)) {
        return res.status(400).json({ error: "Only JPEG, PNG, and WebP images are supported." });
    }

    const imageName = `${crypto.randomUUID()}.webp`;
    const imagePath = path.join(uploadDirectory, imageName);

    try {
        const encodedImage = await sharp(req.file.buffer, imageOptions)
            .rotate()
            .webp({ quality: 84 })
            .toBuffer();
        const [latest] = await pool.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM activities");
        await fs.mkdir(uploadDirectory, { recursive: true });
        await fs.writeFile(imagePath, encodedImage, { flag: "wx" });

        try {
            const [result] = await pool.execute(
                "INSERT INTO activities (title, category, description, image_path, sort_order) VALUES (?, ?, ?, ?, ?)",
                [title, category, description, `/uploads/${imageName}`, latest[0].nextOrder]
            );
            res.status(201).json({
                activity: {
                    id: result.insertId,
                    title,
                    category,
                    description,
                    imagePath: `/uploads/${imageName}`,
                },
            });
        } catch (error) {
            await fs.unlink(imagePath).catch((unlinkError) => {
                if (unlinkError.code !== "ENOENT") {
                    console.error("Could not remove an unlisted activity upload:", unlinkError.message);
                }
            });
            throw error;
        }
    } catch (error) {
        next(error);
    }
});

app.delete("/api/admin/activities/:id", async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ error: "Invalid activity." });
    }

    try {
        const [activities] = await pool.execute(
            "SELECT image_path FROM activities WHERE id = ? LIMIT 1",
            [req.params.id]
        );
        if (activities.length === 0) {
            return res.status(404).json({ error: "Activity not found." });
        }

        await pool.execute("DELETE FROM activities WHERE id = ?", [req.params.id]);
        const imagePath = activities[0].image_path;
        if (imagePath.startsWith("/uploads/")) {
            const imageName = path.basename(imagePath);
            if (imageName === imagePath.slice("/uploads/".length)) {
                try {
                    await fs.unlink(path.join(uploadDirectory, imageName));
                } catch (error) {
                    if (error.code !== "ENOENT") {
                        console.error("Could not remove deleted activity upload:", error.message);
                        return res.status(500).json({ error: "The activity was removed, but its photo could not be cleaned up." });
                    }
                }
            }
        }
        res.json({ message: "Activity deleted." });
    } catch (error) {
        next(error);
    }
});

app.patch("/api/admin/enquiries/:id", async (req, res, next) => {
    const { status } = req.body || {};
    if (!/^\d+$/.test(req.params.id) || !["new", "contacted", "closed"].includes(status)) {
        return res.status(400).json({ error: "Choose a valid enquiry status." });
    }

    try {
        const [result] = await pool.execute(
            "UPDATE enquiries SET status = ? WHERE id = ?",
            [status, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Enquiry not found." });
        }
        res.json({ message: "Enquiry status updated." });
    } catch (error) {
        next(error);
    }
});

app.use("/uploads", express.static(uploadDirectory, {
    dotfiles: "deny",
    immutable: true,
    maxAge: "1y",
}));

const publicFiles = new Set([
    "/index.html",
    "/activities.html",
    "/gallery.html",
    "/admission.html",
    "/notices.html",
    "/admin.html",
    "/robots.txt",
    "/style.css",
    "/admin.css",
    "/script.js",
    "/admin.js",
    "/logo.png",
    "/school-building.jpeg",
    "/founder-harshita.jpeg",
    "/founder-pankaj.jpeg",
    "/activity-table-manners.jpeg",
    "/activity-mystery-box.jpeg",
    "/activity-finger-painting.jpeg",
]);

app.get(["/", ...publicFiles], (req, res, next) => {
    const requestedPath = req.path === "/" ? "/index.html" : req.path;
    res.sendFile(path.join(rootDirectory, requestedPath.slice(1)), {
        maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    }, (error) => {
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

    if (error instanceof multer.MulterError) {
        const message = error.code === "LIMIT_FILE_SIZE"
            ? "Images must be 8 MB or smaller."
            : "The image could not be uploaded. Please try again.";
        return res.status(400).json({ error: message });
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({ error: "The submitted request is too large." });
    }
    if (error.type === "entity.parse.failed") {
        return res.status(400).json({ error: "The submitted request is not valid JSON." });
    }

    console.error("Request failed:", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function startServer() {
    await fs.mkdir(uploadDirectory, { recursive: true });
    await pool.query("SELECT 1");
    const server = app.listen(port);
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    console.log(`Mumma's Proud website is running at http://localhost:${port}`);
}

startServer().catch(async (error) => {
    console.error("Could not start the website:", error.message);
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Stop the other server or set PORT to a free port before running npm start.`);
    }
    console.error('Check that MySQL is running, then run "npm run db:init".');
    sessionStore.close();
    await pool.end();
    process.exitCode = 1;
});
