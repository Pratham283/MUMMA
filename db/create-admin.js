require("dotenv").config();

const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

async function createAdmin() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Set ADMIN_EMAIL to a valid email address before creating the admin.");
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
    });

    try {
        await connection.execute(
            "INSERT INTO admins (email, password_hash) VALUES (?, ?)",
            [email, passwordHash]
        );
        console.log(`Admin account created for ${email}.`);
    } finally {
        await connection.end();
    }
}

createAdmin().catch((error) => {
    console.error("Could not create admin:", error.code === "ER_DUP_ENTRY" ? "An admin with that email already exists." : error.message);
    process.exitCode = 1;
});
