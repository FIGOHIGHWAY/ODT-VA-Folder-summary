#!/usr/bin/env bash
# Generates a self-signed TLS certificate for local HTTPS development.
# For production, replace nginx/certs/fullchain.pem and privkey.pem with a
# certificate issued by Let's Encrypt/certbot (or your CA of choice) and
# adjust nginx/conf.d/default.conf's server_name accordingly.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p certs

# MSYS_NO_PATHCONV avoids Git Bash on Windows mangling the leading "/" in -subj
export MSYS_NO_PATHCONV=1

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Wrote nginx/certs/privkey.pem and nginx/certs/fullchain.pem"
