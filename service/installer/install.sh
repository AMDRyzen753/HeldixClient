#!/usr/bin/env bash
# Heldix-Dienst – Installation mit einem Befehl (Linux-Server mit systemd, z. B. Debian oder Ubuntu)
#
#   sudo bash heldix-dienst-install.sh --domain example.de --email admin@example.de
#
# oder direkt aus dem Netz (die Datei muss dafür irgendwo per HTTPS liegen, z. B. als GitHub-Release):
#
#   curl -fsSL https://…/heldix-dienst-install.sh | sudo bash -s -- --domain example.de --email admin@example.de
#
# Ergebnis:
#   https://example.de        Webseite von HeldixClient (www.example.de leitet dorthin weiter)
#   https://api.example.de    Heldix-Dienst (API für Freunde, Capes und Heldix-Symbol)
#
# Was passiert:
#   - Node.js 24 und Caddy (HTTPS mit Let's Encrypt) werden in /opt/heldix-dienst installiert, geprüft per Prüfsumme.
#   - Der Dienst läuft als eigener Benutzer ohne Rechte, nur auf 127.0.0.1; Caddy stellt Webseite und API per HTTPS bereit.
#   - Daten liegen in /var/lib/heldix-dienst. Ein zweiter Aufruf aktualisiert, die Daten bleiben.
#   - Launcher-Updates: Installer und update.json kommen nach /var/lib/heldix-dienst/updates (per scp oder im Team-Bereich).
#   - Addon-Store: signierte Addons (JAR) liegen in /var/lib/heldix-dienst/addons, veröffentlicht im Team-Bereich;
#     Einreichungen von Spielern (noch ungeprüft) in addons/einreichungen, Screenshots in addons/screenshots.
#   - Anmeldung auf der Webseite (ohne Passwort, über den Launcher) unter https://<domain>/konto, Team-Bereich dort;
#     mit --minecraft-login zusätzlich direkt mit dem Minecraft-Konto (über Microsoft, docs/einrichtung.md).
#   - Verwaltung (Meldungen, Sperren, Team): sudo heldix-dienst-admin hilfe; erster Admin: sudo heldix-dienst-admin team <name> admin
#
# Optionen:
#   --domain <name>      Hauptdomain; Webseite dort, API auf api.<domain>. Die Namen müssen per DNS auf diesen Server zeigen.
#   --api-domain <name>  andere Adresse für die API (Standard: api.<domain>)
#   --email <adresse>    E-Mail für Let's Encrypt (Hinweise zu ablaufenden Zertifikaten), empfohlen
#   --no-website         nur die API, keine Webseite
#   --no-www             keine Weiterleitung von www.<domain>
#   --port <zahl>        interner Port des Dienstes (Standard 8787)
#   --no-https           ohne Caddy: der Dienst lauscht nur auf 127.0.0.1:<port>, ein eigener Reverse-Proxy macht HTTPS
#                        (die Webseite liegt dann zum Ausliefern in /opt/heldix-dienst/app/website)
#   --minecraft-login    Anmeldung mit dem Minecraft-Konto auf der Webseite einschalten (App-ID des Launchers; vorher in
#                        Azure die Umleitungs-URI https://<api-domain>/v1/web/auth/microsoft/callback eintragen).
#                        Fragt nach dem Client-Geheimnis (Eingabe unsichtbar; leer = ohne Geheimnis). Bleibt bei Updates an.
#   --ms-client-secret-file <datei>
#                        Client-Geheimnis aus dieser Datei übernehmen (schaltet die Anmeldung ein; Datei danach löschen)
#   --ms-client-id <id>  andere App-ID (nur für eigene Builds: muss die von Mojang freigegebene App-ID des Launchers sein)
#   --no-minecraft-login Anmeldung mit dem Minecraft-Konto wieder ausschalten (löscht auch das gespeicherte Geheimnis)
#   --uninstall          alles entfernen (Daten bleiben); mit --purge auch Daten und Zertifikate
#   --yes                keine Rückfragen
#   --help               diese Hilfe
#
# Erzeugt von service/installer/build.mjs (npm run installer). Version: __HELDIX_VERSION__

set -euo pipefail

# Alles steckt in Funktionen; ausgeführt wird erst ganz am Ende. Bricht ein Download per curl | bash ab,
# läuft so kein halbes Skript.

HELDIX_VERSION="__HELDIX_VERSION__"
INSTALL_DIR="/opt/heldix-dienst"
DATA_DIR="/var/lib/heldix-dienst"
UPDATES_DIR="$DATA_DIR/updates"
ADDONS_DIR="$DATA_DIR/addons"
ADMIN_BIN="/usr/local/bin/heldix-dienst-admin"
CADDY_DATA_DIR="/var/lib/heldix-dienst-caddy"
CONFIG_DIR="/etc/heldix-dienst"
ENV_FILE="$CONFIG_DIR/dienst.env"
CADDYFILE="$CONFIG_DIR/Caddyfile"
# öffentlicher Update-Schlüssel (aus dem Launcher, liegt dem Installer bei): prüft Updates aus dem Team-Bereich
UPDATE_KEY_FILE="$CONFIG_DIR/update-public-key.pem"
# Client-Geheimnis der Azure-App (Anmeldung mit dem Minecraft-Konto): lesen dürfen nur root und der Dienst
MS_SECRET_FILE="$CONFIG_DIR/ms-client-secret"
# App-ID des Launchers (aus launcher/src/main/config.ts, eingesetzt von build.mjs): von Mojang freigegeben
DEFAULT_MS_CLIENT_ID="__HELDIX_MS_CLIENT_ID__"
SERVICE_USER="heldix-dienst"
CADDY_USER="heldix-caddy"
UNIT="heldix-dienst"
CADDY_UNIT="heldix-dienst-caddy"
# Rückfall, falls GitHub die neueste Caddy-Version nicht verrät (z. B. API-Limit)
CADDY_FALLBACK_VERSION="2.10.2"

