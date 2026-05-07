# Sprouty (萌记) - AI Agent Instructions

This is a self-hosted multi-account bookkeeping application with Go backend, React frontend, and PostgreSQL database.

## Technology Stack
- **Frontend**: React 19, Vite, TypeScript, TailwindCSS v4, React Router, Recharts, i18next
- **Backend**: Go 1.23, Gin, GORM, JWT, PostgreSQL
- **Database**: PostgreSQL 15
- **DevOps**: Docker Compose, Nginx, GitHub Actions

## Build & Test Commands
Run these automatically when validating changes.

**Frontend** (`frontend/`):
- `npm install` - Install dependencies
- `npm run dev` - Local dev server (:5173, proxies /api to backend :8080)
- `npm run build` - Production build to `dist/`
- `npm run lint` - ESLint check

**Backend** (`backend/`):
- `go mod tidy && go mod download` - Manage dependencies
- `CGO_ENABLED=0 GOOS=linux go build -o sprouts-backend ./cmd/main.go` - Build
- Local build pitfall: `backend/go.sum` is often owned by `root` from prior Docker builds, so `go mod tidy`/`go build` fails with `permission denied`. Workaround: `cp -r backend /tmp/x && cd /tmp/x && go mod tidy && go build ./cmd/main.go`.
- No test suite yet beyond `backend/internal/bot/parser_test.go` (`go test ./internal/bot/...`).

**Full Stack** (root):
- `docker compose up -d` - Spin up all services (requires `.env` with DB_PASSWORD, JWT_SECRET)
- After model changes, rebuild backend so GORM AutoMigrate runs: `docker compose build backend && docker compose up -d`.

## Architecture Decisions
- **UUID Primary Keys**: All entities use UUIDs; auto-assigned in BeforeCreate hooks
- **Bilingual Support**: Categories/tags have `name_zh` + `name_en` columns; UI language drives display
- **JWT + Middleware**: AuthMiddleware extracts Bearer token; RequireAdmin checks role
- **Multi-Account Ledgers**: Personal (owned) or family (shared via invites, ACL via `ledger_users`). ACL gate: [`service.UserCanAccessLedger`](backend/internal/service/ledger_acl.go) (read) and `service.UserCanWriteLedger` (write).
- **Linked Ledgers**: Family ledgers can include personal sub-ledgers via `LedgerFamilyLink`. Dashboard / `ListTransactions` merge via the private `expandFamilyLinkedCluster(familyID)` in `backend/internal/api/`. `ListTransactions` accepts `?ledger_ids=` to intersect that cluster.
- **Split groups**: A single family-ledger expense can be split into N child transactions across linked sub-ledgers. Metadata in `split_groups`; child rows are real transactions in their target ledgers. HTTP: `/transactions/split` and `/split-groups/*`. Cross-package entry point: `api.RunSplit(db, api.SplitInput)` (used by the bot to share validation with the HTTP path) — see [backend/internal/api/split.go](backend/internal/api/split.go).
- **Telegram bot**: Long-polling adapter under `backend/internal/bot/`. Bindings live in `models.UserConnection` (`platform="telegram"`, `external_id=chat_id`, optional `default_ledger_id`). Plain messages flow through `parser.go` → `telegram.handlePlainMessage`. Commands: `/bind`, `/ledger`, `/split`. Ledger resolution precedence: leading `@账本名` → `ParseResult.LedgerHint` → `conn.DefaultLedgerID` → first `LedgerUser`.

## Conventions
- **GORM Patterns**: Base model with UUID + timestamps; eager load with .Preload(); inline Where() queries
- **Frontend State**: Local component state + localStorage for tokens/theme/locale
- **Theming**: CSS custom properties with data-theme/palette attributes
- **Environment**: godotenv in Go; Vite env vars (VITE_API_URL overrides /api)

## Key Files
- [backend/cmd/main.go](backend/cmd/main.go) - Router setup, middleware
- [backend/internal/api/handlers.go](backend/internal/api/handlers.go) - Core HTTP logic (incl. `ListTransactions` cluster + `ledger_ids` intersection)
- [backend/internal/api/split.go](backend/internal/api/split.go) - Split endpoint + `RunSplit` wrapper
- [backend/internal/models/models.go](backend/internal/models/models.go) - Schema (Ledger, Transaction, SplitGroup, LedgerFamilyLink, …)
- [backend/internal/models/connection.go](backend/internal/models/connection.go) - Bot binding (`UserConnection.DefaultLedgerID`)
- [backend/internal/service/db.go](backend/internal/service/db.go) - DB init, AutoMigrate list
- [backend/internal/service/ledger_acl.go](backend/internal/service/ledger_acl.go) - `UserCanAccessLedger` / `UserCanWriteLedger`
- [backend/internal/bot/telegram.go](backend/internal/bot/telegram.go) - Command dispatcher, plain-message pipeline
- [backend/internal/bot/split.go](backend/internal/bot/split.go) - `/split` handler
- [frontend/src/App.tsx](frontend/src/App.tsx) - Router, protected routes
- [frontend/src/api/client.ts](frontend/src/api/client.ts) - Axios singleton, JWT interceptor
- [frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx) - Main dashboard
- [frontend/src/pages/Transactions.tsx](frontend/src/pages/Transactions.tsx) - List + filter panel (date / category / tag / **ledger** chips)
- [frontend/src/components/LocalePickers.tsx](frontend/src/components/LocalePickers.tsx) - Bilingual date/time inputs (zh trigger uses compact `YYYY-MM-DD`)
- [frontend/src/locales/](frontend/src/locales/) - i18next JSON namespaces (`zh-CN/`, `en/`)

## Common Pitfalls
- Don't rename `sprouts*` identifiers (internal code names — DB/container/binary)
- Always store both `_zh` and `_en` for bilingual fields
- Generate JWT_SECRET with `openssl rand -hex 32`
- Set `TZ=Asia/Shanghai` in Docker for correct timestamps
- Always gate ledger reads/writes through `service.UserCanAccessLedger` / `UserCanWriteLedger`
- Parse UUID strings before DB queries; check `uuid.Nil`
- When a feature spans family + linked ledgers, expand via `expandFamilyLinkedCluster` (private to api package) — don't query a single ledger ID directly
- Money is stored as `float64`; for arithmetic that must be exact (split allocations) round to cents (`math.Round(v*100)`) and distribute remainders to the first N items
- New cross-package logic from `bot/` reusing api/service code must avoid import cycles — `api` already imports many packages, so put shared logic in `service/` or expose a thin wrapper in `api/` (see `api.RunSplit`)
- Frontend uses a single axios instance ([frontend/src/api/client.ts](frontend/src/api/client.ts)) with JWT interceptor; do not `import axios from 'axios'` directly in pages
- New i18n keys must be added to **both** `frontend/src/locales/zh-CN/<ns>.json` and `frontend/src/locales/en/<ns>.json`

## Documentation
- [README.md](README.md) - Features, deployment, architecture
- [frontend/README.md](frontend/README.md) - Frontend setup

For details, see linked files and existing documentation.</content>
<parameter name="filePath">/home/ioe/projects/sprouts-self/AGENTS.md