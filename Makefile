# ---------------------------------------------------------------------------
# LeadOps Automation Hub — developer entry point.
# Run `make` (or `make help`) to see everything you can do.
# ---------------------------------------------------------------------------

SHELL := bash
.ONESHELL:
.DEFAULT_GOAL := help

# Load local overrides (host ports, credentials) if a .env exists. Values here
# are read as Make variables only (not exported), so they never leak into the
# backend's own process env. Defaults below apply when .env is absent.
-include .env

COMPOSE       := docker compose
BACKEND_DIR   := backend
BACKEND_CTR   := leadops-backend-1

POSTGRES_USER     ?= leadops
POSTGRES_PASSWORD ?= change-me
POSTGRES_DB       ?= leadops
POSTGRES_PORT     ?= 5432
BACKEND_PORT      ?= 3000

API      := http://localhost:$(BACKEND_PORT)
DB_URL   := postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:$(POSTGRES_PORT)/$(POSTGRES_DB)
PSQL     := $(COMPOSE) exec -T postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

.PHONY: help env up down clean restart ps logs logs-backend wait demo \
        install build typecheck lint format test test-int check \
        migrate psql health validate

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# --- Stack lifecycle -------------------------------------------------------

env: ## Create .env from .env.example if it does not exist
	@test -f .env || { cp .env.example .env && echo "created .env from .env.example"; }

up: env ## Build and start the whole stack (detached)
	$(COMPOSE) up --build -d

down: ## Stop containers (keeps data volumes)
	$(COMPOSE) down

clean: ## Stop containers AND remove volumes (wipes DB + n8n data)
	$(COMPOSE) down -v

restart: down up ## Restart the stack

ps: ## Show container status
	$(COMPOSE) ps

logs: ## Tail logs from all services
	$(COMPOSE) logs -f

logs-backend: ## Tail backend logs only
	$(COMPOSE) logs -f backend

wait: ## Block until the backend container reports healthy
	@echo "waiting for backend to become healthy..."
	for i in $$(seq 1 30); do
	  st=$$(docker inspect --format '{{.State.Health.Status}}' $(BACKEND_CTR) 2>/dev/null || echo none)
	  if [ "$$st" = "healthy" ]; then echo "backend healthy"; exit 0; fi
	  sleep 2
	done
	echo "backend did not become healthy in time"; exit 1

demo: up wait validate ## One-shot: bring the stack up, wait, then validate

# --- Backend dev tasks (run inside backend/) -------------------------------

install: ## Install backend dependencies
	cd $(BACKEND_DIR) && npm install

build: ## Compile the backend (nest build)
	cd $(BACKEND_DIR) && npm run build

typecheck: ## Strict TypeScript check (no emit)
	cd $(BACKEND_DIR) && npm run typecheck

lint: ## Run ESLint
	cd $(BACKEND_DIR) && npm run lint

format: ## Format the backend with Prettier
	cd $(BACKEND_DIR) && npm run format

test: ## Unit tests (no external services)
	cd $(BACKEND_DIR) && npm test

test-int: ## Unit + integration tests (needs Postgres running)
	cd $(BACKEND_DIR) && TEST_DATABASE_URL="$(DB_URL)" npm test

check: typecheck lint test ## typecheck + lint + unit tests (CI-like gate)

# --- Database --------------------------------------------------------------

migrate: ## Run TypeORM migrations against the running database
	cd $(BACKEND_DIR) && DATABASE_URL="$(DB_URL)" npm run migration:run

psql: ## Open a psql shell in the postgres container
	$(COMPOSE) exec postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

health: ## Curl the health endpoint
	@curl -s $(API)/health; echo

# --- End-to-end validation of the running stack ----------------------------

validate: ## Live check: health + every endpoint + migration (stack must be up)
	@set -uo pipefail
	pass=0; fail=0
	check() { if [ "$$2" = "$$3" ]; then echo "  PASS  $$1 ($$3)"; pass=$$((pass+1)); \
	          else echo "  FAIL  $$1 (expected $$2, got $$3)"; fail=$$((fail+1)); fi; }
	code() { curl -s -o /dev/null -w "%{http_code}" "$$@"; }
	echo "==> Backend at $(API)"
	$(PSQL) -c "TRUNCATE leads;" >/dev/null 2>&1 || { echo "  cannot reach database — is the stack up? (make up)"; exit 1; }
	check "health 200"    200 "$$(code $(API)/health)"
	check "create 201"    201 "$$(code -X POST $(API)/api/leads -H 'Content-Type: application/json' -d @samples/valid-lead.json)"
	check "duplicate 409" 409 "$$(code -X POST $(API)/api/leads -H 'Content-Type: application/json' -d @samples/valid-lead.json)"
	check "invalid 400"   400 "$$(code -X POST $(API)/api/leads -H 'Content-Type: application/json' -d @samples/invalid-lead.json)"
	check "bad uuid 400"  400 "$$(code $(API)/api/leads/not-a-uuid)"
	check "notfound 404"  404 "$$(code $(API)/api/leads/00000000-0000-0000-0000-000000000000)"
	check "by-email 200"  200 "$$(code $(API)/api/leads/by-email/MARIA@example.com)"
	check "list 200"      200 "$$(code '$(API)/api/leads?page=1&limit=20')"
	echo "==> TypeORM migration applied:"
	$(PSQL) -tAc "SELECT name FROM migrations;" | sed 's/^/  /'
	echo
	echo "Result: $$pass passed, $$fail failed"
	[ "$$fail" -eq 0 ]
