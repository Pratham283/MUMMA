require("dotenv").config();

const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

async function resetAdminPassword() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Set ADMIN_EMAIL to the existing admin's email address.");
    }

    if (!password || password.length < 12) {
        throw new Error("Set ADMIN_PASSWORD to a unique password with at least 12 characters.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "mummas_proud_school",
        charset: "utf8mb4",
        timezone: "+00:00",
        ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
        ...(process.env.DB_SSL_CA ? { ssl: { ca: process.env.DB_SSL_CA } } : {}),
    });

    try {
        const [result] = await connection.execute(
            "UPDATE admins SET password_hash = ? WHERE email = ?",
            [passwordHash, email]
        );
        if (result.affectedRows === 0) {
            throw new Error("No admin account exists with that email address.");
        }
        console.log(`Admin password reset for ${email}.`);
    } finally {
        await connection.end();
    }
}

resetAdminPassword().catch((error) => {
    console.error("Could not reset admin password:", error.message);
    process.exitCode = 1;
});
