#!/usr/bin/env bash
set -euo pipefail

# One-click deploy using existing sshmgr/gcp helpers.
# - gcp <localfile> 2    => upload to /tmp on server #2
# - sshmgr 2 <command>   => run command on server #2

SERVER_ID="${1:-2}"
APP_NAME="minimaths"
APP_DIR="/home/ec2-user/${APP_NAME}"
SERVICE_NAME="${APP_NAME}.service"
LOCAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
RELEASE_NAME="${APP_NAME}_release_$(date +%Y%m%d_%H%M%S)"
RELEASE_TAR="/tmp/${RELEASE_NAME}.tar.gz"
REMOTE_DEPLOY_SH="/tmp/${APP_NAME}_remote_deploy.sh"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

require_cmd tar
require_cmd gcp
require_cmd sshmgr

echo "==> Packaging release: ${RELEASE_TAR}"
tar -C "${LOCAL_ROOT}" \
  -czf "${RELEASE_TAR}" \
  index.html mini-eng.html xiaoguwen.html novel.html app.js mini-eng.js xiaoguwen.js novel.js server.mjs package.json minimaths-icon.svg site.webmanifest icon-192.png icon-512.png apple-touch-icon.png

echo "==> Preparing remote deploy script"
TMP_LOCAL_REMOTE_SH="$(mktemp)"
cat > "${TMP_LOCAL_REMOTE_SH}" <<'REMOTE'
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="$1"
APP_DIR="$2"
SERVICE_NAME="$3"
ARCHIVE_PATH="$4"

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Archive not found on remote: ${ARCHIVE_PATH}"
  exit 1
fi

NODE_BIN="$(command -v node || true)"
node_major_version() {
  local bin="$1"
  "${bin}" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo "0"
}

install_node_22() {
  echo "Node.js >= 22 not found. Installing..."
  if command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo dnf install -y nodejs
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo yum install -y nodejs
    return
  fi
  echo "Unsupported package manager. Install Node.js >= 22 manually."
  exit 1
}

if [[ -z "${NODE_BIN}" ]]; then
  install_node_22
  NODE_BIN="$(command -v node || true)"
fi

NODE_MAJOR="$(node_major_version "${NODE_BIN:-node}")"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  install_node_22
  NODE_BIN="$(command -v node || true)"
  NODE_MAJOR="$(node_major_version "${NODE_BIN:-node}")"
fi

if [[ -z "${NODE_BIN}" || "${NODE_MAJOR}" -lt 22 ]]; then
  echo "Node.js >= 22 install failed. Please install manually and redeploy."
  exit 1
fi

mkdir -p "${APP_DIR}"
tar -xzf "${ARCHIVE_PATH}" -C "${APP_DIR}"
mkdir -p "${APP_DIR}/data"

UNIT_FILE_CONTENT="[Unit]
Description=MiniMaths Service
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/server.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
"

printf "%s" "${UNIT_FILE_CONTENT}" | sudo tee "/etc/systemd/system/${SERVICE_NAME}" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}" >/dev/null
sudo systemctl restart "${SERVICE_NAME}"

echo "Service status:"
sudo systemctl --no-pager --full status "${SERVICE_NAME}" || true
echo
echo "App should be available at: http://<your-ec2-ip>:3000"
REMOTE

chmod +x "${TMP_LOCAL_REMOTE_SH}"

echo "==> Uploading release and remote script via gcp"
gcp "${RELEASE_TAR}" "${SERVER_ID}"
gcp "${TMP_LOCAL_REMOTE_SH}" "${SERVER_ID}"

REMOTE_ARCHIVE_PATH="/tmp/$(basename "${RELEASE_TAR}")"
REMOTE_SCRIPT_PATH="/tmp/$(basename "${TMP_LOCAL_REMOTE_SH}")"

echo "==> Running remote deploy via sshmgr ${SERVER_ID}"
set +e
sshmgr "${SERVER_ID}" "bash ${REMOTE_SCRIPT_PATH} ${APP_NAME} ${APP_DIR} ${SERVICE_NAME} ${REMOTE_ARCHIVE_PATH}"
GC_EXIT=$?
set -e

rm -f "${TMP_LOCAL_REMOTE_SH}" "${RELEASE_TAR}"

if [[ ${GC_EXIT} -ne 0 ]]; then
  echo
  echo "Remote auto-run failed. You can run these manually:"
  echo "  sshmgr ${SERVER_ID} \"bash ${REMOTE_SCRIPT_PATH} ${APP_NAME} ${APP_DIR} ${SERVICE_NAME} ${REMOTE_ARCHIVE_PATH}\""
  exit ${GC_EXIT}
fi

echo "==> Deploy done."
