<#
.SYNOPSIS
  Pulls the latest Traccia snapshot and attachments from omni into a dated
  folder on this Windows machine, then keeps only the newest copies.

.DESCRIPTION
  Read-only on the VPS: it lists the snapshots and streams a tar of the newest
  snapshot plus /data/attachments over ssh. Nothing on omni is written or
  deleted. Retention only ever deletes older pulled folders on THIS machine.

  Needs the Windows OpenSSH client (ssh.exe) and tar.exe (both ship with
  Windows 10 1803+ / Windows 11), and a working tailnet connection to omni.
  The tar is streamed with Start-Process -RedirectStandardOutput because
  PowerShell's own pipeline would corrupt binary data.

  First real run (MAT-1716) found that Git's GNU tar breaks on C:\ paths, so
  the script calls %SystemRoot%\System32\tar.exe explicitly. Use -WhatIf first.

.PARAMETER Destination
  Folder that holds the pulled copies. Default: $HOME\traccia-backups.

.PARAMETER Keep
  How many pulled copies to keep, newest first. Default 3.

.PARAMETER HostName
  ssh host. Default omni.

.PARAMETER RemoteDir
  Compose directory on the host. Default /opt/tracker.

.EXAMPLE
  .\pull-from-omni.ps1 -WhatIf     # print the steps, touch nothing

.EXAMPLE
  .\pull-from-omni.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Destination = (Join-Path $HOME 'traccia-backups'),
  [ValidateRange(1, 1000)][int]$Keep = 3,
  [string]$HostName = 'omni',
  [string]$RemoteDir = '/opt/tracker'
)

$ErrorActionPreference = 'Stop'

# The "ssh omni" alias in the ssh config sets RemoteCommand/RequestTTY, which
# break scripted use, so override both. BatchMode fails fast instead of
# prompting for a password.
$sshOpts = @('-o', 'RemoteCommand=none', '-o', 'RequestTTY=no', '-o', 'BatchMode=yes')

# Remote commands contain no double quotes, so Windows PowerShell's argument
# quoting passes them through intact.
$listCmd = "cd $RemoteDir && docker compose exec -T api sh -c 'ls -1 /data/backups/tracker-*.db'"
$tarCmd = "cd $RemoteDir && docker compose exec -T api sh -c 'cd /data && tar -cf - backups/{0} `$(test -d attachments && echo attachments)'"

# Git for Windows puts a GNU tar first on PATH; it reads "C:\..." as host:path
# and fails. Use the bsdtar that ships with Windows.
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $Destination "omni-$stamp"
$tarFile = Join-Path $Destination ".omni-$stamp.tar.partial"

if ($WhatIfPreference) {
  Write-Host "[WhatIf] ssh $($sshOpts -join ' ') $HostName `"$listCmd`"   (pick the newest tracker-<UTC>.db)"
  Write-Host "[WhatIf] ssh $($sshOpts -join ' ') $HostName `"$($tarCmd -f '<newest>')`" > $tarFile"
  Write-Host "[WhatIf] $tarExe -xf $tarFile -C $target"
  Write-Host "[WhatIf] keep the newest $Keep omni-* folders in $Destination, delete older ones (local only)"
  return
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

# 1. Find the newest snapshot (names sort by UTC timestamp).
$names = & ssh @sshOpts $HostName $listCmd
if ($LASTEXITCODE -ne 0) { throw "Listing snapshots on $HostName failed (exit $LASTEXITCODE)." }
$latest = $names |
  ForEach-Object { Split-Path -Leaf ([string]$_).Trim() } |
  Where-Object { $_ -match '^tracker-\d{8}T\d{6}Z\.db$' } |
  Sort-Object |
  Select-Object -Last 1
if (-not $latest) { throw "No tracker-<UTC>.db snapshot found in /data/backups on $HostName. Has the daily job run?" }
Write-Host "Latest snapshot on ${HostName}: $latest"

# 2. Stream snapshot + attachments as a tar into a local temp file.
try {
  $remote = $tarCmd -f $latest
  $sshArgs = ($sshOpts + @($HostName, "`"$remote`"")) -join ' '
  $p = Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $tarFile
  if ($p.ExitCode -ne 0) { throw "ssh tar stream failed (exit $($p.ExitCode))." }
  if ((Get-Item -LiteralPath $tarFile).Length -eq 0) { throw 'Pulled tar is empty.' }

  # 3. Extract into the dated folder; tar -t first catches a truncated stream.
  & $tarExe -tf $tarFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Pulled tar is corrupt or truncated.' }
  New-Item -ItemType Directory -Path $target | Out-Null
  & $tarExe -xf $tarFile -C $target
  if ($LASTEXITCODE -ne 0) { throw 'Extracting the pulled tar failed.' }
}
catch {
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  throw
}
finally {
  if (Test-Path -LiteralPath $tarFile) { Remove-Item -LiteralPath $tarFile -Force }
}

Write-Host "Pulled to $target"
Write-Host "  snapshot:    $(Join-Path $target "backups\$latest")"
Write-Host "  attachments: $(Join-Path $target 'attachments')"

# 4. Retention, local folders only, only after a successful pull. The dated
# names sort chronologically.
$old = Get-ChildItem -LiteralPath $Destination -Directory |
  Where-Object { $_.Name -match '^omni-\d{8}-\d{6}$' } |
  Sort-Object Name -Descending |
  Select-Object -Skip $Keep
foreach ($dir in $old) {
  if ($PSCmdlet.ShouldProcess($dir.FullName, 'Remove old pulled copy')) {
    Remove-Item -LiteralPath $dir.FullName -Recurse -Force
    Write-Host "Removed old copy $($dir.Name)"
  }
}
