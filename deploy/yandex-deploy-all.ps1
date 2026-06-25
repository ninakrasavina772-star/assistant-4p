# One-click: Yandex VM + deploy assistant-4p
# Double-click: deploy\ZAPUSTIT-PERENOS.bat
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$yc = Join-Path $env:USERPROFILE "yandex-cloud\bin\yc.exe"
$sshPub = Join-Path $env:USERPROFILE ".ssh\id_ed25519_yc.pub"
$sshKey = Join-Path $env:USERPROFILE ".ssh\id_ed25519_yc"
$vmName = "assistant-4p"
$script:zone = "ru-central1-a"

function Ensure-SshKey {
  if (-not (Test-Path $sshPub)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $sshPub) | Out-Null
    ssh-keygen -t ed25519 -f $sshKey -N '""' -q
  }
}

function Ensure-Yc {
  $binDir = Split-Path $yc
  if (-not (Test-Path $yc)) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Write-Host "Downloading Yandex Cloud CLI..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://storage.yandexcloud.net/yandexcloud-yc/release/0.138.0/windows/amd64/yc.exe" -OutFile $yc
  }
}

function Invoke-Yc {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $old = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  $out = & $yc @Args 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($code -ne 0) {
    return @{ Ok = $false; Out = $out; Code = $code }
  }
  return @{ Ok = $true; Out = $out; Code = 0 }
}

function Test-YcApi {
  $r = Invoke-Yc vpc subnet list --format json
  if (-not $r.Ok) { return $false }
  try {
    $subs = @($r.Out | ConvertFrom-Json)
    return ($subs.Count -ge 0)
  } catch {
    return $false
  }
}

function Ensure-YcAuth {
  if ((Invoke-Yc config list).Ok -and (Test-YcApi)) {
    Write-Host "Yandex: uzhe voshli" -ForegroundColor Green
    return
  }

  $oauthUrl = "https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec2fb"
  $cloudId = "b1g1rlk43m94n1p2igbi"
  $folderId = "b1gfhds31e8d5eaccn57"

  Write-Host ""
  Write-Host "=== Vhod v Yandex (odin raz) ===" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "1. Otkroetsya brauzer - nazhmite Razreshit" -ForegroundColor White
  Write-Host "2. Na beloy stranitse skopiruyte kod (stroka y0_...)" -ForegroundColor White
  Write-Host ""
  Start-Process $oauthUrl
  Start-Sleep -Seconds 2
  $token = Read-Host "3. VSTAVTE kod syuda i Enter"

  if (-not $token -or $token.Trim().Length -lt 20) {
    throw "Token pustoy. Zapustite skript snova."
  }
  $token = $token.Trim().Trim('"')
  if ($token -match "access_token=([^&\s]+)") { $token = $Matches[1] }

  Invoke-Yc config profile create default | Out-Null
  Invoke-Yc config profile activate default | Out-Null
  Invoke-Yc config set token $token | Out-Null
  Invoke-Yc config set cloud-id $cloudId | Out-Null
  Invoke-Yc config set folder-id $folderId | Out-Null
  Invoke-Yc config set compute-default-zone $script:zone | Out-Null

  if (-not (Test-YcApi)) {
    throw "Token ne podoshiel. Skopiruyte kod so stranicy Yandex i zapustite skript."
  }
  Write-Host "Yandex: OK" -ForegroundColor Green
}

function Resolve-SubnetId {
  $r = Invoke-Yc vpc subnet list --format json
  if (-not $r.Ok) {
    throw "Net dostupa k Yandex. Zapustite skript i vstavte token zanovo."
  }
  $subs = @($r.Out | ConvertFrom-Json)
  if ($subs.Count -eq 0) {
    throw "V papke net podsetey. Sozdayte VPC v console.cloud.yandex.ru (default set)."
  }

  foreach ($z in @("ru-central1-a", "ru-central1-b", "ru-central1-c")) {
    $hit = $subs | Where-Object { $_.zone_id -eq $z } | Select-Object -First 1
    if ($hit) {
      $script:zone = $z
      Write-Host "Zona: $z" -ForegroundColor DarkGray
      return $hit.id
    }
  }

  $any = $subs | Select-Object -First 1
  $script:zone = $any.zone_id
  Write-Host "Zona: $($any.zone_id)" -ForegroundColor DarkGray
  return $any.id
}

function Ensure-SecurityGroup {
  param([string]$NetworkId, [string]$SubnetId)
  $sgs = & $yc vpc security-group list --format json | ConvertFrom-Json
  $sg = $sgs | Where-Object { $_.name -eq "assistant-4p-sg" } | Select-Object -First 1
  if (-not $sg) {
    Write-Host "Creating security group (ports 22,80,443)..." -ForegroundColor Cyan
    $sgJson = & $yc vpc security-group create --name assistant-4p-sg --network-id $NetworkId --rule "direction=ingress,port=22,protocol=tcp,v4-cidrs=[0.0.0.0/0]" --rule "direction=ingress,port=80,protocol=tcp,v4-cidrs=[0.0.0.0/0]" --rule "direction=ingress,port=443,protocol=tcp,v4-cidrs=[0.0.0.0/0]" --format json
    $sg = $sgJson | ConvertFrom-Json
  }
  return $sg.id
}