DOMAIN=""
API_DOMAIN=""
EMAIL=""
PORT="8787"
HTTPS=1
WEBSITE=1
WWW=1
PLACEHOLDERS=0
UNINSTALL=0
PURGE=0
ASSUME_YES=0
# Anmeldung mit dem Minecraft-Konto: "" = wie bisher (bei Updates unverändert), 1 = einschalten, 0 = ausschalten
MS_LOGIN=""
MS_CLIENT_ID=""
MS_SECRET_SOURCE=""

# ---------------------------------------------------------------------------------------------
# Ausgabe
# ---------------------------------------------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step() { printf '%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '%sFehler:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
  sed -n '2,/^# Erzeugt/p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
  cat <<EOF
Aufruf: sudo bash heldix-dienst-install.sh --domain example.de [--email admin@example.de]
EOF
}

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  # bei curl | bash ist stdin das Skript: Rückfragen über das Terminal
  if [ -r /dev/tty ]; then
    local answer
    printf '%s [j/N] ' "$1" > /dev/tty
    read -r answer < /dev/tty || return 1
    case "$answer" in j|J|ja|Ja|y|Y|yes) return 0 ;; esac
    return 1
  fi
  die "$1 – ohne Terminal bitte --yes angeben."
}

# ---------------------------------------------------------------------------------------------
# Eingaben
# ---------------------------------------------------------------------------------------------

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) DOMAIN="${2:-}"; shift 2 ;;
      --domain=*) DOMAIN="${1#*=}"; shift ;;
      --api-domain) API_DOMAIN="${2:-}"; shift 2 ;;
      --api-domain=*) API_DOMAIN="${1#*=}"; shift ;;
      --no-website) WEBSITE=0; shift ;;
      --no-www) WWW=0; shift ;;
      --email) EMAIL="${2:-}"; shift 2 ;;
      --email=*) EMAIL="${1#*=}"; shift ;;
      --port) PORT="${2:-}"; shift 2 ;;
      --port=*) PORT="${1#*=}"; shift ;;
      --no-https) HTTPS=0; shift ;;
      --minecraft-login) [ "$MS_LOGIN" != 0 ] || die "--minecraft-login und --no-minecraft-login schließen sich aus."; MS_LOGIN=1; shift ;;
      --no-minecraft-login) [ "$MS_LOGIN" != 1 ] || die "--minecraft-login und --no-minecraft-login schließen sich aus."; MS_LOGIN=0; shift ;;
      --ms-client-id) MS_CLIENT_ID="${2:-}"; [ "$MS_LOGIN" != 0 ] || die "--ms-client-id passt nicht zu --no-minecraft-login."; MS_LOGIN=1; shift 2 ;;
      --ms-client-id=*) MS_CLIENT_ID="${1#*=}"; [ "$MS_LOGIN" != 0 ] || die "--ms-client-id passt nicht zu --no-minecraft-login."; MS_LOGIN=1; shift ;;
      --ms-client-secret-file) MS_SECRET_SOURCE="${2:-}"; [ "$MS_LOGIN" != 0 ] || die "--ms-client-secret-file passt nicht zu --no-minecraft-login."; MS_LOGIN=1; shift 2 ;;
      --ms-client-secret-file=*) MS_SECRET_SOURCE="${1#*=}"; [ "$MS_LOGIN" != 0 ] || die "--ms-client-secret-file passt nicht zu --no-minecraft-login."; MS_LOGIN=1; shift ;;
      --uninstall) UNINSTALL=1; shift ;;
      --purge) PURGE=1; shift ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *) die "Unbekannte Option: $1 (Hilfe: --help)" ;;
    esac
  done

  DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
  DOMAIN="${DOMAIN%.}"
  DOMAIN="${DOMAIN#www.}"
  API_DOMAIN="$(printf '%s' "$API_DOMAIN" | tr '[:upper:]' '[:lower:]')"
  API_DOMAIN="${API_DOMAIN%.}"
  if [ "$UNINSTALL" = 0 ]; then
    if [ "$HTTPS" = 1 ]; then
      [ -n "$DOMAIN" ] || die "Bitte die Domain angeben, z. B. --domain example.de (oder --no-https mit eigenem Reverse-Proxy)."
    fi
    [ -n "$API_DOMAIN" ] || { [ -n "$DOMAIN" ] && API_DOMAIN="api.$DOMAIN"; }
    local name
    for name in "$DOMAIN" "$API_DOMAIN"; do
      [ -n "$name" ] || continue
      printf '%s' "$name" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' \
        || die "Ungültige Domain: $name"
    done
    if [ "$HTTPS" = 1 ] && [ "$WEBSITE" = 1 ] && [ "$API_DOMAIN" = "$DOMAIN" ]; then
      die "Webseite und API brauchen verschiedene Adressen (z. B. example.de und api.example.de) – oder --no-website."
    fi
    # www nur für eine Hauptdomain, nicht für Subdomains wie dienst.example.de
    case "$DOMAIN" in *.*.*) WWW=0 ;; esac
    [ "$WEBSITE" = 1 ] || WWW=0
    if [ -n "$EMAIL" ]; then
      printf '%s' "$EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "Ungültige E-Mail-Adresse: $EMAIL"
    fi
    case "$PORT" in ''|*[!0-9]*) die "Ungültiger Port: $PORT" ;; esac
    [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "Port bitte zwischen 1024 und 65535 wählen."
    check_microsoft_args
  fi
}

check_microsoft_args() {
  [ "$MS_LOGIN" = 1 ] || return 0
  [ "$WEBSITE" = 1 ] || die "Die Anmeldung mit dem Minecraft-Konto gibt es nur mit Webseite (ohne --no-website)."
  [ -n "$API_DOMAIN" ] || die "Für die Anmeldung mit dem Minecraft-Konto braucht es die Adresse der API (--domain oder --api-domain): Daraus entsteht die Umleitungs-URI."
  if [ -z "$MS_CLIENT_ID" ]; then
    case "$DEFAULT_MS_CLIENT_ID" in __*) MS_CLIENT_ID="" ;; *) MS_CLIENT_ID="$DEFAULT_MS_CLIENT_ID" ;; esac
  fi
  [ -n "$MS_CLIENT_ID" ] || die "Diesem Installer liegt keine App-ID bei (launcher/src/main/config.ts). Bitte mit --ms-client-id angeben."
  MS_CLIENT_ID="$(printf '%s' "$MS_CLIENT_ID" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$MS_CLIENT_ID" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
    || die "Ungültige App-ID: $MS_CLIENT_ID (erwartet die Anwendungs-ID aus Azure, z. B. 00000000-0000-0000-0000-000000000000)"
  if [ -n "$MS_SECRET_SOURCE" ]; then
    [ -f "$MS_SECRET_SOURCE" ] && [ -r "$MS_SECRET_SOURCE" ] || die "Datei mit dem Client-Geheimnis nicht lesbar: $MS_SECRET_SOURCE"
    [ -n "$(head -n1 "$MS_SECRET_SOURCE" | tr -d '[:space:]')" ] || die "Die Datei mit dem Client-Geheimnis ist leer: $MS_SECRET_SOURCE"
  fi
}

