require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");

async function initializeDatabase() {
    const databaseName = process.env.DB_NAME || "mummas_proud_school";

    if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
        throw new Error("DB_NAME may contain only letters, numbers, and underscores.");
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        charset: "utf8mb4",
        timezone: "+00:00",
        ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
        ...(process.env.DB_SSL_CA ? { ssl: { ca: process.env.DB_SSL_CA } } : {}),
    });

    try {
        await connection.query(
            `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await connection.changeUser({ database: databaseName });

        const schema = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
        for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) {
            await connection.query(statement);
        }

        const [rows] = await connection.query("SELECT COUNT(*) AS count FROM gallery_images");
        if (Number(rows[0].count) === 0) {
            const starterImages = [
                ["A happy place to grow", "Welcome to our school", "/school-building.jpeg", 0],
                ["Table manners", "Everyday life skills", "/activity-table-manners.jpeg", 1],
                ["Mystery box", "Curiosity in action", "/activity-mystery-box.jpeg", 2],
                ["Finger activity", "Learning by creating", "/activity-finger-painting.jpeg", 3],
                ["Republic Day", "School celebration", "/founder-harshita.jpeg", 4],
            ];

            await connection.query(
                "INSERT INTO gallery_images (title, caption, image_path, sort_order) VALUES ?",
                [starterImages]
            );
        }

        const [activityRows] = await connection.query("SELECT COUNT(*) AS count FROM activities");
        if (Number(activityRows[0].count) === 0) {
            const starterActivities = [
                [
                    "Table Manners",
                    "Everyday life skills",
                    "Children practise polite mealtime habits, sharing, and using tableware with care—building independence and respect for others.",
                    "/activity-table-manners.jpeg",
                    0,
                ],
                [
                    "Mystery Box",
                    "Curiosity & discovery",
                    "Guessing what is inside encourages children to observe, describe what they notice, ask questions, and express their ideas with confidence.",
                    "/activity-mystery-box.jpeg",
                    1,
                ],
                [
                    "Finger Activity",
                    "Creative exploration",
                    "Hands-on finger activities help little learners practise fine motor control and hand–eye coordination while exploring colour, texture, and creativity.",
                    "/activity-finger-painting.jpeg",
                    2,
                ],
            ];

            await connection.query(
                "INSERT INTO activities (title, category, description, image_path, sort_order) VALUES ?",
                [starterActivities]
            );
        }

        console.log(`Database "${databaseName}" and its tables are ready.`);
    } finally {
        await connection.end();
    }
}

initializeDatabase().catch((error) => {
    console.error("Database initialization failed:", error.message);
    process.exitCode = 1;
});
