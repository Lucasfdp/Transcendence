#!/bin/sh
set -eu

docker compose -f docker-compose.yml --env-file .env exec vault sh -lc 'vault status'
