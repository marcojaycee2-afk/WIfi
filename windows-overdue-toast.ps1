param(
  [ValidateSet('Setup','Run','Test','CheckNow','Remove')]
  [string]$Action = 'Setup',
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$Username = 'telecomadmin',
  [string]$Time = '06:00'
)

$ErrorActionPreference = 'Stop'
$taskName = 'NAPBOX Daily Overdue Payment Notification'
$dataDirectory = Join-Path $env:LOCALAPPDATA 'NAPBOX\WindowsNotifications'
$configPath = Join-Path $dataDirectory 'config.json'
$passwordPath = Join-Path $dataDirectory 'password.dpapi'
$logPath = Join-Path $dataDirectory 'notifications.log'

function Write-NotificationLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

function Show-Toast {
  param(
    [string]$Title,
    [string]$Body,
    [string]$Url
  )
  Import-Module BurntToast
  $children = @(
    New-BTText -Text $Title
    New-BTText -Text $Body
  )
  $binding = New-BTBinding -Children $children
  $visual = New-BTVisual -BindingGeneric $binding
  $content = New-BTContent -Visual $visual -ActivationType Protocol -Launch $Url
  Submit-BTNotification -Content $content
}

function Get-SafeWebsiteUrl([string]$Url) {
  $parsedUrl = $null
  if (-not [uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$parsedUrl) -or
      $parsedUrl.UserInfo -or
      ($parsedUrl.Scheme -ne 'https' -and
       -not ($parsedUrl.Scheme -eq 'http' -and
         ($parsedUrl.Host -eq 'localhost' -or $parsedUrl.Host -eq '127.0.0.1' -or $parsedUrl.Host -eq '::1')))) {
    throw 'The website URL must use HTTPS, or HTTP on localhost/127.0.0.1.'
  }
  $parsedUrl.AbsoluteUri.TrimEnd('/')
}

function Get-SavedConfig {
  if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $passwordPath)) {
    throw 'Notification setup is incomplete. Run this script with -Action Setup first.'
  }
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $config.BaseUrl = Get-SafeWebsiteUrl $config.BaseUrl
  $config
}

function Get-ApplicationState($Config) {
  $encryptedPassword = Get-Content -LiteralPath $passwordPath -Raw
  $securePassword = ConvertTo-SecureString -String $encryptedPassword
  $credential = [System.Net.NetworkCredential]::new($Config.Username, $securePassword)
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $loginBody = @{ username = $Config.Username; password = $credential.Password } | ConvertTo-Json
  $null = Invoke-RestMethod -Uri "$($Config.BaseUrl)/api/login" -Method Post `
    -WebSession $session -ContentType 'application/json' -Body $loginBody
  Invoke-RestMethod -Uri "$($Config.BaseUrl)/api/state" -Method Get -WebSession $session
}

function Get-OverdueSummary($State) {
  $today = (Get-Date).ToString('yyyy-MM-dd')
  $paymentsByInvoice = @{}
  foreach ($payment in $State.payments) {
    $key = "$($payment.clientId)|$($payment.month)"
    if (-not $paymentsByInvoice.ContainsKey($key)) { $paymentsByInvoice[$key] = 0.0 }
    $paymentsByInvoice[$key] += [double]$payment.amount
  }

  $clientsById = @{}
  foreach ($client in $State.clients) { $clientsById[$client.id] = $client }

  $clientsWithDebt = @{}
  $overdueInvoices = 0
  $totalBalance = 0.0
  foreach ($invoice in $State.billing) {
    if ($invoice.dueDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or $invoice.dueDate -gt $today) { continue }
    $key = "$($invoice.clientId)|$($invoice.month)"
    $paid = if ($paymentsByInvoice.ContainsKey($key)) { $paymentsByInvoice[$key] } else { 0.0 }
    $balance = [Math]::Max(0, [Math]::Round(([double]$invoice.amountDue - $paid), 2))
    if ($balance -le 0) { continue }

    $overdueInvoices++
    $totalBalance += $balance
    if (-not $clientsWithDebt.ContainsKey($invoice.clientId)) {
      $clientName = if ($clientsById.ContainsKey($invoice.clientId)) { $clientsById[$invoice.clientId].name } else { $invoice.clientId }
      $clientsWithDebt[$invoice.clientId] = @{ Name = $clientName; Balance = 0.0 }
    }
    $clientsWithDebt[$invoice.clientId].Balance += $balance
  }

  if ($overdueInvoices -eq 0) { return $null }
  $lines = @(
    $clientsWithDebt.Values |
      Sort-Object -Property Balance -Descending |
      Select-Object -First 4 |
      ForEach-Object { '{0} - {1}{2:N2}' -f $_.Name, [string][char]0x20B1, $_.Balance }
  )
  if ($clientsWithDebt.Count -gt 4) { $lines += "+$($clientsWithDebt.Count - 4) more client(s)" }
  $currency = [string][char]0x20B1
  $details = "$($clientsWithDebt.Count) client(s) - $currency$($totalBalance.ToString('N2')) outstanding`n$($lines -join "`n")"
  return @{
    Title = "$overdueInvoices unpaid invoice(s) due"
    Body = $details
  }
}

