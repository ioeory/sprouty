package api

import (
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// DeleteBudgetMonthOverride removes the ledger_total row for a month so the
// effective budget falls back to ledgers.default_monthly_budget.
func DeleteBudgetMonthOverride(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	lidStr := c.Query("ledger_id")
	ym := c.Query("year_month")
	if lidStr == "" || ym == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ledger_id and year_month are required"})
		return
	}
	lid, err := uuid.Parse(lidStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
		return
	}
	if !userCanAccessLedger(userID, lid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	res := service.DB.Where("ledger_id = ? AND scope = ? AND year_month = ?", lid, "ledger_total", ym).
		Delete(&models.Budget{})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no month override for this ledger"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
