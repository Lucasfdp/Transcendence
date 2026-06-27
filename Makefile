# ==============================================================================
# ft_transcendence — Makefile
# ==============================================================================
# All Docker Compose operations are routed through this Makefile.
# The compose files live at the repository root so we always pass -f explicitly.
# During 42 evaluation, examiners will run: make up / make down / make re
# ==============================================================================

COMPOSE_FILE	:= docker-compose.yml
OVERRIDE_FILE	:= docker-compose.override.yml
DEV_COMPOSE	:= -f $(COMPOSE_FILE) -f $(OVERRIDE_FILE)
ENV_FILE		:= .env
PROJECT_NAME	:= transcendence
CERT_DIR		:= secrets/nginx_ssl
VAULT_INIT_FILE	:= secrets/vault/init.txt
VAULT_SEED_FILE	:= secrets/vault/dev-seed.env
BASE_SERVICES	:= \
	backend_vault_agent \
	database_vault_agent \
	redis_vault_agent \
	monitoring_vault_agent \
	database \
	redis \
	backend \
	frontend \
	monitoring \
	reverse_proxy
VAULT_AGENT_SERVICES := \
	backend_vault_agent \
	database_vault_agent \
	redis_vault_agent \
	monitoring_vault_agent
CORE_SERVICES := \
	database \
	redis \
	frontend
EDGE_SERVICES := \
	backend \
	monitoring \
	reverse_proxy

# --- COLOR DEFINITON ---
ifeq ($(shell tput colors 2>/dev/null),)
	GREEN   :=
	RED     :=
	GRAY    :=
	YELLOW  :=
	MAGENTA :=
	CYAN	:=
	BLUE    :=
	NC      :=
else
	BOLD    := $(shell tput bold)
	RESET   := $(shell tput sgr0)

	GREEN   := $(BOLD)$(shell tput setaf 2)
	RED     := $(BOLD)$(shell tput setaf 1)
	GRAY    := $(shell tput setaf 8)
	YELLOW  := $(BOLD)$(shell tput setaf 3)
	MAGENTA := $(BOLD)$(shell tput setaf 5)
	CYAN    := $(BOLD)$(shell tput setaf 6)
	BLUE    := $(BOLD)$(shell tput setaf 4)
	NC      := $(RESET)
endif

# Default target
.DEFAULT_GOAL := help

# ==============================================================================
# CORE TARGETS
# ==============================================================================

## up: Build images (if needed) and start all services in detached mode
up: check-env prepare-local-secrets certs vault-bootstrap
	@echo "$(GREEN)Starting all services...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --no-deps $(VAULT_AGENT_SERVICES)
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --build --no-deps $(CORE_SERVICES)
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --build --no-deps $(EDGE_SERVICES)
	@echo "$(GREEN)All services are up. Run 'make ps' to verify.$(RESET)"

## dev: Start with hot-reload override (Vite HMR + NestJS watch). Access frontend at http://localhost:3000
dev: check-env prepare-local-secrets certs vault-bootstrap
	@echo "$(GREEN)Starting in DEV mode (hot-reload)...$(RESET)"
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) up -d --no-deps $(VAULT_AGENT_SERVICES)
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) up -d --build --no-deps $(CORE_SERVICES)
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) up -d --build --no-deps $(EDGE_SERVICES)
	@echo "$(GREEN)Dev server running. Frontend: http://localhost:3000$(RESET)"

## prod: Start WITHOUT the dev override — production-like mode (compiled frontend + runtime images)
prod: check-env prepare-local-secrets certs vault-bootstrap
	@echo "$(GREEN)Starting in PROD mode (no override)...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --no-deps $(VAULT_AGENT_SERVICES)
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --build --no-deps $(CORE_SERVICES)
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --build --no-deps $(EDGE_SERVICES)
	@echo "$(GREEN)Production-mode services up. Frontend: https://localhost:42424$(RESET)"

## vault-bootstrap: Ensure the local Vault is initialised, unsealed and seeded before starting dependants
vault-bootstrap: check-env
	@echo "$(CYAN)Bootstrapping Vault for local dev...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d vault
	@$(MAKE) vault-init
	@$(MAKE) vault-unseal
	@$(MAKE) vault-seed-dev

## vault-init: Start Vault and initialise it with a single unseal key for local dev
vault-init: check-env
	@echo "$(CYAN)Initialising Vault...$(RESET)"
	@chmod +x scripts/vault-init.sh
	@./scripts/vault-init.sh

