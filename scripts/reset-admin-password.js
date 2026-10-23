require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

async function resetAdminPassword() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Set ADMIN_EMAIL to the existing admin account.");
    }
    if (!password || password.length < 12 || password.length > 256) {
        throw new Error("Set ADMIN_BOOTSTRAP_PASSWORD to a unique password between 12 and 256 characters.");
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
    const databasePath = process.env.ENQUIRY_DB_PATH || path.join(__dirname, "..", "data", "enquiries.sqlite");
    const database = new DatabaseSync(databasePath);
    try {
        const result = database.prepare("UPDATE admin_users SET password_hash = ? WHERE email = ?")
            .run(passwordHash, email);
        if (result.changes === 0) {
            throw new Error("No admin account exists for ADMIN_EMAIL.");
        }
        database.prepare("DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admin_users WHERE email = ?)")
            .run(email);
    } finally {
        database.close();
    }
    console.log(`Admin password reset for ${email}; active sessions were signed out.`);
}

resetAdminPassword().catch((error) => {
    console.error("Could not reset the admin password:", error.message);
    process.exitCode = 1;
});