function Invoke-OverdueCheck {
  $config = Get-SavedConfig
  try {
    $response = Get-ApplicationState $config
    if (-not $response.state) { throw 'The app returned no saved state.' }
    $summary = Get-OverdueSummary $response.state
    if ($null -eq $summary) {
      Write-NotificationLog 'Check completed; no overdue balances.'
      return
    }
    Show-Toast $summary.Title $summary.Body $config.BaseUrl
    Write-NotificationLog "Sent reminder: $($summary.Title)."
  } catch {
    Write-NotificationLog "Check failed: $($_.Exception.Message)"
    throw
  }
}

switch ($Action) {
  'Setup' {
    $BaseUrl = Get-SafeWebsiteUrl $BaseUrl
    $parsedTime = [datetime]::MinValue
    if (-not [datetime]::TryParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedTime)) {
      throw 'Time must be in 24-hour HH:mm format, for example 08:00.'
    }
    if (-not (Get-Module -ListAvailable -Name BurntToast)) {
      Install-Module BurntToast -Scope CurrentUser -Force -AllowClobber
    }
    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    $password = Read-Host "Enter the NAPBOX password for $Username (protected for this Windows account)" -AsSecureString
    if ($password.Length -eq 0) { throw 'Password cannot be empty.' }
    ConvertFrom-SecureString $password | Set-Content -LiteralPath $passwordPath
    @{ BaseUrl = $BaseUrl; Username = $Username } |
      ConvertTo-Json |
      Set-Content -LiteralPath $configPath -Encoding UTF8

    $savedConfig = Get-SavedConfig
    $probe = Get-ApplicationState $savedConfig
    if (-not $probe.state) { throw 'The app returned no saved state. No scheduled task was created.' }

    $scriptPath = Join-Path $dataDirectory 'windows-overdue-toast.ps1'
    Copy-Item -LiteralPath $PSCommandPath -Destination $scriptPath -Force
    $powerShellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if (-not $powerShellCommand) { $powerShellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue }
    if (-not $powerShellCommand) { throw 'Could not find powershell.exe or pwsh.exe to run the scheduled task.' }
    $powerShellPath = $powerShellCommand.Source
    $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Action Run"
    $taskAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments
    $taskTrigger = New-ScheduledTaskTrigger -Daily -At $parsedTime
    $taskTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At $parsedTime `
      -RepetitionInterval (New-TimeSpan -Hours 6) `
      -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger `
      -Principal $taskPrincipal -Settings $taskSettings -Description 'Checks NAPBOX for overdue payments and shows a Windows notification.' -Force | Out-Null
    Write-Host "Scheduled unpaid-balance reminders every 6 hours, starting at $Time (Windows local time)."
    Write-Host 'Setup succeeded. Run -Action Test to send a sample toast, or -Action CheckNow to check for actual overdue bills now.'
  }
  'Test' {
    if (-not (Get-Module -ListAvailable -Name BurntToast)) { throw 'BurntToast is not installed. Run this script with -Action Setup first.' }
    $testUrl = if (Test-Path -LiteralPath $configPath) { (Get-SavedConfig).BaseUrl } else { Get-SafeWebsiteUrl $BaseUrl }
    Show-Toast 'NAPBOX notification test' 'Click this notification to open NAPBOX.' $testUrl
    Write-Host 'Test notification sent. Check Windows Notifications / Notification Center.'
  }
  'Run' { Invoke-OverdueCheck }
  'CheckNow' { Invoke-OverdueCheck; Write-Host "Check complete. Log: $logPath" }
  'Remove' {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host 'The NAPBOX daily notification scheduled task has been removed.'
  }
}