## vault-unseal: Unseal the local Vault instance using the saved bootstrap key
vault-unseal: check-env
	@echo "$(CYAN)Unsealing Vault...$(RESET)"
	@chmod +x scripts/vault-unseal.sh
	@./scripts/vault-unseal.sh

## vault-seed-dev: Seed development secrets into Vault and write AppRole bootstrap files
vault-seed-dev: check-env
	@echo "$(CYAN)Seeding development secrets into Vault...$(RESET)"
	@chmod +x scripts/vault-seed-dev.sh
	@./scripts/vault-seed-dev.sh

## vault-status: Show the current Vault seal/health status
vault-status: check-env
	@chmod +x scripts/vault-status.sh
	@./scripts/vault-status.sh

## down: Stop and remove containers, networks (volumes are preserved by default)
down:
	@echo "$(YELLOW)Stopping all services...$(RESET)"
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) down --remove-orphans
	@echo "$(YELLOW)Services stopped. Volumes preserved.$(RESET)"

## restart: Restart all services (preserves volumes)
restart: down up

## restart-front: Restart only the frontend container
restart-front:
	@echo "$(YELLOW)Restarting frontend only...$(RESET)"
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) restart frontend
	@echo "$(GREEN)Frontend restarted.$(RESET)"

## restart-back: Restart only the backend container
restart-back:
	@echo "$(YELLOW)Restarting backend only...$(RESET)"
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) restart backend
	@echo "$(GREEN)Backend restarted.$(RESET)"

## rebuild-front: Rebuild and recreate only the frontend service
rebuild-front: check-env certs
	@echo "$(CYAN)Rebuilding frontend only...$(RESET)"
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) up -d --build --force-recreate --no-deps frontend
	@echo "$(GREEN)Frontend rebuilt and restarted.$(RESET)"

## rebuild-back: Rebuild and recreate only the backend service
rebuild-back: check-env certs
	@echo "$(CYAN)Rebuilding backend only...$(RESET)"
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) up -d --build --force-recreate --no-deps backend
	@echo "$(GREEN)Backend rebuilt and restarted.$(RESET)"

## refresh-app: Rebuild frontend and restart backend to validate app changes quickly
refresh-app: rebuild-front restart-back
	@echo "$(GREEN)Frontend rebuilt and backend restarted.$(RESET)"

## build: Build or rebuild all images without starting containers
build: check-env
	@echo "$(CYAN)Building all images...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) build --no-cache

## logs: Tail logs for all services, or one service. Usage: make logs [SERVICE=backend]
logs:
	@if [ "$(SERVICE)" ]; then \
		docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) logs -f $(SERVICE); \
	else \
		docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) logs -f; \
	fi

## ps: Show status of all running containers
ps:
	docker compose $(DEV_COMPOSE) --env-file $(ENV_FILE) ps

