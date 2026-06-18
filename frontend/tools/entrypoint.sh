#!/bin/sh
set -e
echo "[frontend] Starting Shell Smash hub..."
exec serve -s dist -l 3000
