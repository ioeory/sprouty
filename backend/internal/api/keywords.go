package api

import (
	"errors"
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// -------- Category Keywords --------

// ListCategoryKeywords returns the keyword list attached to a single category.
// Typically the frontend fetches keywords via GET /categories (bulk), so this
// endpoint is mainly for debugging / admin tools.
func ListCategoryKeywords(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	catID := c.Param("id")
	var cat models.Category
	if err := service.DB.First(&cat, "id = ?", catID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}
	if !userCanAccessLedger(userID, cat.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	var kws []models.CategoryKeyword
	service.DB.Where("category_id = ?", cat.ID).Order("keyword ASC").Find(&kws)
	c.JSON(http.StatusOK, kws)
}

// CreateCategoryKeyword attaches one keyword to a category.
// Keyword is normalized (lowercased, trimmed) and the (ledger_id, keyword)
// uniqueness constraint is enforced at the DB layer.
func CreateCategoryKeyword(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	catID := c.Param("id")
	var cat models.Category
	if err := service.DB.First(&cat, "id = ?", catID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}
	if !userCanAccessLedger(userID, cat.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	var req struct {
		Keyword string `json:"keyword" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	norm := normalizeKeyword(req.Keyword)
	if norm == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "keyword cannot be empty"})
		return
	}
	if len(norm) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "keyword too long (max 64)"})
		return
	}

	// Detect duplicate inside the same ledger ahead of the constraint so we can
	// return a helpful 409 message pointing at the owning category.
	var dup models.CategoryKeyword
	err = service.DB.Where("ledger_id = ? AND keyword = ?", cat.LedgerID, norm).First(&dup).Error
	if err == nil {
		var owner models.Category
		service.DB.First(&owner, "id = ?", dup.CategoryID)
		c.JSON(http.StatusConflict, gin.H{
			"error":                "keyword already exists in this ledger",
			"existing_category_id": dup.CategoryID,
			"existing_category":    owner.Name,
		})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	kw := models.CategoryKeyword{
		CategoryID: cat.ID,
		LedgerID:   cat.LedgerID,
		Keyword:    norm,
	}
	if err := service.DB.Create(&kw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, kw)
}

// DeleteCategoryKeyword removes a keyword by its own ID.
func DeleteCategoryKeyword(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id := c.Param("id")
	var kw models.CategoryKeyword
	if err := service.DB.First(&kw, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "keyword not found"})
		return
	}
	if !userCanAccessLedger(userID, kw.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	if err := service.DB.Delete(&kw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.Status(http.StatusNoContent)
}

// -------- Ledger Keywords (per user) --------

// ListLedgerKeywords returns the current user's keywords for a ledger.
func ListLedgerKeywords(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	ledgerIDStr := c.Param("id")
	lid, err := uuid.Parse(ledgerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
		return
	}
	if !userCanAccessLedger(userID, lid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	var kws []models.LedgerKeyword
	service.DB.Where("ledger_id = ? AND user_id = ?", lid, userID).
		Order("keyword ASC").Find(&kws)
	c.JSON(http.StatusOK, kws)
}

// CreateLedgerKeyword attaches a user-private keyword to a ledger.
// Uniqueness is (user_id, keyword) so the same keyword can't point at two
// different ledgers for the same user.
func CreateLedgerKeyword(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	ledgerIDStr := c.Param("id")
	lid, err := uuid.Parse(ledgerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
		return
	}
	if !userCanAccessLedger(userID, lid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	var req struct {
		Keyword string `json:"keyword" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	norm := normalizeKeyword(req.Keyword)
	if norm == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "keyword cannot be empty"})
		return
	}
	if len(norm) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "keyword too long (max 64)"})
		return
	}

	// Conflict check
	var dup models.LedgerKeyword
	err = service.DB.Where("user_id = ? AND keyword = ?", userID, norm).First(&dup).Error
	if err == nil {
		var owner models.Ledger
		service.DB.First(&owner, "id = ?", dup.LedgerID)
		c.JSON(http.StatusConflict, gin.H{
			"error":              "keyword already points to another ledger",
			"existing_ledger_id": dup.LedgerID,
			"existing_ledger":    owner.Name,
		})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	kw := models.LedgerKeyword{
		LedgerID: lid,
		UserID:   userID,
		Keyword:  norm,
	}
	if err := service.DB.Create(&kw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, kw)
}

// DeleteLedgerKeyword removes a keyword owned by the current user.
func DeleteLedgerKeyword(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id := c.Param("id")
	var kw models.LedgerKeyword
	if err := service.DB.First(&kw, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "keyword not found"})
		return
	}
	if kw.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not owner"})
		return
	}
	if err := service.DB.Delete(&kw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.Status(http.StatusNoContent)
}

// normalizeKeyword trims whitespace and lowercases so matches stay case/space
// insensitive regardless of how the user types them.
func normalizeKeyword(in string) string {
	return strings.ToLower(strings.TrimSpace(in))
}
