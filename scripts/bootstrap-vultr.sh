#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script from the Vultr web console as root." >&2
  exit 1
fi

app_domain="${1:-vastoptionmarkets.com}"
if [[ ! "${app_domain}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Pass a valid hostname, for example: $0 vastoptionmarkets.com" >&2
  exit 1
fi

deploy_user="deploy"
deploy_public_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID2fkE2nSiCxnVVYPHrt2VH1v1AdB72/xG/dE2ocm github-actions-vultr-deploy"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl debian-archive-keyring debian-keyring gnupg openssh-server ufw

if ! id "${deploy_user}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${deploy_user}"
fi
install -d -o "${deploy_user}" -g "${deploy_user}" -m 700 "/home/${deploy_user}/.ssh"
key_file="/home/${deploy_user}/.ssh/authorized_keys"
touch "${key_file}"
grep -qxF "${deploy_public_key}" "${key_file}" || printf '%s\n' "${deploy_public_key}" >> "${key_file}"
chown "${deploy_user}:${deploy_user}" "${key_file}"
chmod 600 "${key_file}"

if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io
fi
systemctl enable --now docker
usermod -aG docker "${deploy_user}"

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update
  apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<EOF
${app_domain} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy

if [[ ! -f /etc/vastoptiontraders.env ]]; then
  cat > /etc/vastoptiontraders.env <<'ENV'
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MEGAPAY_API_KEY=
MEGAPAY_EMAIL=
ENV
fi
chown root:docker /etc/vastoptiontraders.env
chmod 640 /etc/vastoptiontraders.env

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-vastoptiontraders.conf <<'SSH'
PubkeyAuthentication yes
PasswordAuthentication no
PermitRootLogin no
SSH
sshd -t
systemctl reload ssh

printf '\nVultr bootstrap finished.\n'
printf 'Domain configured in Caddy: %s\n' "${app_domain}"
printf 'Runtime env file to complete: /etc/vastoptiontraders.env (permissions 640, group docker)\n'
printf 'SSH host key fingerprints (verify before storing a known_hosts entry):\n'
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
printf 'Deploy public key installed for user: %s\n' "${deploy_user}"
printf 'Open Vultr firewall ports 22, 80, and 443 if a Vultr Cloud Firewall is attached.\n'
