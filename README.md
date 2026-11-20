# Mumma's Proud Junior Wing School

The school website runs on Node.js and stores admission enquiries, notices, activities, gallery entries, and homepage slideshow photos in a local SQLite database. On first startup, existing website content is imported from `data/site-content.json` if present; subsequent changes are saved in SQLite. The website does not use MySQL.

When hosted as a static GitHub Pages site, public pages fall back to the published `data/site-content.json` if `/api/content` is unavailable. This keeps notices, activities, and gallery visible, but static hosting cannot run the admin API or save database changes; deploy the Node.js server on a persistent host to use the database-backed admin panel and enquiry form.

## Requirements

- Node.js 22.13 through 24.x (`node:sqlite` is built into Node.js; Render uses Node 24.22.1)

## Start the website (Windows PowerShell)

1. Install the dependencies:

```powershell
npm.cmd install
```

2. Create the first admin account. This stores only a salted password hash in the private SQLite database. Enter a unique password of at least 12 characters when prompted:

```powershell
$secure = Read-Host "Admin password (12+ characters)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:ADMIN_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $hash = node .\scripts\hash-admin-password.js
    if ($LASTEXITCODE -ne 0) { throw "Could not create the admin password hash." }
    $secretBytes = New-Object byte[] 48
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $random.GetBytes($secretBytes)
    $sessionSecret = [Convert]::ToBase64String($secretBytes)
    $random.Dispose()
    $configuration = @"
NODE_ENV=development
PORT=3001
SESSION_SECRET=$sessionSecret
ADMIN_EMAIL=mummaproud2003@gmail.com
ADMIN_PASSWORD_HASH=$hash
ADMIN_ALLOWED_ORIGINS=http://127.0.0.1:3000
"@
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) ".env"), $configuration, [System.Text.UTF8Encoding]::new($false))
} finally {
    Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
}
```

3. Start the website:

```powershell
npm.cmd start
```

Open `http://localhost:3001`. The SQLite database and its tables are created automatically at `data/enquiries.sqlite`. On the first startup after this update, notices, activities, and gallery entries are imported from `data/site-content.json` into SQLite; that JSON file is kept as a migration source and is no longer updated. The initial admin account is created on first startup using the email and password hash from the ignored `.env` file.

The **School Admin Panel** is at `http://localhost:3001/admin`. Each section is its own page (`admin.html` for Enquiries, then `admin-slideshow.html`, `admin-notices.html`, `admin-activities.html`, `admin-events.html`, `admin-gallery.html`, `admin-documents.html`) linked from the panel's top menu. Sign in with `mummaproud2003@gmail.com` and the password you set in step 2. Use the Homepage Slideshow, Notices, Activities, Upcoming events (the separate Events page, which hides an event after its date), and Gallery pages to add, edit, delete, and drag to reorder content; the slideshow accepts up to five photos or videos (no text) and its per-slide time (2–30 seconds, default 3) is set in the same section. The Admission PDFs section uploads, replaces, or deletes the Book list, Fee structure, and Admission form PDFs (up to 10 MB each, stored in SQLite); they open from the website's Admission menu. Changes are saved in SQLite and appear on the corresponding public pages. Photos and videos are chosen from the device with a Choose button (photos up to 15 MB, videos up to 500 MB) and are stored in SQLite too, so one database file holds everything. The Enquiries page (the default admin page) displays the latest 5,000 admission enquiries, 50 at a time. Do not expose the panel on a public network without HTTPS and a strong, private admin password.

## Production deployment

This app is ready to deploy on a host that supports Node.js 22.13–24.x, a long-running Node process, and persistent writable storage. It is not a static-only site: admin login, enquiries, and website content require the server and the SQLite database to remain available.

Before publishing:

1. Set `NODE_ENV=production`, a supported Node.js version, and the host-provided `PORT`.
2. Put the app behind an HTTPS reverse proxy/load balancer. Set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops so secure cookies and client IP rate limits work correctly. Do not trust a proxy that users can bypass.
3. Generate `SESSION_SECRET` from at least 48 cryptographically random bytes and keep it private. For example, in PowerShell: `node -p "require('node:crypto').randomBytes(48).toString('base64')"`.
4. Before the first start on a new database, set `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` in the host's secret settings. Generate the hash by running `scripts/hash-admin-password.js` with `ADMIN_BOOTSTRAP_PASSWORD` set temporarily; remove the plaintext bootstrap value afterwards. For an existing admin database, you can also set `ADMIN_RESET_PASSWORD` (12+ characters) temporarily and restart the app to change the password; remove that variable after the reset. Do not use the development values in `.env.example`; use the production HTTPS site origin if `ADMIN_ALLOWED_ORIGINS` is needed.
5. Mount persistent storage for `data/enquiries.sqlite`. If the host uses a separate volume, set `ENQUIRY_DB_PATH` to a path on that volume. `SITE_CONTENT_PATH` is only needed to import an existing content JSON file on the first startup of a new database. Back up the database securely and keep it private.
6. Start with `npm ci` and `npm start`; verify `/api/health`, the public pages, the admission form, and `/admin` over HTTPS.

Do not receive real child enquiries until HTTPS, persistent storage, backups, and the production admin credentials have been configured and verified.

### Deploy with the Render blueprint

The included `render.yaml` creates a Node web service and mounts a persistent 5 GB disk at `/var/data`; the database is stored at `/var/data/enquiries.sqlite`. Use Render's **New → Blueprint** flow with this repository and keep the disk attached. The configured Starter plan is a paid service; do not replace it with an ephemeral filesystem if the site will store enquiries.

Before creating the Blueprint, generate the two secrets locally and enter them only in Render's secret prompts:

- `SESSION_SECRET`: generate at least 48 random bytes with `node -p "require('node:crypto').randomBytes(48).toString('base64')"`.
- `ADMIN_PASSWORD_HASH`: generate it with `scripts/hash-admin-password.js` using a unique `ADMIN_BOOTSTRAP_PASSWORD` temporarily. Set the resulting hash as the secret; never set or commit the plaintext password.

The Blueprint sets `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, and the persistent database path. After deployment, configure your domain and DNS in Render, confirm HTTPS is active, then check `/api/health`, `/`, `/admission.html`, `/sitemap.xml`, and `/admin`. The sitemap and `robots.txt` currently use `https://mummasproudschool.in`; update both files if your production domain is different. Keep database backups private because they contain child and guardian enquiry data.

To submit an enquiry, open `http://localhost:3001/admission.html`. The form validates child and guardian names, phone, optional email, class, address, and a six-digit PIN code before storing the enquiry with its submission time. Requests are limited to five per IP address per 15 minutes.

In VS Code, you can run the **Start school website backend** task and preview the site with Live Server at `http://127.0.0.1:3000`. The workspace proxies the site and enquiry requests to the Node.js server on port 3001; reload the VS Code window once after changing workspace proxy settings.

Use a unique production password before exposing the site to other people. Reset it at any time with:

```powershell
$secure = Read-Host "New admin password (12+ characters)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:ADMIN_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    npm.cmd run admin:reset
} finally {
    Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
}
```

Password resets invalidate active admin sessions. Do not commit `.env`, the SQLite file, or enquiry records.

## Data and privacy

Back up `data/enquiries.sqlite` securely. Admission forms can contain children's and guardians' personal information; restrict access to the database, set an appropriate retention period, and do not commit or publicly distribute enquiry records. Website content is also stored in this database. Set `ENQUIRY_DB_PATH` to use another private persistent database path.
