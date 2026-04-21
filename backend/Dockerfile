# Stage 1: Build
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy go.mod first
COPY go.mod ./

# Copy all source code (needed for go mod tidy to analyze imports)
COPY . .

# Generate go.sum and download dependencies
RUN go mod tidy
RUN go mod download

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o /sprouts-backend ./cmd/main.go

# Stage 2: Run
FROM alpine:latest

# ca-certificates: HTTPS calls to Telegram Bot API, etc.
# tzdata: correct local time in logs
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S app \
    && adduser -S -G app app

WORKDIR /app

# Copy the binary only. Runtime configuration comes from real environment
# variables (docker-compose, K8s secrets, etc.) — never bake defaults into
# the image. godotenv.Load() in main.go tolerates a missing .env file.
COPY --from=builder --chown=app:app /sprouts-backend ./sprouts-backend

USER app

EXPOSE 8080

CMD ["./sprouts-backend"]
