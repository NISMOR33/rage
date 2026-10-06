$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.vision_hold_clicker.mouse'
if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Force
}
Write-Host 'Enregistrement du compagnon Windows supprime.'
