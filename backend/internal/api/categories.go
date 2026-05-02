package api

import (
	"net/http"
	"strings"

	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func normalizeCategoryNames(reqName, reqZh, reqEn *string) (zh, en string, errMsg string) {
	if reqZh != nil {
		zh = strings.TrimSpace(*reqZh)
	}
	if reqEn != nil {
		en = strings.TrimSpace(*reqEn)
	}
	if zh == "" && en == "" && reqName != nil && strings.TrimSpace(*reqName) != "" {
		v := strings.TrimSpace(*reqName)
		return v, v, ""
	}
	if zh == "" && en == "" {
		return "", "", "name_zh or name_en (or legacy name) is required"
	}
	return zh, en, ""
}

// FormatCategoryNameLine shows zh/en for conflict messages and audit.
func FormatCategoryNameLine(c models.Category) string {
	a := strings.TrimSpace(c.NameZh)
	b := strings.TrimSpace(c.NameEn)
	if a != "" && b != "" && a != b {
		return a + " / " + b
	}
	if a != "" {
		return a
	}
	return b
}

// CreateCategory adds a custom category to a ledger
func CreateCategory(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var req struct {
		Name      *string   `json:"name"`
		NameZh    *string   `json:"name_zh"`
		NameEn    *string   `json:"name_en"`
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

	zh, en, errMsg := normalizeCategoryNames(req.Name, req.NameZh, req.NameEn)
	if errMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}

	if !userCanAccessLedger(userID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}
	if respondLedgerViewerForbidden(c, userID, req.LedgerID) {
		return
	}

	sort := 100
	if req.SortOrder != nil {
		sort = *req.SortOrder
	}
	cat := models.Category{
		NameZh:    zh,
		NameEn:    en,
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
	c.JSON(http.StatusCreated, gin.H{
		"id":         cat.ID,
		"name_zh":    cat.NameZh,
		"name_en":    cat.NameEn,
		"name":       service.PickCategoryDisplayName(Locale(c), cat.NameZh, cat.NameEn),
		"icon":       cat.Icon,
		"color":      cat.Color,
		"type":       cat.Type,
		"ledger_id":  cat.LedgerID,
		"is_system":  cat.IsSystem,
		"sort_order": cat.SortOrder,
		"created_at": cat.CreatedAt,
		"updated_at": cat.UpdatedAt,
	})
}

// UpdateCategory modifies a category (including system: rename/recolor/reorder).
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
	if respondLedgerViewerForbidden(c, userID, cat.LedgerID) {
		return
	}

	var req struct {
		Name      *string `json:"name"`
		NameZh    *string `json:"name_zh"`
		NameEn    *string `json:"name_en"`
		Icon      *string `json:"icon"`
		Color     *string `json:"color"`
		SortOrder *int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil || req.NameZh != nil || req.NameEn != nil {
		if req.Name != nil && req.NameZh == nil && req.NameEn == nil {
			v := strings.TrimSpace(*req.Name)
			cat.NameZh, cat.NameEn = v, v
		} else {
			if req.NameZh != nil {
				cat.NameZh = strings.TrimSpace(*req.NameZh)
			}
			if req.NameEn != nil {
				cat.NameEn = strings.TrimSpace(*req.NameEn)
			}
		}
	}
	if strings.TrimSpace(cat.NameZh) == "" && strings.TrimSpace(cat.NameEn) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name_zh and name_en cannot both be empty"})
		return
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
	// Use Updates (not Save) so we do not rewrite created_at; reduces write amplification vs remote Postgres.
	if err := service.DB.Model(&models.Category{}).Where("id = ?", cat.ID).Updates(map[string]interface{}{
		"name_zh":    cat.NameZh,
		"name_en":    cat.NameEn,
		"icon":       cat.Icon,
		"color":      cat.Color,
		"sort_order": cat.SortOrder,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update"})
		return
	}
	if err := service.DB.First(&cat, "id = ?", cat.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reload category"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":         cat.ID,
		"name_zh":    cat.NameZh,
		"name_en":    cat.NameEn,
		"name":       service.PickCategoryDisplayName(Locale(c), cat.NameZh, cat.NameEn),
		"icon":       cat.Icon,
		"color":      cat.Color,
		"type":       cat.Type,
		"ledger_id":  cat.LedgerID,
		"is_system":  cat.IsSystem,
		"sort_order": cat.SortOrder,
		"updated_at": cat.UpdatedAt,
	})
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
	if respondLedgerViewerForbidden(c, userID, cat.LedgerID) {
		return
	}

	if cat.IsSystem {
		c.JSON(http.StatusBadRequest, gin.H{"error": "system categories cannot be deleted"})
		return
	}

	var count int64
	service.DB.Model(&models.Transaction{}).Where("category_id = ?", cat.ID).Count(&count)
	if count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category still has transactions, please migrate or remove them first"})
		return
	}

	service.DB.Where("category_id = ?", cat.ID).Delete(&models.CategoryKeyword{})

	if err := service.DB.Delete(&cat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.Status(http.StatusNoContent)
}