## diagnosis: Check local prerequisites for running the project without stopping at the first failure
diagnosis:
	@failures=0; \
		check() { \
			label="$$1"; \
			command="$$2"; \
			hint="$$3"; \
			printf "\r$(GRAY)Analyzing: %s...$(RESET)" "$$label"; \
			if sh -c "$$command" >/dev/null 2>&1; then \
				printf "\r$(GREEN)OK$(RESET) %s\n" "$$label"; \
			else \
				failures=$$((failures + 1)); \
				printf "\r$(RED)FAIL$(RESET) %s\n" "$$label"; \
				if [ -n "$$hint" ]; then \
					printf "  $(GRAY)%s$(RESET)\n" "$$hint"; \
				fi; \
			fi; \
		}; \
		check "docker command available" "command -v docker" "Install Docker Engine or Docker Desktop."; \
		check "docker compose plugin available" "docker compose version" "Make sure Docker Compose v2 is installed."; \
		check "Docker daemon access" "docker info" "Check that Docker is running and that your user has permission to use it."; \
		check "$(COMPOSE_FILE) file present" "[ -f '$(COMPOSE_FILE)' ]" "The main Docker Compose file is missing."; \
		check "$(OVERRIDE_FILE) file present" "[ -f '$(OVERRIDE_FILE)' ]" "The development override file is missing."; \
		check "$(ENV_FILE) file present" "[ -f '$(ENV_FILE)' ]" "Run: cp .env.example .env"; \
		check ".env.example template present" "[ -f '.env.example' ]" "The committed template should exist at the repository root."; \
		check "Vault scripts present" "[ -f scripts/vault-init.sh ] && [ -f scripts/vault-unseal.sh ] && [ -f scripts/vault-seed-dev.sh ]" "Vault bootstrap scripts are missing."; \
		check "Certificate script present" "[ -f scripts/generate-local-certs.sh ]" "The local certificate generation script is missing."; \
		check "Repository writable for secrets/" "[ -w . ] && ( [ -d secrets ] || [ ! -e secrets ] )" "You need write permission in the repository to create secrets/."; \
		check "secrets/ directory writable" "mkdir -p secrets/vault/approle/backend secrets/vault/approle/database secrets/vault/approle/redis secrets/vault/approle/monitoring secrets/nginx_ssl && [ -w secrets ] && [ -w secrets/vault ]" "Fix permissions, for example: sudo chown -R $$(id -un):$$(id -gn) secrets"; \
		check "Docker Compose configuration valid" "[ -f '$(ENV_FILE)' ] && docker compose -f '$(COMPOSE_FILE)' -f '$(OVERRIDE_FILE)' --env-file '$(ENV_FILE)' config" "Review .env variables and docker-compose syntax."; \
		check "Vault bootstrap init.txt present or path writable" "[ -f '$(VAULT_INIT_FILE)' ] || { mkdir -p secrets/vault && [ -w secrets/vault ]; }" "make vault-init needs to be able to write secrets/vault/init.txt."; \
		check "Vault dev-seed.env present or path writable" "[ -f '$(VAULT_SEED_FILE)' ] || { mkdir -p secrets/vault && [ -w secrets/vault ]; }" "make vault-seed-dev needs to be able to write secrets/vault/dev-seed.env."; \
		check "mkcert available or certificates already generated" "command -v mkcert || { [ -s '$(CERT_DIR)/cert.pem' ] && [ -s '$(CERT_DIR)/key.pem' ]; }" "If mkcert is unavailable, the project will fall back to a self-signed certificate at startup."; \
		printf "\n"; \
		if [ "$$failures" -eq 0 ]; then \
			printf "$(GREEN)Diagnosis completed: everything looks good.$(RESET)\n"; \
		else \
			printf "$(RED)Diagnosis completed: %s check(s) failed.$(RESET)\n" "$$failures"; \
			exit 1; \
		fi

# ==============================================================================
# CLEAN TARGETS
# ==============================================================================

## clean: Stop containers and remove images created by this project
clean: down
	@echo "$(YELLOW)Removing project images...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) down --rmi all
	@echo "$(YELLOW)Images removed.$(RESET)"

## fclean: Full cleanup — containers, images, volumes, and networks
# WARNING: This deletes all persistent data (database, redis, etc.)
fclean: down
	@echo "$(YELLOW)Full cleanup: removing containers, images, volumes, and networks...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) down --rmi all -v --remove-orphans
	@echo "$(YELLOW)Pruning dangling images and build cache...$(RESET)"
	docker system prune -f
	@echo "$(YELLOW)Full cleanup complete.$(RESET)"

## re: Rebuild everything from scratch (equivalent to fclean + up)
re: fclean up

# ==============================================================================
# OPTIONAL / DEVELOPER TARGETS
# ==============================================================================

## shell: Open a shell in a running container. Usage: make shell SERVICE=backend
shell:
	@[ "$(SERVICE)" ] || { echo "Usage: make shell SERVICE=<service_name>"; exit 1; }
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) exec $(SERVICE) sh

## status: Alias for ps with extra system info
status: ps
	@echo ""
	@echo "$(CYAN)Docker system disk usage:$(RESET)"
	docker system df

## inspect: Inspect a service container. Usage: make inspect SERVICE=backend
inspect:
	@[ "$(SERVICE)" ] || { echo "Usage: make inspect SERVICE=<service_name>"; exit 1; }
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) ps -q $(SERVICE) | xargs docker inspect

## volumes: List all named volumes for this project
volumes:
	@echo "$(CYAN)Named volumes for project '$(PROJECT_NAME)':$(RESET)"
	docker volume ls --filter "name=$(PROJECT_NAME)"

## networks: List all networks for this project
networks:
	@echo "$(CYAN)Networks for project '$(PROJECT_NAME)':$(RESET)"
	docker network ls --filter "name=$(PROJECT_NAME)"

## db: Open an interactive psql shell in the database container
db:
	@echo "$(CYAN)Connecting to PostgreSQL...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) exec database \
		psql -U $$(grep POSTGRES_USER $(ENV_FILE) | cut -d= -f2) \
		     -d $$(grep POSTGRES_DB   $(ENV_FILE) | cut -d= -f2)

## test: Run the NestJS test suite inside the backend container
test:
	@echo "$(CYAN)Running backend tests...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) exec backend \
		sh -c "cd /app && npm test"

