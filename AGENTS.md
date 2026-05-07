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

**Full Stack** (root):
- `docker compose up -d` - Spin up all services (requires `.env` with DB_PASSWORD, JWT_SECRET)

## Architecture Decisions
- **UUID Primary Keys**: All entities use UUIDs; auto-assigned in BeforeCreate hooks
- **Bilingual Support**: Categories/tags have `name_zh` + `name_en` columns; UI language drives display
- **JWT + Middleware**: AuthMiddleware extracts Bearer token; RequireAdmin checks role
- **Multi-Account Ledgers**: Personal (owned) or family (shared via invites, ACL via ledger_users)
- **Linked Ledgers**: Family ledgers can include personal sub-ledgers; dashboard merges transactions

## Conventions
- **GORM Patterns**: Base model with UUID + timestamps; eager load with .Preload(); inline Where() queries
- **Frontend State**: Local component state + localStorage for tokens/theme/locale
- **Theming**: CSS custom properties with data-theme/palette attributes
- **Environment**: godotenv in Go; Vite env vars (VITE_API_URL overrides /api)

## Key Files
- [backend/cmd/main.go](backend/cmd/main.go) - Router setup, middleware
- [backend/internal/api/handlers.go](backend/internal/api/handlers.go) - Core logic
- [backend/internal/models/models.go](backend/internal/models/models.go) - Schema
- [backend/internal/service/db.go](backend/internal/service/db.go) - DB init, migrations
- [frontend/src/App.tsx](frontend/src/App.tsx) - Router, protected routes
- [frontend/src/api/client.ts](frontend/src/api/client.ts) - Axios setup, JWT
- [frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx) - Main dashboard

## Common Pitfalls
- Don't rename `sprouts*` identifiers (internal code names)
- Always store both `_zh` and `_en` for bilingual fields
- Generate JWT_SECRET with `openssl rand -hex 32`
- Set TZ=Asia/Shanghai in Docker for correct timestamps
- Check userCanAccessLedger() before exposing ledger data
- Parse UUID strings before DB queries; check uuid.Nil

## Documentation
- [README.md](README.md) - Features, deployment, architecture
- [frontend/README.md](frontend/README.md) - Frontend setup

For details, see linked files and existing documentation.</content>
<parameter name="filePath">/home/ioe/projects/sprouts-self/AGENTS.md