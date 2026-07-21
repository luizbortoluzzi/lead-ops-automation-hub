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
FRONTEND_DIR  := frontend
BACKEND_CTR   := leadops-backend-1

POSTGRES_USER     ?= leadops
POSTGRES_PASSWORD ?= change-me
POSTGRES_DB       ?= leadops
POSTGRES_PORT     ?= 5432
BACKEND_PORT      ?= 3000
BACKEND_API_KEY   ?= change-me-development-key
N8N_PORT          ?= 5678
MAILPIT_WEB_PORT  ?= 8025
MAILPIT_SMTP_PORT ?= 1025
FRONTEND_PORT     ?= 5173

API      := http://localhost:$(BACKEND_PORT)
DB_URL   := postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:$(POSTGRES_PORT)/$(POSTGRES_DB)
PSQL     := $(COMPOSE) exec -T postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

.PHONY: help env up down clean restart ps logs logs-backend wait demo urls \
        install build typecheck lint format test test-int check \
        fe-install fe-build fe-lint fe-dev \
        n8n-import wf-smoke \
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

# --- Frontend (React + Vite + Tailwind, in frontend/) ----------------------

fe-install: ## Install frontend dependencies
	cd $(FRONTEND_DIR) && npm install

fe-build: ## Typecheck + build the frontend
	cd $(FRONTEND_DIR) && npm run build

fe-lint: ## Lint the frontend
	cd $(FRONTEND_DIR) && npm run lint

fe-dev: ## Run the Vite dev server (proxies /api to the backend host port)
	cd $(FRONTEND_DIR) && VITE_DEV_PROXY=$(API) npm run dev

# --- Database --------------------------------------------------------------

migrate: ## Run TypeORM migrations against the running database
	cd $(BACKEND_DIR) && DATABASE_URL="$(DB_URL)" npm run migration:run

# --- n8n workflows ---------------------------------------------------------

n8n-import: ## Import workflows/*.json into the running n8n (stable ids + WF99 error workflow)
	$(COMPOSE) exec -T n8n sh -lc 'rm -rf /tmp/wf && mkdir -p /tmp/wf'
	$(COMPOSE) cp workflows/. n8n:/tmp/wf/
	$(COMPOSE) exec -T n8n n8n import:workflow --separate --input=/tmp/wf
	@echo "Imported. Remaining manual step (GUI): create the 'LeadOps Backend API' (Header Auth) and 'Mailpit SMTP' credentials and select them in the HTTP/Email nodes."

wf-smoke: ## Smoke-test WF06/WF01/WF07 behaviors against the backend (replay/conflict/retry/reprocess)
	BASE=$(API) KEY='$(BACKEND_API_KEY)' MAILPIT=http://localhost:$(MAILPIT_WEB_PORT) \
	  SMTP_HOST=localhost SMTP_PORT=$(MAILPIT_SMTP_PORT) node scripts/wf-smoke-test.mjs

psql: ## Open a psql shell in the postgres container
	$(COMPOSE) exec postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

health: ## Curl the health endpoint
	@curl -s $(API)/health; echo

urls: ## Print the local service URLs
	@echo "  frontend   http://localhost:$(FRONTEND_PORT)   (dashboard UI)"
	@echo "  backend    $(API)"
	@echo "  n8n        http://localhost:$(N8N_PORT)"
	@echo "  mailpit    http://localhost:$(MAILPIT_WEB_PORT)"

# --- End-to-end validation of the running stack ----------------------------

validate: ## Live check: health, auth, upsert, correlation id, activities (stack must be up)
	@set -uo pipefail
	pass=0; fail=0
	check() { if [ "$$2" = "$$3" ]; then echo "  PASS  $$1 ($$3)"; pass=$$((pass+1)); \
	          else echo "  FAIL  $$1 (expected $$2, got $$3)"; fail=$$((fail+1)); fi; }
	K='$(BACKEND_API_KEY)'
	code() { curl -s -o /dev/null -w "%{http_code}" "$$@"; }
	acode() { curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: $$K" "$$@"; }
	echo "==> Backend at $(API)"
	$(PSQL) -c "TRUNCATE lead_activities, leads CASCADE;" >/dev/null 2>&1 || { echo "  cannot reach database — is the stack up? (make up)"; exit 1; }
	check "health public 200"  200 "$$(code $(API)/health)"
	check "upsert no key 401"  401 "$$(code -X POST $(API)/api/v1/leads/upsert -H 'Content-Type: application/json' -d @samples/valid-lead.json)"
	check "upsert create 201"  201 "$$(acode -X POST $(API)/api/v1/leads/upsert -H 'Content-Type: application/json' -d @samples/valid-lead.json)"
	check "upsert update 200"  200 "$$(acode -X POST $(API)/api/v1/leads/upsert -H 'Content-Type: application/json' -d @samples/update-lead.json)"
	check "invalid 400"        400 "$$(acode -X POST $(API)/api/v1/leads/upsert -H 'Content-Type: application/json' -d @samples/invalid-lead.json)"
	cid=$$(curl -s -D - -o /dev/null -H "X-API-Key: $$K" -H "X-Correlation-Id: mk-cid-123" -X POST $(API)/api/v1/leads/upsert -H 'Content-Type: application/json' -d @samples/valid-lead.json | tr -d '\r' | awk 'tolower($$1)=="x-correlation-id:"{print $$2}')
	check "correlation echo"   mk-cid-123 "$$cid"
	lid=$$(curl -s -H "X-API-Key: $$K" $(API)/api/v1/leads/by-email/maria@example.com | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.id")
	check "activity 201"       201 "$$(acode -X POST $(API)/api/v1/leads/$$lid/activities -H 'Content-Type: application/json' -d '{"type":"AUTOMATION_PROCESSED","description":"validate","metadata":{}}')"
	check "activity 404"       404 "$$(acode -X POST $(API)/api/v1/leads/00000000-0000-0000-0000-000000000000/activities -H 'Content-Type: application/json' -d '{"type":"AUTOMATION_PROCESSED","description":"x"}')"
	echo "==> TypeORM migrations applied:"
	$(PSQL) -tAc "SELECT name FROM migrations ORDER BY id;" | sed 's/^/  /'
	echo
	echo "Result: $$pass passed, $$fail failed"
	[ "$$fail" -eq 0 ]
