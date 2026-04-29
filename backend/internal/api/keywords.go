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

// FormatCategoryKeywordDisplay builds a single-line label for chips and legacy `keyword` JSON.
func FormatCategoryKeywordDisplay(k models.CategoryKeyword) string {
	a := strings.TrimSpace(k.KeywordZh)
	b := strings.TrimSpace(k.KeywordEn)
	if a != "" && b != "" {
		return a + " / " + b
	}
	if a != "" {
		return a
	}
	return b
}

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
	service.DB.Where("category_id = ?", cat.ID).
		Order("keyword_zh ASC, keyword_en ASC").
		Find(&kws)
	out := make([]gin.H, 0, len(kws))
	for _, k := range kws {
		out = append(out, gin.H{
			"id": k.ID, "category_id": k.CategoryID, "ledger_id": k.LedgerID,
			"keyword_zh": k.KeywordZh, "keyword_en": k.KeywordEn,
			"keyword":    FormatCategoryKeywordDisplay(k),
			"created_at": k.CreatedAt, "updated_at": k.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, out)
}

// CreateCategoryKeyword attaches one bilingual keyword row to a category.
// Body: { "keyword_zh": "…", "keyword_en": "…" } (at least one required), or
// legacy { "keyword": "…" } which sets both sides to the same normalized value.
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
		Keyword   *string `json:"keyword"`
		KeywordZh *string `json:"keyword_zh"`
		KeywordEn *string `json:"keyword_en"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	zh, en := "", ""
	if req.KeywordZh != nil {
		zh = normalizeKeyword(*req.KeywordZh)
	}
	if req.KeywordEn != nil {
		en = normalizeKeyword(*req.KeywordEn)
	}
	if zh == "" && en == "" && req.Keyword != nil && strings.TrimSpace(*req.Keyword) != "" {
		v := normalizeKeyword(*req.Keyword)
		zh, en = v, v
	}
	if ve := validateCategoryKeywordLengths(zh, en); ve != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": ve.Error()})
		return
	}

	if zh != "" {
		var dup models.CategoryKeyword
		err = service.DB.Where("ledger_id = ? AND keyword_zh = ?", cat.LedgerID, zh).First(&dup).Error
		if err == nil {
			var owner models.Category
			service.DB.First(&owner, "id = ?", dup.CategoryID)
			c.JSON(http.StatusConflict, gin.H{
				"error":                "keyword_zh already exists in this ledger",
				"existing_category_id": dup.CategoryID,
				"existing_category":    owner.Name,
			})
			return
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if en != "" {
		var dup models.CategoryKeyword
		err = service.DB.Where("ledger_id = ? AND keyword_en = ?", cat.LedgerID, en).First(&dup).Error
		if err == nil {
			var owner models.Category
			service.DB.First(&owner, "id = ?", dup.CategoryID)
			c.JSON(http.StatusConflict, gin.H{
				"error":                "keyword_en already exists in this ledger",
				"existing_category_id": dup.CategoryID,
				"existing_category":    owner.Name,
			})
			return
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	kw := models.CategoryKeyword{
		CategoryID: cat.ID,
		LedgerID:   cat.LedgerID,
		KeywordZh:  zh,
		KeywordEn:  en,
	}
	if err := service.DB.Create(&kw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":          kw.ID,
		"category_id": kw.CategoryID,
		"ledger_id":   kw.LedgerID,
		"keyword_zh":  kw.KeywordZh,
		"keyword_en":  kw.KeywordEn,
		"keyword":     FormatCategoryKeywordDisplay(kw),
		"created_at":  kw.CreatedAt,
		"updated_at":  kw.UpdatedAt,
	})
}

func validateCategoryKeywordLengths(zh, en string) error {
	if len(zh) > 64 || len(en) > 64 {
		return errors.New("keyword too long (max 64 per language)")
	}
	if zh == "" && en == "" {
		return errors.New("keyword_zh or keyword_en (or legacy keyword) is required")
	}
	return nil
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
