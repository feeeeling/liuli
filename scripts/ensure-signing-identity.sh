#!/usr/bin/env bash
set -euo pipefail
NAME="Liuli Developer"

if security find-identity -v -p codesigning 2>/dev/null | grep -F -q "$NAME"; then
  echo "$NAME"
  exit 0
fi

DIR="${HOME}/.liuli/signing"
mkdir -p "$DIR"
KEY="$DIR/liuli.key"
CRT="$DIR/liuli.crt"
P12="$DIR/liuli.p12"

OPENSSL_BIN="${OPENSSL_BIN:-/usr/bin/openssl}"
"$OPENSSL_BIN" req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$KEY" -out "$CRT" \
  -subj "/CN=Liuli Developer/O=Liuli" \
  >/dev/null 2>&1

# LibreSSL PKCS#12 is importable by macOS Security.framework; Homebrew OpenSSL 3 is not.
"$OPENSSL_BIN" pkcs12 -export -out "$P12" -inkey "$KEY" -in "$CRT" \
  -passout pass:liuli -name "$NAME" >/dev/null 2>&1

KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
if [[ ! -f "$KEYCHAIN" ]]; then
  KEYCHAIN="${HOME}/Library/Keychains/login.keychain"
fi

security import "$P12" -k "$KEYCHAIN" -P liuli -A >/dev/null 2>&1 || true
security add-trusted-cert -d -r trustRoot -p codeSign -k "$KEYCHAIN" "$CRT" >/dev/null 2>&1 || true

if security find-identity -v -p codesigning 2>/dev/null | grep -F -q "$NAME"; then
  echo "$NAME"
else
  echo "-"
fi
