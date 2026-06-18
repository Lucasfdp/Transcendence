#!/bin/bash
# ==============================================================================
# Shell Smash — Setup Script
# ==============================================================================
# Run this once after cloning the repo. It checks/installs prerequisites
# and prepares the local environment so `make up` works out of the box.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Supports: macOS (Homebrew) and Debian/Ubuntu Linux (apt).
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[setup]${NC} $1"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $1"; }
error() { echo -e "${RED}[setup]${NC} $1"; }

OS="$(uname -s)"

# ------------------------------------------------------------------------
# 1. Check / install Docker
# ------------------------------------------------------------------------
if command -v docker &> /dev/null; then
    info "Docker is already installed: $(docker --version)"
else
    warn "Docker not found."
    if [ "$OS" = "Darwin" ]; then
        error "Please install Docker Desktop for Mac manually:"
        error "  https://www.docker.com/products/docker-desktop"
        exit 1
    elif [ "$OS" = "Linux" ]; then
        info "Installing Docker via apt..."
        sudo apt-get update
        sudo apt-get install -y ca-certificates curl gnupg
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
          sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        sudo usermod -aG docker "$USER"
        warn "Added $USER to the docker group. You may need to log out and back in for this to take effect."
    else
        error "Unsupported OS: $OS. Please install Docker manually."
        exit 1
    fi
fi

# ------------------------------------------------------------------------
# 2. Check Docker Compose plugin
# ------------------------------------------------------------------------
if docker compose version &> /dev/null; then
    info "Docker Compose plugin found: $(docker compose version)"
else
    error "Docker Compose plugin not found. Please install it:"
    error "  https://docs.docker.com/compose/install/"
    exit 1
fi

# ------------------------------------------------------------------------
# 3. Check Docker daemon is running
# ------------------------------------------------------------------------
if docker info &> /dev/null; then
    info "Docker daemon is running."
else
    error "Docker daemon is not running. Start Docker Desktop (macOS) or run:"
    error "  sudo systemctl start docker"
    exit 1
fi

# ------------------------------------------------------------------------
# 4. Check make
# ------------------------------------------------------------------------
if command -v make &> /dev/null; then
    info "make is available: $(make --version | head -1)"
else
    warn "make not found."
    if [ "$OS" = "Darwin" ]; then
        info "Installing Xcode command line tools (includes make)..."
        xcode-select --install || true
    elif [ "$OS" = "Linux" ]; then
        info "Installing build-essential..."
        sudo apt-get update && sudo apt-get install -y build-essential
    fi
fi

# ------------------------------------------------------------------------
# 5. Set up .env file
# ------------------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$ROOT_DIR/.env" ]; then
    info ".env already exists — leaving it as is."
else
    if [ -f "$ROOT_DIR/.env.example" ]; then
        cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
        info "Created .env from .env.example."
        warn "Edit .env and fill in:"
        warn "  - POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, SECRET_KEY"
        warn "  - FORTYTWO_CLIENT_ID / FORTYTWO_CLIENT_SECRET / FORTYTWO_CALLBACK_URL"
        warn "    (register an app at https://profile.intra.42.fr/oauth/applications)"
    else
        error ".env.example not found — cannot create .env. Please create one manually."
    fi
fi

# ------------------------------------------------------------------------
# 6. Generate lockfiles if missing (so first build doesn't fail)
# ------------------------------------------------------------------------
for app in backend frontend; do
    SRC_DIR="$ROOT_DIR/srcs/requirements/$app/src"
    if [ -f "$SRC_DIR/package.json" ] && [ ! -f "$SRC_DIR/package-lock.json" ]; then
        if command -v npm &> /dev/null; then
            info "Generating package-lock.json for $app..."
            (cd "$SRC_DIR" && npm install --package-lock-only --no-audit --no-fund)
        else
            warn "npm not found locally — skipping lockfile generation for $app."
            warn "Docker build will fall back to 'npm install' (slower, but works)."
        fi
    fi
done

# ------------------------------------------------------------------------
# 7. Done
# ------------------------------------------------------------------------
echo ""
info "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with real secrets and 42 OAuth credentials"
echo "  2. Run: make up"
echo "  3. Visit: https://localhost"
echo ""