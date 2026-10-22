#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$mysqlRoot = Join-Path $env:ProgramFiles "MySQL\MySQL Server 8.4"
$mysqlServer = Join-Path $mysqlRoot "bin\mysqld.exe"
$mysqlClient = Join-Path $mysqlRoot "bin\mysql.exe"
$mysqlProgramData = Join-Path $env:ProgramData "MySQL\MummaProud"
$dataDirectory = Join-Path $mysqlProgramData "Data"
$configPath = Join-Path $mysqlProgramData "my.ini"
$serviceName = "MySQL84"
$envPath = Join-Path $projectRoot ".env"

if (-not (Test-Path $mysqlServer) -or -not (Test-Path $mysqlClient)) {
    throw "Install MySQL Server 8.4 before running this setup script."
}
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    throw "The $serviceName service already exists. It was left unchanged; configure .env for that server instead."
}
if (Test-Path $envPath) {
    throw ".env already exists and was left unchanged. Back it up or configure an existing MySQL server manually."
}
if (Test-Path $configPath) {
    throw "MySQL setup already started because $configPath exists. Review the existing configuration before continuing."
}
if (Test-Path (Join-Path $dataDirectory "mysql")) {
    throw "An initialized MySQL data directory already exists and was left unchanged."
}
if (Test-Path $dataDirectory) {
    $existingData = Get-ChildItem -Force $dataDirectory
    if ($existingData.Count -gt 0) {
        throw "The MySQL data directory is not empty and was left unchanged."
    }
}
if (Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 3306 is already in use. Stop the existing database or choose another MySQL port before continuing."
}

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$config = @"
[mysqld]
basedir="$($mysqlRoot.Replace('\', '/'))"
datadir="$($dataDirectory.Replace('\', '/'))"
port=3306
bind-address=127.0.0.1
mysqlx=0
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
"@
[System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

& $mysqlServer "--defaults-file=$configPath" --initialize-insecure --console
if ($LASTEXITCODE -ne 0) {
    throw "MySQL data initialization failed with exit code $LASTEXITCODE."
}

& $mysqlServer --install $serviceName "--defaults-file=$configPath"
if ($LASTEXITCODE -ne 0) {
    throw "MySQL Windows service installation failed with exit code $LASTEXITCODE."
}

Start-Service -Name $serviceName
$service = Get-Service -Name $serviceName
$service.WaitForStatus("Running", [TimeSpan]::FromSeconds(45))

$databasePassword = [Guid]::NewGuid().ToString("N")
$randomBytes = New-Object byte[] 48
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($randomBytes)
$sessionSecret = [BitConverter]::ToString($randomBytes).Replace("-", "").ToLowerInvariant()
$randomGenerator.Dispose()
$alterRootPassword = "ALTER USER 'root'@'localhost' IDENTIFIED BY '$databasePassword';"

$alterRootPassword | & $mysqlClient --protocol=tcp --host=127.0.0.1 --port=3306 --user=root --batch --skip-column-names
if ($LASTEXITCODE -ne 0) {
    Stop-Service -Name $serviceName -Force
    throw "MySQL started, but the root password could not be set. Keep the service stopped until it is secured."
}

$environment = @"
NODE_ENV=development
PORT=3001
TRUST_PROXY=0
SESSION_SECRET=$sessionSecret
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=$databasePassword
DB_NAME=mummas_proud_school
"@
[System.IO.File]::WriteAllText($envPath, $environment, [System.Text.UTF8Encoding]::new($false))

Push-Location $projectRoot
try {
    & npm.cmd run db:init
    if ($LASTEXITCODE -ne 0) {
        throw "MySQL is secured, but application database initialization failed. Review .env and rerun npm.cmd run db:init."
    }
} finally {
    Pop-Location
}

Write-Host "Local MySQL is secured and ready. Application credentials were saved to the ignored .env file."
Write-Host "Next, create an administrator with the steps in README.md, then run npm.cmd start."
