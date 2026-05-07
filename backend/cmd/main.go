package main

import (
	"log"
	"os"
	"sprouts-self/backend/internal/api"
	"sprouts-self/backend/internal/bot"
	"sprouts-self/backend/internal/push"
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
	r.Use(api.LocaleMiddleware())

	// Public routes
	auth := r.Group("/api/auth")
	{
		auth.POST("/register", api.Register)
		auth.POST("/login", api.Login)
		auth.GET("/registration-status", api.RegistrationStatus)
		auth.GET("/oidc/config", api.OIDCConfig)
		auth.GET("/oidc/login", api.OIDCLogin)
		auth.GET("/oidc/callback", api.OIDCCallback)
		auth.POST("/oidc/exchange", api.OIDCExchange)
	}

	admin := r.Group("/api/admin")
	admin.Use(api.AuthMiddleware(), api.RequireAdmin())
	{
		admin.GET("/settings", api.GetAdminSettings)
		admin.PUT("/settings", api.PutAdminSettings)
		admin.POST("/users", api.AdminCreateUser)
		admin.GET("/users", api.GetAdminUsers)
		admin.PUT("/users/:id/password", api.AdminResetUserPassword)
		admin.PUT("/users/:id/status", api.AdminSetUserStatus)
		admin.GET("/audit-logs", api.GetAuditLogs)
	}

	// Protected routes
	protected := r.Group("/api")
	protected.Use(api.AuthMiddleware())
	{
		protected.PUT("/user/locale", api.PutUserLocale)
		protected.PUT("/user/password", api.PutUserPassword)

		// Ledger routes
		protected.GET("/ledgers", api.GetLedgers)
		protected.POST("/ledgers", api.CreateLedger)
		protected.PUT("/ledgers/:id", api.UpdateLedger)
		protected.DELETE("/ledgers/:id", api.DeleteLedger)
		protected.POST("/budgets", api.SetBudget)
		protected.DELETE("/budgets/month-override", api.DeleteBudgetMonthOverride)

		// Ledger sharing
		protected.POST("/ledgers/:id/invite", api.CreateLedgerInvite)
		protected.GET("/ledgers/:id/members", api.GetLedgerMembers)
		protected.PUT("/ledgers/:id/members/:userId/role", api.PutLedgerMemberRole)
		protected.DELETE("/ledgers/:id/members/:userId", api.RemoveLedgerMember)
		protected.POST("/ledgers/join", api.JoinLedger)
		protected.GET("/ledgers/:id/linked-personal", api.GetLinkedPersonalLedgers)
		protected.POST("/ledgers/:id/linked-personal", api.LinkPersonalLedger)
		protected.DELETE("/ledgers/:id/linked-personal/:personalLedgerId", api.UnlinkPersonalLedger)

		// Transaction routes
		protected.GET("/transactions", api.GetTransactions)
		protected.POST("/transactions", api.CreateTransaction)
		protected.POST("/transactions/installment", api.CreateInstallment)
		protected.POST("/transactions/split", api.CreateSplit)
		protected.POST("/transactions/bulk-delete", api.BulkDeleteTransactions)
		protected.POST("/transactions/:id/convert-to-split", api.ConvertTransactionToSplit)
		protected.PUT("/transactions/:id", api.UpdateTransaction)
		protected.DELETE("/transactions/:id", api.DeleteTransaction)
		protected.DELETE("/transactions/installment-group/:groupId", api.DeleteInstallmentGroup)

		// Split-group routes (split-across-sub-ledgers)
		protected.GET("/split-groups", api.ListSplitGroups)
		protected.GET("/split-groups/:id", api.GetSplitGroup)
		protected.DELETE("/split-groups/:id", api.DeleteSplitGroup)

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
		protected.GET("/dashboard/category-by-ledger", api.GetDashboardCategoryByLedger)

		// Bot routes (Phase 4)
		protected.GET("/bot/binding-code", api.GetBindingCode)
		protected.GET("/bot/status", api.GetBotStatus)

		// Scheduled digest push (Telegram) — multiple subscriptions per user
		protected.GET("/push-subscriptions", api.ListPushSubscriptions)
		protected.POST("/push-subscriptions", api.CreatePushSubscription)
		protected.PUT("/push-subscriptions/:id", api.UpdatePushSubscription)
		protected.DELETE("/push-subscriptions/:id", api.DeletePushSubscription)
		protected.POST("/push-subscriptions/:id/test", api.PostPushSubscriptionTest)
	}

	// Start Bot Manager (Phase 4)
	botMgr := bot.NewBotManager(service.DB)
	botMgr.StartAll()
	defer botMgr.StopAll()
	push.DefaultNotifier = botMgr
	push.StartScheduler(service.DB)

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
