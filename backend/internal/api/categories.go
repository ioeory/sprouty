package api

import (
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// CreateCategory adds a custom category to a ledger
func CreateCategory(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var req struct {
		Name      string    `json:"name" binding:"required"`
		Icon      string    `json:"icon"`
		Color     string    `json:"color"`
		Type      string    `json:"type" binding:"required"` // expense / income
		LedgerID  uuid.UUID `json:"ledger_id" binding:"required"`
		SortOrder *int      `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !userCanAccessLedger(userID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	sort := 100
	if req.SortOrder != nil {
		sort = *req.SortOrder
	}
	cat := models.Category{
		Name:      req.Name,
		Icon:      req.Icon,
		Color:     req.Color,
		Type:      req.Type,
		LedgerID:  req.LedgerID,
		IsSystem:  false,
		SortOrder: sort,
	}
	if err := service.DB.Create(&cat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create category"})
		return
	}
	c.JSON(http.StatusCreated, cat)
}

// UpdateCategory modifies a user-defined category
func UpdateCategory(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	id := c.Param("id")
	var cat models.Category
	if err := service.DB.First(&cat, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}

	if !userCanAccessLedger(userID, cat.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	var req struct {
		Name      *string `json:"name"`
		Icon      *string `json:"icon"`
		Color     *string `json:"color"`
		SortOrder *int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Allow renaming / recolouring even system categories, but keep type fixed
	if req.Name != nil {
		cat.Name = *req.Name
	}
	if req.Icon != nil {
		cat.Icon = *req.Icon
	}
	if req.Color != nil {
		cat.Color = *req.Color
	}
	if req.SortOrder != nil {
		cat.SortOrder = *req.SortOrder
	}
	if err := service.DB.Save(&cat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update"})
		return
	}
	c.JSON(http.StatusOK, cat)
}

// DeleteCategory removes a user-defined category. System categories are protected.
func DeleteCategory(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	id := c.Param("id")
	var cat models.Category
	if err := service.DB.First(&cat, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}

	if !userCanAccessLedger(userID, cat.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	if cat.IsSystem {
		c.JSON(http.StatusBadRequest, gin.H{"error": "system categories cannot be deleted"})
		return
	}

	// Prevent deleting categories that still have transactions
	var count int64
	service.DB.Model(&models.Transaction{}).Where("category_id = ?", cat.ID).Count(&count)
	if count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category still has transactions, please migrate or remove them first"})
		return
	}

	// Cascade: drop keyword hints first so ledger uniqueness index stays clean.
	service.DB.Where("category_id = ?", cat.ID).Delete(&models.CategoryKeyword{})

	if err := service.DB.Delete(&cat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.Status(http.StatusNoContent)
}
