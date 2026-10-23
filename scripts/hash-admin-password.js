const crypto = require("node:crypto");

const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (!password || password.length < 12 || password.length > 256) {
    console.error("Set ADMIN_BOOTSTRAP_PASSWORD to a unique password between 12 and 256 characters.");
    process.exitCode = 1;
} else {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    console.log(`scrypt$${salt}$${hash}`);
}