# ---------------------------------------------------------------------------------------------
# Voraussetzungen
# ---------------------------------------------------------------------------------------------

check_system() {
  [ "$(id -u)" = 0 ] || die "Bitte mit sudo bzw. als root ausführen."
  [ "$(uname -s)" = Linux ] || die "Der Installer ist für Linux-Server."
  [ -d /run/systemd/system ] || die "systemd läuft nicht. Der Installer braucht einen Server mit systemd (z. B. Debian 12, Ubuntu 22.04 oder neuer)."
  case "$(uname -m)" in
    x86_64|amd64) NODE_ARCH="x64"; CADDY_ARCH="amd64" ;;
    aarch64|arm64) NODE_ARCH="arm64"; CADDY_ARCH="arm64" ;;
    *) die "Prozessor $(uname -m) wird nicht unterstützt (nur x86_64 und arm64)." ;;
  esac
}

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q "$@" >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q "$@" >/dev/null
  else
    die "Bitte diese Programme installieren und den Installer erneut starten: $*"
  fi
}

ensure_tools() {
  local missing=()
  command -v curl >/dev/null 2>&1 || missing+=(curl)
  command -v tar >/dev/null 2>&1 || missing+=(tar)
  command -v gzip >/dev/null 2>&1 || missing+=(gzip)
  command -v base64 >/dev/null 2>&1 || missing+=(coreutils)
  command -v sha256sum >/dev/null 2>&1 || missing+=(coreutils)
  # runuser: heldix-dienst-admin läuft damit als Benutzer des Dienstes
  command -v runuser >/dev/null 2>&1 || missing+=(util-linux)
  [ -e /etc/ssl/certs/ca-certificates.crt ] || [ -e /etc/pki/tls/certs/ca-bundle.crt ] || missing+=(ca-certificates)
  if [ ${#missing[@]} -gt 0 ]; then
    step "Fehlende Programme installieren: ${missing[*]}"
    install_packages "${missing[@]}"
  fi
}

download() {
  # download <url> <datei>
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 15 -o "$2" "$1" || die "Download fehlgeschlagen: $1"
}

port_owner() {
  # "<programm> <pid>" des Prozesses, der auf TCP-Port $1 lauscht (leer = frei)
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)",pid=\([0-9]*\).*/\1 \2/p' | head -n1
  fi
}

own_pids() {
  # Prozesse der eigenen Dienste (bei einem Update belegen sie die Ports schon)
  systemctl show -p MainPID --value "$UNIT" 2>/dev/null || true
  systemctl show -p MainPID --value "$CADDY_UNIT" 2>/dev/null || true
}

port_taken_by_other() {
  # true, wenn Port $1 von einem fremden Programm belegt ist; Name steht dann in PORT_OWNER
  local owner pid
  owner="$(port_owner "$1")"
  [ -n "$owner" ] || return 1
  pid="${owner##* }"
  PORT_OWNER="${owner% *}"
  if [ -n "$pid" ] && own_pids | grep -qx "$pid"; then return 1; fi
  return 0
}

check_ports() {
  local port
  if [ "$HTTPS" = 1 ]; then
    for port in 80 443; do
      if port_taken_by_other "$port"; then
        die "Port $port ist schon belegt (von $PORT_OWNER). Läuft bereits ein Webserver (nginx, Apache, Plesk …), installiere mit --no-https und leite die Domain dort an 127.0.0.1:$PORT weiter (Beispiele in docs/dienst.md)."
      fi
    done
  fi
  if port_taken_by_other "$PORT"; then
    die "Port $PORT ist schon belegt (von $PORT_OWNER). Bitte mit --port einen anderen wählen."
  fi
}

site_hosts() {
  # alle Namen, für die Caddy ein Zertifikat braucht
  printf '%s\n' "$API_DOMAIN"
  if [ "$WEBSITE" = 1 ]; then printf '%s\n' "$DOMAIN"; fi
  if [ "$WWW" = 1 ]; then printf 'www.%s\n' "$DOMAIN"; fi
}

check_dns() {
  [ "$HTTPS" = 1 ] || return 0
  local host resolved local_ips match ip missing=""
  local_ips="$(ip -o addr show 2>/dev/null | awk '{split($4, a, "/"); print a[1]}' || hostname -I 2>/dev/null | tr ' ' '\n')"
  for host in $(site_hosts); do
    resolved="$(getent ahosts "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)"
    if [ -z "$resolved" ]; then
      warn "DNS: $host hat (noch) keinen Eintrag – dafür gibt es so kein HTTPS-Zertifikat."
      missing="$missing $host"
      continue
    fi
    match=0
    for ip in $resolved; do
      if printf '%s\n' "$local_ips" | grep -qx "$ip"; then match=1; fi
    done
    if [ "$match" = 1 ]; then
      ok "DNS: $host zeigt auf diesen Server"
    else
      warn "DNS: $host zeigt auf $(printf '%s' "$resolved" | tr '\n' ' ')– keine Adresse dieses Servers."
      warn "Hinter NAT oder einem Load-Balancer ist das normal; sonst bekommt Caddy kein Zertifikat."
    fi
  done
  if [ -n "$missing" ]; then
    confirm "Trotzdem weitermachen? (Caddy holt die Zertifikate von selbst, sobald die DNS-Einträge stimmen)" \
      || die "Abgebrochen. Erst A- bzw. AAAA-Einträge für$missing auf diesen Server setzen."
  fi
}

