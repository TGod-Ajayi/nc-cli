#!/bin/sh
#
# NaijaCloud CLI + MCP server installer.
#
#   curl -fsSL https://your-domain.example/install.sh | sh
#
# Read this script before piping it to a shell. It:
#   1. checks for node and npm (it will not install Node for you)
#   2. downloads the project into ~/.local/share/naijacloud
#   3. runs `npm install` and `npm run build` there
#   4. symlinks the built CLI to ~/.local/bin/naijacloud
#
# Nothing runs as root and nothing is written outside your home directory.
#
# Overridable with environment variables:
#   NAIJACLOUD_REPO     git repo or tarball host   (default below)
#   NAIJACLOUD_VERSION  git ref / release tag      (default: main)
#   NAIJACLOUD_HOME     where the source lives     (default: ~/.local/share/naijacloud)
#   NAIJACLOUD_BIN_DIR  where the symlink goes     (default: ~/.local/bin)

set -eu

REPO="${NAIJACLOUD_REPO:-https://github.com/naijacloud/naijacloud-cli}"
VERSION="${NAIJACLOUD_VERSION:-main}"
INSTALL_DIR="${NAIJACLOUD_HOME:-$HOME/.local/share/naijacloud}"
BIN_DIR="${NAIJACLOUD_BIN_DIR:-$HOME/.local/bin}"
MIN_NODE_MAJOR=20

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

info()  { printf '%s\n' "$*"; }
step()  { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
warn()  { printf '%swarning:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()   { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

has() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 1. Prerequisites — we check for Node, we never install it
# ---------------------------------------------------------------------------

step "Checking prerequisites"

if ! has node; then
  die "Node.js is not on your PATH.
  Install Node ${MIN_NODE_MAJOR} or newer from https://nodejs.org/en/download and re-run this script."
fi

if ! has npm; then
  die "npm is not on your PATH.
  npm ships with Node.js — reinstall Node from https://nodejs.org/en/download and re-run this script."
fi

NODE_VERSION="$(node --version 2>/dev/null | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"

case "$NODE_MAJOR" in
  ''|*[!0-9]*) warn "Could not parse the Node version ('$NODE_VERSION'); continuing anyway." ;;
  *)
    if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
      die "Node ${NODE_VERSION} is too old — this CLI needs Node ${MIN_NODE_MAJOR} or newer.
  Upgrade from https://nodejs.org/en/download and re-run this script."
    fi
    ;;
esac

info "  node $(node --version), npm $(npm --version)"

# ---------------------------------------------------------------------------
# 2. Fetch the source
# ---------------------------------------------------------------------------

step "Fetching naijacloud-cli ($VERSION)"

if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR" ]; then
  die "$INSTALL_DIR exists and is not a directory. Move it aside and re-run."
fi

mkdir -p "$(dirname "$INSTALL_DIR")"

if has git; then
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "  updating existing checkout in $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$VERSION" >/dev/null 2>&1 \
      || die "Could not fetch '$VERSION' from $REPO"
    git -C "$INSTALL_DIR" checkout -q FETCH_HEAD \
      || die "Could not check out '$VERSION'"
  else
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 --branch "$VERSION" "$REPO" "$INSTALL_DIR" >/dev/null 2>&1 \
      || git clone --depth 1 "$REPO" "$INSTALL_DIR" >/dev/null 2>&1 \
      || die "Could not clone $REPO
  If this is a private repo, clone it yourself and run 'npm install && npm run build' inside it."
  fi
elif has curl; then
  TARBALL="${REPO%.git}/archive/refs/heads/${VERSION}.tar.gz"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM

  info "  downloading $TARBALL"
  curl -fsSL "$TARBALL" -o "$TMP/src.tar.gz" \
    || die "Could not download $TARBALL
  Check NAIJACLOUD_REPO / NAIJACLOUD_VERSION, or install git and re-run."

  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$TMP/src.tar.gz" -C "$INSTALL_DIR" --strip-components 1 \
    || die "Could not unpack the downloaded archive."
else
  die "Neither git nor curl is available — install one of them and re-run."
fi

# ---------------------------------------------------------------------------
# 3. Build
# ---------------------------------------------------------------------------

step "Installing dependencies and building"

cd "$INSTALL_DIR"

# --include=dev because the TypeScript compiler is a devDependency and the
# build needs it even when NODE_ENV=production is set in the environment.
npm install --include=dev --no-fund --no-audit >/dev/null 2>&1 \
  || die "'npm install' failed. Re-run it by hand in $INSTALL_DIR to see why."

npm run build >/dev/null 2>&1 \
  || die "'npm run build' failed. Re-run it by hand in $INSTALL_DIR to see why."

[ -f "$INSTALL_DIR/build/cli.js" ] \
  || die "Build finished but $INSTALL_DIR/build/cli.js is missing."

chmod +x "$INSTALL_DIR/build/cli.js"

# ---------------------------------------------------------------------------
# 4. Link onto PATH — user-owned, no sudo
# ---------------------------------------------------------------------------

step "Linking the naijacloud executable"

mkdir -p "$BIN_DIR" || die "Could not create $BIN_DIR"

TARGET="$BIN_DIR/naijacloud"
if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  die "$TARGET exists and is not a symlink. Move it aside and re-run."
fi

ln -sf "$INSTALL_DIR/build/cli.js" "$TARGET"
info "  $TARGET -> $INSTALL_DIR/build/cli.js"

# Is BIN_DIR actually on PATH?
ON_PATH=0
case ":$PATH:" in
  *":$BIN_DIR:"*) ON_PATH=1 ;;
esac

# ---------------------------------------------------------------------------
# 5. Next steps
# ---------------------------------------------------------------------------

printf '\n%sInstalled naijacloud%s\n\n' "$GREEN$BOLD" "$RESET"

if [ "$ON_PATH" -eq 0 ]; then
  case "${SHELL:-}" in
    */zsh)  RC="~/.zshrc"  ;;
    */bash) RC="~/.bashrc" ;;
    */fish) RC="~/.config/fish/config.fish" ;;
    *)      RC="your shell's startup file" ;;
  esac

  warn "$BIN_DIR is not on your PATH."
  info ""
  info "  Add it by appending this line to $RC, then opening a new shell:"
  info ""
  info "      export PATH=\"$BIN_DIR:\$PATH\""
  info ""
  info "  Until then, use the full path: $TARGET"
  info ""
fi

info "Next steps:"
info ""
info "  1. Sign in (stores a token in ~/.naijacloud/config.json, mode 0600):"
info ""
info "       naijacloud login"
info ""
info "  2. Register the MCP server with Claude Code:"
info ""
info "       claude mcp add --transport stdio naijacloud -- naijacloud mcp"
info ""
info "  No token goes into the MCP config — the server reads the credentials"
info "  that 'naijacloud login' already stored."
info ""
