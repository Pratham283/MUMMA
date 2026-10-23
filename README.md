# Mumma's Proud Junior Wing School

The school website runs on Node.js and stores admission enquiries in a local SQLite database. Notices, activities, and gallery entries are saved directly in `data/site-content.json`, not in the database. The website does not use MySQL.

## Requirements

- Node.js 22.13 or newer (`node:sqlite` is built into Node.js)

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

Open `http://localhost:3001`. The SQLite database and `enquiries` table are created automatically at `data/enquiries.sqlite`. The initial admin account is created on first startup using the email and password hash from the ignored `.env` file.

The **School Admin Panel** is at `http://localhost:3001/admin`. Sign in with `mummaproud2003@gmail.com` and the password you set in step 2. Use the separate Notices, Activities, and Gallery sections to add, edit, and delete content; changes are written directly to `data/site-content.json` and appear on the corresponding public pages. Images can use a website image path or an HTTPS image URL. The Enquiries section displays the latest 500 admission enquiries from the private SQLite database. Do not expose the panel on a public network without HTTPS and a strong, private admin password.

## Production deployment

This app is ready to deploy on a host that supports Node.js 22.13+, a long-running Node process, and persistent writable storage. It is not a static-only site: admin login, enquiries, and website content require the server and the files in the `data` directory to remain available.

Before publishing:

1. Set `NODE_ENV=production`, a supported Node.js version, and the host-provided `PORT`.
2. Put the app behind an HTTPS reverse proxy/load balancer. Set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops so secure cookies and client IP rate limits work correctly. Do not trust a proxy that users can bypass.
3. Generate `SESSION_SECRET` from at least 48 cryptographically random bytes and keep it private. For example, in PowerShell: `node -p "require('node:crypto').randomBytes(48).toString('base64')"`.
4. Before the first start on a new database, set `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` in the host's secret settings. Generate the hash by running `scripts/hash-admin-password.js` with `ADMIN_BOOTSTRAP_PASSWORD` set temporarily; remove the plaintext bootstrap value afterwards. For an existing admin database, set a strong unique password using the reset instructions above. Do not use the development values in `.env.example`; use the production HTTPS site origin if `ADMIN_ALLOWED_ORIGINS` is needed.
5. Mount persistent storage for both `data/enquiries.sqlite` and `data/site-content.json`. If the host uses a separate volume, set `ENQUIRY_DB_PATH` and `SITE_CONTENT_PATH` to paths on that volume. Back up the database securely and keep both files private.
6. Start with `npm ci` and `npm start`; verify `/api/health`, the public pages, the admission form, and `/admin` over HTTPS.

Do not publish the admin panel or receive real child enquiries until HTTPS, persistent storage, and the production admin credentials have been configured and verified.

To submit an enquiry, open `http://localhost:3001/admission.html`. The form validates child and guardian names, phone, optional email, class, address, and a six-digit PIN code before storing the enquiry with its submission time. Requests are limited to five per IP address per 15 minutes.

In VS Code, you can run the **Start school website backend** task and preview the site with Live Server at `http://127.0.0.1:3000`. The workspace proxies the site and enquiry requests to the Node.js server on port 3001; reload the VS Code window once after changing workspace proxy settings.

The initial password was provided in chat, so replace it with a new, unique password before exposing the site to other people. Reset it at any time with:

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

Back up `data/enquiries.sqlite` securely. Admission forms can contain children's and guardians' personal information; restrict access to the database, set an appropriate retention period, and do not commit or publicly distribute enquiry records. Website content is stored separately in `data/site-content.json`. Set `ENQUIRY_DB_PATH` to use another private persistent database path.
