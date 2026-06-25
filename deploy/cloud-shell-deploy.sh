#!/usr/bin/env bash
# Run in Yandex Cloud Shell (console.cloud.yandex.ru -> icon >_).
# No OAuth token needed - yc is already logged in.
set -euo pipefail

VM_NAME="assistant-4p"
ZONE="ru-central1-a"
APP_DIR="/opt/assistant-4p"
REPO="https://github.com/ninakrasavina772-star/assistant-4p.git"

echo "=== assistant-4p deploy via Cloud Shell ==="

if ! command -v yc >/dev/null 2>&1; then
  echo "ERROR: yc not found (use Yandex Cloud Shell)"
  exit 1
fi

FOLDER_ID=$(yc config get folder-id 2>/dev/null || true)
if [ -z "$FOLDER_ID" ]; then
  echo "Pick folder in Cloud Shell if asked, then run again."
  yc init --folder-id b1gfhds31e8d5eaccn57 || yc init
  FOLDER_ID=$(yc config get folder-id)
fi

# SSH key for VM access
if [ ! -f ~/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -q
fi
PUB=$(cat ~/.ssh/id_ed25519.pub)

# Subnet in any ru-central1 zone
SUBNET_ID=""
for z in ru-central1-a ru-central1-b ru-central1-c; do
  SUBNET_ID=$(yc vpc subnet list --format json | python3 -c "
import json,sys
z='$z'
for s in json.load(sys.stdin):
  if s.get('zone_id')==z:
    print(s['id']); break
" 2>/dev/null || true)
  if [ -n "$SUBNET_ID" ]; then ZONE="$z"; break; fi
done
if [ -z "$SUBNET_ID" ]; then
  echo "ERROR: no subnet in ru-central1. Create default VPC in console."
  exit 1
fi
echo "Zone: $ZONE, subnet: $SUBNET_ID"

NETWORK_ID=$(yc vpc subnet get "$SUBNET_ID" --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['network_id'])")

# Security group
SG_ID=$(yc vpc security-group list --format json | python3 -c "
import json,sys
for g in json.load(sys.stdin):
  if g.get('name')=='assistant-4p-sg':
    print(g['id']); break
" 2>/dev/null || true)
if [ -z "$SG_ID" ]; then
  SG_ID=$(yc vpc security-group create --name assistant-4p-sg --network-id "$NETWORK_ID" \
    --rule "direction=ingress,port=22,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
    --rule "direction=ingress,port=80,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
    --rule "direction=ingress,port=443,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
    --rule "direction=ingress,port=3000,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
    --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
fi

if ! yc compute instance get "$VM_NAME" &>/dev/null; then
  echo "Creating VM $VM_NAME ..."
  yc compute instance create \
    --name "$VM_NAME" \
    --zone "$ZONE" \
    --cores 2 \
    --memory 4 \
    --create-boot-disk "size=20,image-family=ubuntu-2404-lts,image-folder-id=standard-images" \
    --network-interface "subnet-id=$SUBNET_ID,nat-ip-version=ipv4,security-group-ids=$SG_ID" \
    --metadata "ssh-keys=ubuntu:$PUB"
else
  echo "VM $VM_NAME already exists"
fi

IP=$(yc compute instance get "$VM_NAME" --format json | python3 -c "
import json,sys
j=json.load(sys.stdin)
print(j['network_interfaces'][0]['primary_v4_address']['one_to_one_nat']['address'])
")
echo "VM IP: $IP"

echo "Waiting for SSH..."
for i in $(seq 1 30); do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i ~/.ssh/id_ed25519 "ubuntu@$IP" "echo ok" 2>/dev/null; then
    break
  fi
  sleep 10
done

# Env: user must upload .env.production to Cloud Shell home first, OR we use minimal
ENV_FILE="$HOME/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo "!!! Upload .env.production to Cloud Shell home:"
  echo "    Cloud Shell menu (three lines) -> Upload -> choose .env.production from your PC"
  echo "    File must be at: $ENV_FILE"
  echo "    Then run this script again."
  exit 0
fi

# Patch URLs for IP
BASE="http://${IP}:3000"
grep -v '^NEXTAUTH_URL=' "$ENV_FILE" | grep -v '^NEXT_PUBLIC_APP_ORIGIN=' > /tmp/env.prod || true
{
  echo "NEXTAUTH_URL=$BASE"
  echo "NEXT_PUBLIC_APP_ORIGIN=$BASE"
  echo "COMPARE_SKIP_AUTH=0"
  cat /tmp/env.prod
} > /tmp/env.production.final

scp -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519 /tmp/env.production.final "ubuntu@$IP:/tmp/.env.production"

ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519 "ubuntu@$IP" bash -s <<'REMOTE'
set -e
sudo apt-get update -qq
sudo apt-get install -y -qq git ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu || true
if [ ! -d /opt/assistant-4p/.git ]; then
  sudo git clone https://github.com/ninakrasavina772-star/assistant-4p.git /opt/assistant-4p
fi
sudo cp /tmp/.env.production /opt/assistant-4p/.env.production
cd /opt/assistant-4p
sudo git pull origin main
sudo docker compose build
sudo docker compose up -d
sleep 5
curl -sf http://127.0.0.1:3000/api/health && echo " HEALTH OK"
REMOTE

echo ""
echo "=== DONE ==="
echo "Open: http://${IP}:3000/ozon-images"
echo "Share this URL with colleagues."