## health: Show health status and last health-check output for every container
health:
	@echo "$(CYAN)Container health:$(RESET)"
	@docker ps --filter "name=$(PROJECT_NAME)" \
		--format "table {{.Names}}\t{{.Status}}" | \
		awk 'NR==1{print "$(BOLD)"$$0"$(RESET)"} NR>1{print}'

## open: Open the app in the default browser at https://localhost:42424
open:
	@echo "$(CYAN)Opening https://localhost:42424 ...$(RESET)"
	@xdg-open https://localhost:42424 >/dev/null 2>&1 &

# ==============================================================================
# HELPERS
# ==============================================================================

## certs: Generate trusted local TLS certs with mkcert if available
certs:
	@if [ ! -s "$(CERT_DIR)/cert.pem" ] || [ ! -s "$(CERT_DIR)/key.pem" ]; then \
		if command -v mkcert >/dev/null 2>&1; then \
			echo "$(CYAN)Generating local TLS certs with mkcert...$(RESET)"; \
			./scripts/generate-local-certs.sh; \
		else \
			echo "$(YELLOW)mkcert not found; reverse proxy will fall back to a self-signed cert.$(RESET)"; \
		fi; \
	fi

## prepare-local-secrets: Ensure local bootstrap directories exist and are writable
prepare-local-secrets:
	@mkdir -p secrets/nginx_ssl secrets/vault/approle/backend secrets/vault/approle/database secrets/vault/approle/redis secrets/vault/approle/monitoring
	@if [ ! -w secrets ] || [ ! -w secrets/vault ]; then \
		echo "$(RED)Local secrets directory is not writable by user '$$(id -un)'.$(RESET)"; \
		echo "$(YELLOW)Fix ownership/permissions on ./secrets before running make again.$(RESET)"; \
		echo "$(YELLOW)Example: sudo chown -R $$(id -un):$$(id -gn) secrets$(RESET)"; \
		exit 1; \
	fi

## check-env: Verify .env file exists (copy from .env.example if missing)
check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(YELLOW).env file not found. Copying from .env.example...$(RESET)"; \
		cp .env.example $(ENV_FILE); \
		echo "$(YELLOW)Please review and edit .env before continuing.$(RESET)"; \
		exit 1; \
	fi

## push: Stage, commit, rebase onto remote, then push. Usage: make push M="your message"
push:
	@if [ -z "$(M)" ]; then \
		printf "$(RED)  Usage: make push M=\"your commit message\"$(RESET)\n"; \
		exit 1; \
	fi
	@printf "$(CYAN)$(BOLD)\n  Checking for uncommitted changes...$(RESET)\n"
	@# Stage everything (including new files, respects .gitignore)
	git add .
	@# Bail out cleanly if there is nothing new to commit
	@if git diff --cached --quiet; then \
		printf "$(YELLOW)  Nothing to commit — working tree clean.$(RESET)\n"; \
	else \
		git commit -m "$(M)"; \
	fi
	@printf "$(CYAN)  Fetching latest remote state...$(RESET)\n"
	@git fetch origin
	@# Determine the tracking branch (falls back to main if none is set)
	$(eval BRANCH := $(shell git rev-parse --abbrev-ref HEAD))
	$(eval REMOTE_BRANCH := $(shell git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "origin/$(BRANCH)"))
	@# Check whether the remote has commits we don't have locally
	@if git merge-base --is-ancestor HEAD $(REMOTE_BRANCH) 2>/dev/null; then \
		printf "$(YELLOW)  Remote is ahead — rebasing local commits on top...$(RESET)\n"; \
		git rebase $(REMOTE_BRANCH) || { \
			printf "$(RED)  Rebase conflict. Resolve conflicts, then run:\n"; \
			printf "    git rebase --continue\n    make push M=\"$(M)\"$(RESET)\n"; \
			exit 1; \
		}; \
	else \
		printf "$(GREEN)  Remote is up to date — no rebase needed.$(RESET)\n"; \
	fi
	@printf "$(CYAN)  Pushing to remote...$(RESET)\n"
	@git push origin HEAD || { \
		printf "$(RED)  Push failed. Run 'git status' to investigate.$(RESET)\n"; \
		exit 1; \
	}
	@printf "$(GREEN)$(BOLD)  [Pushed successfully]$(RESET)\n\n"

## help: Show this help message
help:
	@echo ""
	@echo "$(CYAN)ft_transcendence — Available targets:$(RESET)"
	@echo ""
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'
	@echo ""

.PHONY: up dev prod down restart restart-front restart-back rebuild-front rebuild-back refresh-app build logs ps diagnosis clean fclean re shell status inspect volumes networks db test health open certs check-env push help
