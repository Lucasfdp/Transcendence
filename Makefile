# ==============================================================================
# ft_transcendence — Makefile
# ==============================================================================
# All Docker Compose operations are routed through this Makefile.
# The compose file lives in srcs/ so we always pass -f explicitly.
# During 42 evaluation, examiners will run: make up / make down / make re
# ==============================================================================

COMPOSE_FILE	:= srcs/docker-compose.yml
OVERRIDE_FILE	:= srcs/docker-compose.override.yml
ENV_FILE		:= .env
PROJECT_NAME	:= transcendence

# Colours for pretty output
RED		:= \033[0;31m
GREEN	:= \033[0;32m
YELLOW	:= \033[0;33m
CYAN	:= \033[0;36m
BOLD	:= \033[1m
RESET	:= \033[0m

# Default target
.DEFAULT_GOAL := help

# ==============================================================================
# CORE TARGETS
# ==============================================================================

## up: Build images (if needed) and start all services in detached mode
up: check-env
	@echo "$(GREEN)Starting all services...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --build
	@echo "$(GREEN)All services are up. Run 'make ps' to verify.$(RESET)"

## dev: Start with hot-reload override (Vite HMR + NestJS watch). Access frontend at http://localhost:3000
dev: check-env
	@echo "$(GREEN)Starting in DEV mode (hot-reload)...$(RESET)"
	docker compose -f $(COMPOSE_FILE) -f $(OVERRIDE_FILE) --env-file $(ENV_FILE) up -d --build
	@echo "$(GREEN)Dev server running. Frontend: http://localhost:3000$(RESET)"

## prod: Start WITHOUT the dev override — production-like mode (uses serve + compiled dist)
prod: check-env
	@echo "$(GREEN)Starting in PROD mode (no override)...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) up -d --build
	@echo "$(GREEN)Production-mode services up. Frontend: https://localhost$(RESET)"

## down: Stop and remove containers, networks (volumes are preserved by default)
down:
	@echo "$(YELLOW)Stopping all services...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) down
	@echo "$(YELLOW)Services stopped. Volumes preserved.$(RESET)"

## restart: Restart all services (preserves volumes)
restart: down up

## build: Build or rebuild all images without starting containers
build: check-env
	@echo "$(CYAN)Building all images...$(RESET)"
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) build --no-cache

## logs: Tail logs for all services, or one service. Usage: make logs [SERVICE=backend]
logs:
	@if [ "$(SERVICE)" ]; then \
		docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) logs -f $(SERVICE); \
	else \
		docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) logs -f; \
	fi

## ps: Show status of all running containers
ps:
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) ps

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

# ==============================================================================
# HELPERS
# ==============================================================================

## check-env: Verify .env file exists (copy from .env.example if missing)
check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(YELLOW).env file not found. Copying from .env.example...$(RESET)"; \
		cp .env.example $(ENV_FILE); \
		echo "$(YELLOW)Please review and edit .env before continuing.$(RESET)"; \
		exit 1; \
	fi

push:
	@if [ -z "$(M)" ]; then \
		printf "$(RED)  Usage: make push M=\"your commit message\"$(RESET)\n"; \
	else \
		printf "$(CYAN)$(BOLD)\n  Pushing to remote...$(RESET)\n\n"; \
		git add . && \
		git commit -m "$(M)" && \
		git push && \
		printf "$(GREEN)$(BOLD)  [Pushed successfully]$(RESET)\n\n"; \
	fi

## help: Show this help message
help:
	@echo ""
	@echo "$(CYAN)ft_transcendence — Available targets:$(RESET)"
	@echo ""
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'
	@echo ""

.PHONY: up dev prod down restart build logs ps clean fclean re shell status inspect volumes networks db test health check-env push help
