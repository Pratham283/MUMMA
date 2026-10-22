# Mumma's Proud Junior Wing School

The site runs as a Node.js/Express application. MySQL stores admissions enquiries, administrator sessions, admin accounts, gallery records, and school activities; uploaded photos are converted to WebP and kept in the local `uploads` folder.

## Requirements

- Node.js 20 or newer
- MySQL 8.0 or newer, either installed locally or started with Docker Compose

## First-time setup (Windows PowerShell)

1. Install the Node dependencies:

   ```powershell
   npm.cmd install
   ```

2. For a local Windows MySQL service, install MySQL Server if needed:

   ```powershell
   winget install --id Oracle.MySQL --exact
   ```

3. Open PowerShell as Administrator, change to the website folder, and configure the local MySQL service and application database:

   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File .\db\setup-mysql-windows.ps1
   ```

   The setup script binds MySQL to localhost, generates a unique database password and session secret, writes them to the ignored `.env` file, and seeds the initial gallery photos and activities.

4. Create the first administrator. The password prompt is hidden; use a unique password with at least 12 characters:

   ```powershell
   $secure = Read-Host "Create an admin password (12+ characters)" -AsSecureString
   $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   try {
       $env:ADMIN_EMAIL = Read-Host "Admin email"
       $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
       npm.cmd run admin:create
   } finally {
       Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
       [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
       $secure.Dispose()
   }
   ```

5. Start the website and open it in a browser:

   ```powershell
   npm.cmd start
   ```

   Visit `http://localhost:3001` for the website and `http://localhost:3001/admin` for the protected admin dashboard. After signing in, use the dashboard menu to open Notices, School memories, Activities, or Enquiries on their own pages.

   Use this Node.js address for the admission form; a static preview server cannot submit enquiries. If startup reports that port 3001 is already in use, stop the other server or set `PORT` to a free port, then open the website on that port.

   In VS Code, run the **Start school website backend** task, then open the project with Live Server at `http://127.0.0.1:3000`. The workspace configures Live Server to proxy requests to the Express backend on port 3001, so `/admin` and its API requests work through the usual Live Server URL. Reload the VS Code window once after the workspace proxy settings change.

To reset an existing administrator's password, run this in PowerShell from the website folder. Use the email already registered for the admin account and choose a unique password of at least 12 characters:

```powershell
$secure = Read-Host "New admin password (12+ characters)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:ADMIN_EMAIL = Read-Host "Existing admin email"
    $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    npm.cmd run admin:reset
} finally {
    Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
}
```

## Alternative: start MySQL with Docker Compose

If you prefer Docker, create `.env` from `.env.example`, set a strong `DB_PASSWORD` and a fresh random `SESSION_SECRET`, and start the database container:

```powershell
Copy-Item .env.example .env
docker compose up -d db
npm.cmd run db:init
```

Then create the admin and run `npm.cmd start` as above. MySQL data survives container restarts in the `school_mysql_data` Docker volume. Back up that volume before moving or deleting it.

## Backend features

- Dedicated responsive admission enquiry page; validated submissions are stored in MySQL.
- Admin sign-in with bcrypt password hashes, rate-limited login, database-backed sessions, secure HTTP-only cookies, and CSRF/origin checks.
- Signed-in admins can change their login email and/or password after confirming their current password; password changes require at least 12 characters.
- Dedicated admin pages to review up to 200 recent enquiries and mark them new, contacted, or closed; publish, prioritize, expire, and delete notices; manage gallery photos; and add or delete activities.
- Gallery uploads and deletion; the homepage preview links to a dedicated full gallery page. Image files are checked, resized/encoded as WebP, and size-limited.
- Current notices appear on the homepage and dedicated notices page. Activities appear on the homepage and dedicated activities page.
- Public gallery, activities, and notice contents are loaded from the database. Run `npm.cmd run db:init` after updating the app to create new tables and seed the initial activities.
- Security headers, prepared SQL statements, upload and enquiry limits, and errors surfaced to users. Only explicitly public pages and assets are served from the project root; application and database files are not exposed.

Keep `.env`, database backups, and the `uploads` directory private. Do not commit passwords, session secrets, or production data. In production, serve the site over HTTPS, set `NODE_ENV=production`, and use a dedicated MySQL account with only the permissions this application needs. If a trusted single reverse proxy terminates HTTPS, also set `TRUST_PROXY=1` and configure that proxy to overwrite forwarded headers.

## Before a public launch

- Deploy behind HTTPS with `NODE_ENV=production`; set `TRUST_PROXY=1` only when HTTPS terminates at a trusted reverse proxy.
- Replace local development credentials with a dedicated, least-privilege production database account. Keep MySQL private; the Docker Compose port is bound to localhost.
- Use a unique administrator password that has not been shared in chats or reused elsewhere, and keep production secrets out of source control.
- Publish a privacy notice that explains how admission enquiries, including children's and guardians' personal information, are used, retained, and deleted. Confirm the school's consent and data-handling requirements before collecting real enquiries.
- Back up and test restoring both the MySQL database and `uploads`; ensure the production host provides persistent storage for both.
- Configure the real public domain before adding canonical URLs and an absolute-URL sitemap. These cannot be generated accurately from the local development address.