# ---------------------------------------------------------------------------------------------
# Installation
# ---------------------------------------------------------------------------------------------

create_users() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
      || useradd -r -d "$DATA_DIR" -M -s /sbin/nologin "$SERVICE_USER"
  fi
  install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  # Launcher-Updates: schreiben darf nur der Dienst (Uploads im Team-Bereich) und root (scp), lesen alle
  install -d -m 755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$UPDATES_DIR"
  # Addon-Store: JARs schreibt der Dienst (Uploads im Team-Bereich); ein bestehender Ordner gehört danach wieder ihm
  install -d -m 755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$ADDONS_DIR"
  if [ "$HTTPS" = 1 ] && ! id "$CADDY_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$CADDY_DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$CADDY_USER" 2>/dev/null \
      || useradd -r -d "$CADDY_DATA_DIR" -M -s /sbin/nologin "$CADDY_USER"
  fi
  if [ "$HTTPS" = 1 ]; then install -d -m 700 -o "$CADDY_USER" -g "$CADDY_USER" "$CADDY_DATA_DIR"; fi
  install -d -m 755 "$INSTALL_DIR" "$CONFIG_DIR"
}

install_node() {
  step "Node.js 24"
  local work sums file version
  work="$(mktemp -d)"
  download "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt" "$work/SHASUMS256.txt"
  file="$(grep -oE "node-v24\.[0-9]+\.[0-9]+-linux-${NODE_ARCH}\.tar\.gz" "$work/SHASUMS256.txt" | head -n1)"
  [ -n "$file" ] || die "Keine Node.js-24-Version für linux-$NODE_ARCH gefunden."
  version="${file#node-}"; version="${version%%-linux*}"
  if [ -x "$INSTALL_DIR/node-$version/bin/node" ]; then
    ok "Node.js $version ist schon installiert"
  else
    info "lade Node.js $version …"
    download "https://nodejs.org/dist/latest-v24.x/$file" "$work/$file"
    (cd "$work" && grep " $file\$" SHASUMS256.txt | sha256sum -c --status) || die "Prüfsumme von $file stimmt nicht."
    rm -rf "$INSTALL_DIR/node-$version.tmp"
    mkdir -p "$INSTALL_DIR/node-$version.tmp"
    tar -xzf "$work/$file" -C "$INSTALL_DIR/node-$version.tmp" --strip-components=1 --no-same-owner
    mv "$INSTALL_DIR/node-$version.tmp" "$INSTALL_DIR/node-$version"
    ok "Node.js $version installiert (Prüfsumme geprüft)"
  fi
  ln -sfn "$INSTALL_DIR/node-$version" "$INSTALL_DIR/node"
  # alte Node-Versionen aufräumen
  find "$INSTALL_DIR" -maxdepth 1 -type d -name 'node-v*' ! -name "node-$version" -exec rm -rf {} + 2>/dev/null || true
  rm -rf "$work"
}

install_caddy() {
  [ "$HTTPS" = 1 ] || return 0
  step "Caddy (HTTPS)"
  local work version tag file
  work="$(mktemp -d)"
  tag="$(curl -fsSL --proto '=https' --connect-timeout 15 https://api.github.com/repos/caddyserver/caddy/releases/latest 2>/dev/null \
    | grep -oE '"tag_name": *"v[0-9]+\.[0-9]+\.[0-9]+"' | grep -oE 'v[0-9.]+' | head -n1 || true)"
  version="${tag#v}"
  [ -n "$version" ] || version="$CADDY_FALLBACK_VERSION"
  if [ -x "$INSTALL_DIR/caddy-$version/caddy" ]; then
    ok "Caddy $version ist schon installiert"
  else
    info "lade Caddy $version …"
    file="caddy_${version}_linux_${CADDY_ARCH}.tar.gz"
    download "https://github.com/caddyserver/caddy/releases/download/v${version}/${file}" "$work/$file"
    download "https://github.com/caddyserver/caddy/releases/download/v${version}/caddy_${version}_checksums.txt" "$work/checksums.txt"
    (cd "$work" && grep " ${file}\$" checksums.txt | sha512sum -c --status) || die "Prüfsumme von $file stimmt nicht."
    mkdir -p "$INSTALL_DIR/caddy-$version"
    tar -xzf "$work/$file" -C "$INSTALL_DIR/caddy-$version" --no-same-owner caddy
    ok "Caddy $version installiert (Prüfsumme geprüft)"
  fi
  ln -sfn "$INSTALL_DIR/caddy-$version" "$INSTALL_DIR/caddy"
  find "$INSTALL_DIR" -maxdepth 1 -type d -name 'caddy-*' ! -name "caddy-$version" -exec rm -rf {} + 2>/dev/null || true
  rm -rf "$work"
}

install_app() {
  step "Heldix-Dienst $HELDIX_VERSION"
  local target="$INSTALL_DIR/app-$HELDIX_VERSION"
  rm -rf "$target.tmp"
  mkdir -p "$target.tmp"
  payload | tar -xz -C "$target.tmp" --no-same-owner
  [ -f "$target.tmp/dist/server.js" ] || die "Das Paket im Installer ist unvollständig."
  if [ -d "$target.tmp/website" ]; then
    # Adresse der API in der Datenschutzerklärung; Merker für fehlende Betreiber-Angaben nicht ausliefern
    local api_text="${API_DOMAIN:-der eigenen Adresse des Heldix-Dienstes}"
    find "$target.tmp/website" -name '*.html' -exec sed -i "s|__API_DOMAIN__|$api_text|g" {} +
    if [ -f "$target.tmp/website/.platzhalter" ]; then
      PLACEHOLDERS=1
      rm -f "$target.tmp/website/.platzhalter"
    fi
  fi
  chmod -R u=rwX,go=rX "$target.tmp"
  rm -rf "$target"
  mv "$target.tmp" "$target"
  # vorige Version als Rückfall merken, ältere löschen
  local current=""
  [ -L "$INSTALL_DIR/app" ] && current="$(readlink "$INSTALL_DIR/app")"
  if [ -n "$current" ] && [ "$current" != "$target" ]; then ln -sfn "$current" "$INSTALL_DIR/app.previous"; fi
  ln -sfn "$target" "$INSTALL_DIR/app"
  local keep_previous=""
  [ -L "$INSTALL_DIR/app.previous" ] && keep_previous="$(readlink "$INSTALL_DIR/app.previous")"
  for dir in "$INSTALL_DIR"/app-*; do
    [ -d "$dir" ] || continue
    [ "$dir" = "$target" ] || [ "$dir" = "$keep_previous" ] || rm -rf "$dir"
  done
  ok "nach $target entpackt"
}

