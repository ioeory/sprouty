package main

import (
	"log"
	"os"
	"sprouts-self/backend/internal/api"
	"sprouts-self/backend/internal/bot"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	_ = godotenv.Load()

	// Initialize Database
	service.InitDB()

	// Setup Router
	r := gin.Default()

	// Public routes
	auth := r.Group("/api/auth")
	{
		auth.POST("/register", api.Register)
		auth.POST("/login", api.Login)
	}

	// Protected routes
	protected := r.Group("/api")
	protected.Use(api.AuthMiddleware())
	{
		// Ledger routes
		protected.GET("/ledgers", api.GetLedgers)
		protected.POST("/ledgers", api.CreateLedger)
		protected.POST("/budgets", api.SetBudget)

		// Ledger sharing
		protected.POST("/ledgers/:id/invite", api.CreateLedgerInvite)
		protected.GET("/ledgers/:id/members", api.GetLedgerMembers)
		protected.DELETE("/ledgers/:id/members/:userId", api.RemoveLedgerMember)
		protected.POST("/ledgers/join", api.JoinLedger)

		// Transaction routes
		protected.GET("/transactions", api.GetTransactions)
		protected.POST("/transactions", api.CreateTransaction)
		protected.PUT("/transactions/:id", api.UpdateTransaction)
		protected.DELETE("/transactions/:id", api.DeleteTransaction)

		// Category routes
		protected.GET("/categories", api.GetCategories)
		protected.POST("/categories", api.CreateCategory)
		protected.PUT("/categories/:id", api.UpdateCategory)
		protected.DELETE("/categories/:id", api.DeleteCategory)

		// Category keyword routes (quick-record hints)
		protected.GET("/categories/:id/keywords", api.ListCategoryKeywords)
		protected.POST("/categories/:id/keywords", api.CreateCategoryKeyword)
		protected.DELETE("/category-keywords/:id", api.DeleteCategoryKeyword)

		// Ledger keyword routes (per-user ledger routing)
		protected.GET("/ledgers/:id/keywords", api.ListLedgerKeywords)
		protected.POST("/ledgers/:id/keywords", api.CreateLedgerKeyword)
		protected.DELETE("/ledger-keywords/:id", api.DeleteLedgerKeyword)

		// Tag routes (transaction labels used for exclusion from statistics)
		protected.GET("/tags", api.ListTags)
		protected.POST("/tags", api.CreateTag)
		protected.PUT("/tags/:id", api.UpdateTag)
		protected.DELETE("/tags/:id", api.DeleteTag)

		// Project routes
		protected.GET("/projects", api.ListProjects)
		protected.POST("/projects", api.CreateProject)
		protected.PUT("/projects/:id", api.UpdateProject)
		protected.DELETE("/projects/:id", api.DeleteProject)
		protected.GET("/projects/:id/summary", api.GetProjectSummary)
		protected.PUT("/projects/:id/budget", api.UpdateProjectBudget)
		protected.DELETE("/projects/:id/budget", api.DeleteProjectBudget)

		// Statistics routes (dual routing for compatibility)
		protected.GET("/dashboard/summary", api.GetDashboardSummary)
		protected.GET("/statistics/summary", api.GetDashboardSummary)

		// Bot routes (Phase 4)
		protected.GET("/bot/binding-code", api.GetBindingCode)
		protected.GET("/bot/status", api.GetBotStatus)
	}

	// Start Bot Manager (Phase 4)
	botMgr := bot.NewBotManager(service.DB)
	botMgr.StartAll()
	defer botMgr.StopAll()

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
