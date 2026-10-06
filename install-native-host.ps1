param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $projectRoot 'native-host\VisionMouseHost.csproj'
$publishDir = Join-Path $projectRoot 'native-host\publish'
$hostExe = Join-Path $publishDir 'VisionMouseHost.exe'
$hostManifest = Join-Path $publishDir 'com.vision_hold_clicker.mouse.json'

dotnet publish $project -c Release -r win-x64 --self-contained false -o $publishDir
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExe)) {
  throw 'La compilation du compagnon Windows a echoue.'
}

$escapedPath = $hostExe.Replace('\', '\\')
$json = @"
{
  "name": "com.vision_hold_clicker.mouse",
  "description": "Compagnon souris native pour Vision Hold Clicker",
  "path": "$escapedPath",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ExtensionId/"]
}
"@
[IO.File]::WriteAllText($hostManifest, $json, [Text.UTF8Encoding]::new($false))

$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.vision_hold_clicker.mouse'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifest

Write-Host ''
Write-Host 'Compagnon Windows installe avec succes.' -ForegroundColor Green
Write-Host 'Fermez puis rouvrez Chrome avant le test.'