set_env() {
  # set_env <schlüssel> <wert>: Wert in der env-Datei setzen, eigene Einträge bleiben erhalten
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

write_config() {
  step "Einstellungen"
  if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<EOF
# Heldix-Dienst – Umgebungsvariablen (siehe docs/dienst.md). Nach Änderungen: systemctl restart $UNIT
# Eigene Einträge, z. B. HELDIX_DIENST_CAPES=heldix,glut, bleiben bei Updates erhalten.
# Voice Chat: HELDIX_DIENST_VOICE=0 schaltet ihn aus, HELDIX_DIENST_VOICE_RANGE=48 setzt die Reichweite (8–128 Blöcke).
EOF
  fi
  set_env PORT "$PORT"
  set_env HOST 127.0.0.1
  set_env HELDIX_DIENST_DATA "$DATA_DIR"
  set_env NODE_ENV production
  # nur Caddy auf diesem Rechner spricht mit dem Dienst; mit --no-https entscheidet der eigene Proxy
  set_env HELDIX_DIENST_TRUST_PROXY 1
  # Anmeldung auf der Webseite: Adresse der Webseite (Einmal-Links und Schutz vor fremden Seiten)
  if [ "$WEBSITE" = 1 ] && [ -n "$DOMAIN" ]; then set_env HELDIX_DIENST_WEBSITE "https://$DOMAIN"; fi
  # Öffentliche Adresse der API: daraus die Umleitungs-URI der Anmeldung mit dem Minecraft-Konto (allein ändert sie nichts)
  if [ -n "$API_DOMAIN" ]; then set_env HELDIX_DIENST_API_URL "https://$API_DOMAIN"; fi
  configure_microsoft
  # Update-Schlüssel aus dem Installer (fehlt er, bleibt Veröffentlichen im Team-Bereich aus)
  if [ -f "$INSTALL_DIR/app/update-public-key.pem" ]; then
    install -m 644 "$INSTALL_DIR/app/update-public-key.pem" "$UPDATE_KEY_FILE"
    set_env HELDIX_DIENST_UPDATE_KEY "$UPDATE_KEY_FILE"
  fi
  # Entwicklungsmodus niemals auf einem Server
  sed -i '/^HELDIX_DIENST_DEV=/d' "$ENV_FILE"
  chmod 644 "$ENV_FILE"
  ok "$ENV_FILE"

  if [ "$HTTPS" = 1 ]; then
    write_caddyfile > "$CADDYFILE"
    chmod 644 "$CADDYFILE"
    # prüfen mit leerem Arbeitsordner, damit root nichts im Zertifikatsordner von Caddy anlegt
    local check
    check="$(mktemp -d)"
    XDG_DATA_HOME="$check" XDG_CONFIG_HOME="$check" "$INSTALL_DIR/caddy/caddy" validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 \
      || { rm -rf "$check"; die "Caddy lehnt die Konfiguration ab: $CADDYFILE"; }
    rm -rf "$check"
    ok "$CADDYFILE"
  fi
}

save_secret() {
  # save_secret: Geheimnis von stdin (erste Zeile) atomar nach $MS_SECRET_FILE, lesbar nur für root und den Dienst.
  # Der Wert erscheint nie in der Ausgabe und nie in einer Befehlszeile.
  local tmp
  tmp="$(umask 077 && mktemp "$CONFIG_DIR/.ms-client-secret.XXXXXX")"
  head -n1 | tr -d '\r' > "$tmp"
  if [ -z "$(tr -d '[:space:]' < "$tmp")" ]; then rm -f "$tmp"; return 1; fi
  chown root:"$SERVICE_USER" "$tmp"
  chmod 640 "$tmp"
  mv -f "$tmp" "$MS_SECRET_FILE"
}

ask_secret() {
  # Rückfrage nur mit Terminal und ohne --yes; die Eingabe bleibt unsichtbar. Leer: ohne Geheimnis (öffentlicher Client).
  [ "$ASSUME_YES" = 0 ] && [ -r /dev/tty ] || return 1
  local secret=""
  printf '    Client-Geheimnis der Azure-App (Eingabe unsichtbar; leer lassen, wenn die Umleitungs-URI unter\n    „Mobil- und Desktopanwendungen“ steht): ' > /dev/tty
  IFS= read -rs secret < /dev/tty || secret=""
  printf '\n' > /dev/tty
  [ -n "$secret" ] || return 1
  local saved=1
  if printf '%s\n' "$secret" | save_secret; then saved=0; fi
  secret=""
  return "$saved"
}

configure_microsoft() {
  # Anmeldung mit dem Minecraft-Konto auf der Webseite (optional). Ohne Option bleibt alles, wie es ist.
  if [ "$MS_LOGIN" = 0 ]; then
    sed -i '/^HELDIX_DIENST_MS_CLIENT_ID=/d; /^HELDIX_DIENST_MS_CLIENT_SECRET_FILE=/d' "$ENV_FILE"
    rm -f "$MS_SECRET_FILE"
    ok "Anmeldung mit dem Minecraft-Konto: aus"
    return 0
  fi
  [ "$MS_LOGIN" = 1 ] || return 0
  set_env HELDIX_DIENST_MS_CLIENT_ID "$MS_CLIENT_ID"
  if [ -n "$MS_SECRET_SOURCE" ]; then
    save_secret < "$MS_SECRET_SOURCE" || die "Die Datei mit dem Client-Geheimnis ist leer: $MS_SECRET_SOURCE"
    info "Client-Geheimnis übernommen. Die Datei $MS_SECRET_SOURCE wird nicht mehr gebraucht – bitte löschen."
  elif [ ! -s "$MS_SECRET_FILE" ]; then
    ask_secret || true
  fi
  if [ -s "$MS_SECRET_FILE" ]; then
    chown root:"$SERVICE_USER" "$MS_SECRET_FILE"
    chmod 640 "$MS_SECRET_FILE"
    set_env HELDIX_DIENST_MS_CLIENT_SECRET_FILE "$MS_SECRET_FILE"
    ok "Anmeldung mit dem Minecraft-Konto: an (App-ID $MS_CLIENT_ID, Client-Geheimnis in $MS_SECRET_FILE, Rechte 640)"
  else
    sed -i '/^HELDIX_DIENST_MS_CLIENT_SECRET_FILE=/d' "$ENV_FILE"
    ok "Anmeldung mit dem Minecraft-Konto: an (App-ID $MS_CLIENT_ID, ohne Client-Geheimnis: öffentlicher Client mit PKCE)"
  fi
}

write_caddyfile() {
  local web="$INSTALL_DIR/app/website"
  cat <<EOF
# Heldix-Dienst: HTTPS über Caddy (erzeugt vom Installer, wird bei Updates überschrieben)
{
$([ -n "$EMAIL" ] && printf '\temail %s\n' "$EMAIL")
	admin off
}

(sicherheit) {
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}

# API (Heldix-Dienst): REST und WebSockets
$API_DOMAIN {
	import sicherheit
	# Launcher-Installer (über 100 MB): ohne Kompression durchreichen, damit Content-Length und Range erhalten bleiben.
	# Caddy streamt die Antwort (kein Puffern der ganzen Datei) und hat für Antworten keine Zeitgrenze;
	# einen hängenden Client trennt der Dienst selbst.
	# Uploads im Team-Bereich (bis 1 GiB): Caddy hat keine Grenze für den Anfragekörper und reicht ihn gestreamt durch.
	# Addons (JAR bis 50 MiB) genauso: Downloads und Screenshots unter /v1/addons/<id>/… (mit Range), Uploads im
	# Team-Bereich, Einreichungen von Spielern (JAR und Screenshots hochladen) und die JAR zum Prüfen im Team-Bereich.
	@gross path /v1/launcher/download/* /v1/team/updates/files/* /v1/addons/* /v1/team/addons/files/* /v1/addon-submissions/* /v1/team/addon-submissions/*
	handle @gross {
		reverse_proxy 127.0.0.1:$PORT
	}
	handle {
		encode gzip
		reverse_proxy 127.0.0.1:$PORT
	}
}
EOF
  [ "$WEBSITE" = 1 ] || return 0
  cat <<EOF

# Webseite
$DOMAIN {
	import sicherheit
	header {
		Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'"
		X-Frame-Options "DENY"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
	}
	@static path /assets/* /images/* /fonts/*
	header @static Cache-Control "public, max-age=604800"
	# Kompression nur für die Webseite selbst, nicht für /api (Uploads und Downloads der Installer)
	@komprimierbar not path /api/*
	encode @komprimierbar zstd gzip

	# Status-Anzeige unten auf der Seite (gleiche Adresse, kein CORS nötig)
	handle /dienst-status {
		rewrite * /health
		reverse_proxy 127.0.0.1:$PORT
	}
	# Neueste Launcher-Version für den Download-Bereich der Webseite (gleiche Adresse wegen der CSP)
	handle /launcher-latest {
		rewrite * /v1/launcher/latest
		reverse_proxy 127.0.0.1:$PORT
	}
	# Anmeldung, Spieler- und Team-Bereich: der Dienst unter /api auf derselben Adresse (Cookie der Webseite,
	# CSP connect-src 'self'). Wie bei der API: ohne Grenze für den Anfragekörper, gestreamt, ohne Zeitgrenze
	# für die Antwort; der Dienst sieht die IP des Besuchers über X-Forwarded-For.
	handle /api/* {
		uri strip_prefix /api
		reverse_proxy 127.0.0.1:$PORT
	}
	handle {
		root * $web
		try_files {path} {path}.html {path}/index.html
		file_server
	}
	handle_errors {
		root * $web
		rewrite * /404.html
		file_server {
			status {err.status_code}
		}
	}
}
EOF
  if [ "$WWW" = 1 ]; then
    cat <<EOF

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
EOF
  fi
}

write_units() {
  step "Systemdienste"
  cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Heldix-Dienst (Freunde, Capes und Heldix-Symbol für HeldixClient)
Documentation=https://github.com/AMDRyzen753/HeldixClient/blob/main/docs/dienst.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$ENV_FILE
Environment=HELDIX_DIENST_UPDATES=$UPDATES_DIR
Environment=HELDIX_DIENST_ADDONS=$ADDONS_DIR
WorkingDirectory=$INSTALL_DIR/app
ExecStart=$INSTALL_DIR/node/bin/node --disable-warning=ExperimentalWarning $INSTALL_DIR/app/dist/server.js
Restart=always
RestartSec=3
TimeoutStopSec=15

# Abschottung: der Dienst darf nur in sein Datenverzeichnis schreiben
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallArchitectures=native
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

  if [ "$HTTPS" = 1 ]; then
    cat > "/etc/systemd/system/$CADDY_UNIT.service" <<EOF
[Unit]
Description=Caddy für den Heldix-Dienst (HTTPS für Webseite und API)
After=network-online.target $UNIT.service
Wants=network-online.target

[Service]
Type=notify
User=$CADDY_USER
Group=$CADDY_USER
Environment=XDG_DATA_HOME=$CADDY_DATA_DIR XDG_CONFIG_HOME=$CADDY_DATA_DIR
ExecStart=$INSTALL_DIR/caddy/caddy run --config $CADDYFILE --adapter caddyfile
Restart=always
RestartSec=5
TimeoutStopSec=5s
LimitNOFILE=1048576

# nur die Ports 80 und 443 öffnen dürfen, sonst nichts
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$CADDY_DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
  fi
  systemctl daemon-reload
  ok "$UNIT.service$([ "$HTTPS" = 1 ] && printf ' und %s.service' "$CADDY_UNIT")"
}

write_admin() {
  # heldix-dienst-admin: Verwaltung (Meldungen, Sperren) als Benutzer des Dienstes, mit dessen Datenordner.
  # So gehören neue Dateien der Datenbank (WAL) immer dem Dienst.
  cat > "$ADMIN_BIN" <<EOF
#!/bin/sh
# Heldix-Dienst – Verwaltung: Meldungen ansehen und erledigen, Spieler sperren und entsperren.
# Erzeugt vom Installer (wird bei Updates überschrieben). Hilfe: sudo heldix-dienst-admin hilfe
if [ "\$(id -u)" != 0 ]; then
  echo "Bitte mit sudo ausführen: sudo heldix-dienst-admin \$*" >&2
  exit 1
fi
cd / || exit 1
umask 077
exec runuser -u $SERVICE_USER -- env HELDIX_DIENST_DATA=$DATA_DIR NODE_ENV=production \\
  $INSTALL_DIR/node/bin/node --disable-warning=ExperimentalWarning $INSTALL_DIR/app/dist/admin.js "\$@"
EOF
  chmod 755 "$ADMIN_BIN"
  ok "$ADMIN_BIN"
}

open_firewall() {
  [ "$HTTPS" = 1 ] || return 0
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
    ok "Firewall (ufw): Ports 80 und 443 offen"
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-service=http --add-service=https >/dev/null && firewall-cmd --reload >/dev/null
    ok "Firewall (firewalld): Ports 80 und 443 offen"
  fi
}

wait_for() {
  # wait_for <url> <sekunden> <muster> [curl-optionen…]: true, sobald die Antwort das Muster enthält
  local url="$1" seconds="$2" pattern="$3" i
  shift 3
  for ((i = 0; i < seconds; i++)); do
    if curl -fsS --max-time 3 "$@" "$url" 2>/dev/null | grep -q "$pattern"; then return 0; fi
    sleep 1
  done
  return 1
}

start_services() {
  step "Starten"
  systemctl enable "$UNIT" >/dev/null 2>&1
  systemctl restart "$UNIT"
  if wait_for "http://127.0.0.1:$PORT/health" 30 '"ok":true'; then
    ok "Heldix-Dienst läuft auf 127.0.0.1:$PORT"
  else
    journalctl -u "$UNIT" -n 30 --no-pager >&2 || true
    die "Der Dienst startet nicht (Log oben, mehr mit: journalctl -u $UNIT)."
  fi
  [ "$HTTPS" = 1 ] || return 0
  systemctl enable "$CADDY_UNIT" >/dev/null 2>&1
  systemctl restart "$CADDY_UNIT"
  info "warte auf die HTTPS-Zertifikate (bis zu 90 Sekunden) …"
  # *.localhost (nur zum Ausprobieren): Caddy nimmt ein eigenes, nicht öffentlich vertrautes Zertifikat
  local insecure=()
  case "$API_DOMAIN" in localhost|*.localhost) insecure=(-k) ;; esac
  if wait_for "https://$API_DOMAIN/health" 90 '"ok":true' ${insecure[@]+"${insecure[@]}"}; then
    ok "API erreichbar unter https://$API_DOMAIN"
  else
    warn "https://$API_DOMAIN antwortet noch nicht. Meist fehlt der DNS-Eintrag oder Port 80/443 ist von außen gesperrt."
    warn "Caddy versucht es weiter von selbst. Log: journalctl -u $CADDY_UNIT -f"
  fi
  if [ "$WEBSITE" = 1 ]; then
    if wait_for "https://$DOMAIN/" 30 'HeldixClient' ${insecure[@]+"${insecure[@]}"}; then
      ok "Webseite erreichbar unter https://$DOMAIN"
    else
      warn "https://$DOMAIN antwortet noch nicht (DNS-Eintrag?). Caddy versucht es weiter von selbst."
    fi
  fi
}

summary() {
  local api
  if [ -n "$API_DOMAIN" ]; then api="https://$API_DOMAIN"; else api="https://<adresse-der-api>"; fi
  echo ""
  printf '%sHeldix-Dienst %s ist installiert.%s\n' "$GREEN$BOLD" "$HELDIX_VERSION" "$RESET"
  echo ""
  if [ "$HTTPS" = 1 ]; then
    [ "$WEBSITE" = 1 ] && echo "  Webseite     https://$DOMAIN$([ "$WWW" = 1 ] && printf ' (www.%s leitet weiter)' "$DOMAIN")"
    echo "  API          $api"
    echo ""
  fi
  echo "  Im Launcher eintragen (launcher/src/main/config.ts):"
  printf "    %sexport const HELDIX_SERVICE_URL: string = process.env.HELDIX_SERVICE_URL ?? '%s';%s\n" "$BOLD" "$api" "$RESET"
  if [ "$HTTPS" = 0 ]; then
    echo ""
    echo "  Ohne Caddy installiert: Leite HTTPS (inklusive WebSockets auf /v1/ws und /v1/voice) an 127.0.0.1:$PORT weiter."
    echo "  Die Webseite liegt zum Ausliefern in $INSTALL_DIR/app/website. Beispiele stehen in docs/dienst.md."
  fi
  if [ "$PLACEHOLDERS" = 1 ] && [ "$WEBSITE" = 1 ]; then
    echo ""
    printf '  %sAchtung:%s Impressum und Datenschutzerklärung enthalten noch Platzhalter statt deiner Angaben.\n' "$YELLOW$BOLD" "$RESET"
    echo "  Vor dem Veröffentlichen website/site.config.json ausfüllen, den Installer neu bauen (npm run installer)"
    echo "  und hier noch einmal ausführen."
  fi
  echo ""
  echo "  Nützlich:"
  echo "    Status       systemctl status $UNIT"
  echo "    Log          journalctl -u $UNIT -f"
  echo "    Update       denselben Befehl mit einer neueren Installer-Datei noch einmal ausführen"
  echo "    Entfernen    sudo bash heldix-dienst-install.sh --uninstall   (Daten bleiben; --purge löscht auch sie)"
  echo "    Daten        $DATA_DIR (Sicherung: Ordner kopieren, während der Dienst gestoppt ist)"
  echo "    Verwaltung   sudo heldix-dienst-admin meldungen   (Meldungen, Sperren, Team: sudo heldix-dienst-admin hilfe)"
  echo ""
  if grep -q '^HELDIX_DIENST_VOICE=0' "$ENV_FILE" 2>/dev/null; then
    echo "  Voice Chat (/v1/voice) ist aus (HELDIX_DIENST_VOICE=0 in $ENV_FILE)."
  else
    echo "  Voice Chat (/v1/voice) ist an. Ausschalten: HELDIX_DIENST_VOICE=0 in $ENV_FILE, danach systemctl restart $UNIT."
  fi
  echo ""
  if [ "$WEBSITE" = 1 ] && grep -q '^HELDIX_DIENST_MS_CLIENT_ID=' "$ENV_FILE" 2>/dev/null; then
    echo "  Anmeldung mit dem Minecraft-Konto auf der Webseite ist an. Einmalig in Azure (dieselbe App-Registrierung wie der Launcher)"
    echo "  diese Umleitungs-URI eintragen – mit Client-Geheimnis unter „Web“, ohne unter „Mobil- und Desktopanwendungen“:"
    printf '    %shttps://%s/v1/web/auth/microsoft/callback%s\n' "$BOLD" "$API_DOMAIN" "$RESET"
    echo "    Anleitung: docs/einrichtung.md. Ausschalten: Installer mit --no-minecraft-login erneut ausführen."
    echo ""
  elif [ "$WEBSITE" = 1 ]; then
    echo "  Optional: Anmeldung auf der Webseite direkt mit dem Minecraft-Konto – erst in Azure einrichten (docs/einrichtung.md),"
    echo "  dann den Installer mit --minecraft-login erneut ausführen."
    echo ""
  fi
  echo "  Team-Bereich der Webseite: Den ersten Admin legst du hier an (er muss sich schon einmal angemeldet haben):"
  printf '    %ssudo heldix-dienst-admin team <spielername> admin%s
' "$BOLD" "$RESET"
  if [ "$WEBSITE" = 1 ] && [ -n "$DOMAIN" ]; then
    echo "    Danach im Launcher „Auf $DOMAIN anmelden“ wählen und unter https://$DOMAIN/konto die Zwei-Faktor-Anmeldung einrichten."
  fi
  echo ""
  echo "  Launcher-Update veröffentlichen (erst der Installer, update.json zuletzt):"
  printf '    %sscp HeldixClient-Setup-X.Y.Z.exe update.json root@%s:%s/%s\n' "$BOLD" "${DOMAIN:-${API_DOMAIN:-<server>}}" "$UPDATES_DIR" "$RESET"
  echo "    Der Dienst liest update.json sofort neu (ohne Neustart). Die Dateien müssen für alle lesbar sein (scp: Standard)."
  if [ -f "$UPDATE_KEY_FILE" ]; then
    echo "    Oder als Admin im Team-Bereich der Webseite hochladen und veröffentlichen (Signatur wird geprüft)."
  else
    echo "    Im Team-Bereich geht das nicht: Dem Installer lag kein Update-Schlüssel bei (launcher/src/main/update-public-key.ts)."
  fi
  echo ""
  if [ -f "$UPDATE_KEY_FILE" ]; then
    echo "  Addon veröffentlichen: im Team-Bereich unter „Addons“ JAR und .addon.json hochladen (Signatur wird geprüft)."
    echo "  Einreichungen von Spielern freigeben: Team-Bereich → Addons → Einreichungen, Schlüsseldatei wählen (signiert im Browser)."
  else
    echo "  Addons lassen sich ohne Update-Schlüssel weder veröffentlichen noch freigeben (Team-Bereich antwortet mit 503)."
  fi
}

uninstall() {
  [ "$(id -u)" = 0 ] || die "Bitte mit sudo bzw. als root ausführen."
  step "Heldix-Dienst entfernen"
  local unit
  for unit in "$CADDY_UNIT" "$UNIT"; do
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$unit.service"
  done
  systemctl daemon-reload 2>/dev/null || true
  rm -rf "$INSTALL_DIR"
  rm -f "$ADMIN_BIN"
  ok "Programme, Systemdienste und $ADMIN_BIN entfernt"
  if [ "$PURGE" = 1 ]; then
    confirm "Alle Daten des Dienstes ($DATA_DIR) und die Zertifikate unwiderruflich löschen?" || die "Abgebrochen, Daten bleiben."
    rm -rf "$DATA_DIR" "$CADDY_DATA_DIR" "$CONFIG_DIR"
    userdel "$SERVICE_USER" >/dev/null 2>&1 || true
    userdel "$CADDY_USER" >/dev/null 2>&1 || true
    ok "Daten, Zertifikate, Einstellungen und Benutzer gelöscht"
  else
    info "Daten (auch Launcher-Updates und Addons) bleiben in $DATA_DIR, Einstellungen in $CONFIG_DIR (löschen mit --uninstall --purge)."
  fi
}

main() {
  parse_args "$@"
  if [ "$UNINSTALL" = 1 ]; then
    uninstall
    return
  fi
  printf '%sHeldix-Dienst %s – Installation%s\n' "$BOLD" "$HELDIX_VERSION" "$RESET"
  check_system
  ensure_tools
  check_ports
  check_dns
  if [ "$HTTPS" = 1 ]; then
    info "Webseite: $([ "$WEBSITE" = 1 ] && printf %s "$DOMAIN" || printf aus) · API: $API_DOMAIN · interner Port: $PORT"
  else
    info "ohne HTTPS (eigener Reverse-Proxy) · interner Port: $PORT · Daten: $DATA_DIR"
  fi
  create_users
  install_node
  install_caddy
  install_app
  write_config
  write_units
  write_admin
  open_firewall
  start_services
  summary
}

# Der fertig gebaute Dienst (dist/, package.json, node_modules/ws) als tar.gz, Base64-kodiert
payload() {
  base64 -d <<'HELDIX_PAYLOAD'
__HELDIX_PAYLOAD__
HELDIX_PAYLOAD
}

main "$@"