function Get-OrCreateVm {
  $existing = & $yc compute instance list --format json | ConvertFrom-Json
  $vm = $existing | Where-Object { $_.name -eq $vmName } | Select-Object -First 1
  if ($vm) {
    Write-Host "VM already exists: $vmName" -ForegroundColor Green
    return $vm.id
  }

  $subnetId = Resolve-SubnetId
  $subnet = (& $yc vpc subnet get $subnetId --format json | ConvertFrom-Json)
  $networkId = $subnet.network_id
  $sgId = Ensure-SecurityGroup -NetworkId $networkId -SubnetId $subnetId

  Write-Host "Creating VM $vmName (2 vCPU, 4GB, Ubuntu 24.04)..." -ForegroundColor Cyan
  Write-Host "If error about quota/billing: add payment card in Yandex Cloud console." -ForegroundColor Yellow

  $pubKey = (Get-Content $sshPub -Raw).Trim()
  $meta = "ssh-keys=ubuntu:$pubKey"

  $out = & $yc compute instance create `
    --name $vmName `
    --zone $script:zone `
    --cores 2 `
    --memory 4 `
    --create-boot-disk "size=20,image-family=ubuntu-2404-lts,image-folder-id=standard-images" `
    --network-interface "subnet-id=$subnetId,nat-ip-version=ipv4,security-group-ids=$sgId" `
    --metadata $meta `
    --format json

  ($out | ConvertFrom-Json).id
}

function Get-VmIp {
  $json = & $yc compute instance get $vmName --format json | ConvertFrom-Json
  $nat = $json.network_interfaces[0].primary_v4_address.one_to_one_nat
  if (-not $nat -or -not $nat.address) { throw "VM has no public IP yet" }
  return $nat.address
}

function Deploy-App {
  param([string]$Ip)
  $envProd = Join-Path $Root ".env.production"
  if (-not (Test-Path $envProd)) {
    $local = Join-Path $Root ".env.local"
    if (Test-Path $local) {
      Copy-Item $local $envProd
      (Get-Content $envProd) | Where-Object { $_ -notmatch '^\s*VERCEL_' -and $_ -notmatch '^\s*BLOB_READ_WRITE' } | Set-Content $envProd
      if (-not (Select-String -Path $envProd -Pattern '^COMPARE_SKIP_AUTH=' -Quiet)) {
        Add-Content $envProd "COMPARE_SKIP_AUTH=0"
      }
    } else {
      Copy-Item (Join-Path $Root "deploy\env.production.example") $envProd
      Write-Host "Fill $envProd then re-run deploy." -ForegroundColor Red
      exit 1
    }
  }

  Write-Host "Waiting for SSH on $Ip ..." -ForegroundColor Cyan
  $sshUser = "ubuntu"
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    foreach ($u in @("ubuntu", "yc-user")) {
      ssh -i $sshKey -o StrictHostKeyChecking=no -o ConnectTimeout=5 "${u}@${Ip}" "echo ok" 2>$null
      if ($LASTEXITCODE -eq 0) { $sshUser = $u; $ok = $true; break }
    }
    if ($ok) { break }
    Start-Sleep -Seconds 10
  }
  if (-not $ok) { throw "SSH not ready on $Ip" }
  Write-Host "SSH user: $sshUser" -ForegroundColor DarkGray

  $baseUrl = "http://${Ip}:3000"
  (Get-Content $envProd) | ForEach-Object {
    if ($_ -match '^NEXTAUTH_URL=') { "NEXTAUTH_URL=$baseUrl" }
    elseif ($_ -match '^NEXT_PUBLIC_APP_ORIGIN=') { "NEXT_PUBLIC_APP_ORIGIN=$baseUrl" }
    else { $_ }
  } | Set-Content $envProd

  Write-Host "Deploying on server..." -ForegroundColor Cyan
  scp -i $sshKey -o StrictHostKeyChecking=no $envProd "${sshUser}@${Ip}:/tmp/.env.production"
  $remote = @'
set -e
sudo apt-get install -y -qq git ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER || true
if [ ! -d /opt/assistant-4p/.git ]; then
  sudo git clone https://github.com/ninakrasavina772-star/assistant-4p.git /opt/assistant-4p
fi
sudo cp /tmp/.env.production /opt/assistant-4p/.env.production
cd /opt/assistant-4p
sudo git pull origin main
if ! grep -q '^NEXT_PUBLIC_APP_ORIGIN=' .env.production 2>/dev/null; then
  AUTH=$(grep '^NEXTAUTH_URL=' .env.production | cut -d= -f2- | tr -d '"')
  echo "NEXT_PUBLIC_APP_ORIGIN=$AUTH" | sudo tee -a .env.production
fi
sudo docker compose build
sudo docker compose up -d
curl -sf http://127.0.0.1:3000/api/health && echo OK
'@
  ssh -i $sshKey -o StrictHostKeyChecking=no "${sshUser}@${Ip}" $remote
}

Write-Host "=== assistant-4p Yandex deploy ===" -ForegroundColor Green
Ensure-SshKey
Ensure-Yc
Ensure-YcAuth
$null = Get-OrCreateVm
Start-Sleep -Seconds 15
$ip = Get-VmIp
Write-Host ""
Write-Host "VM IP: $ip" -ForegroundColor Green
Deploy-App -Ip $ip
Write-Host ""
Write-Host "DONE. Open: http://${ip}:3000/ozon-images" -ForegroundColor Green
Write-Host "Next: point domain A-record to $ip, then HTTPS (step 2)." -ForegroundColor Yellow
Read-Host "Press Enter to close"
