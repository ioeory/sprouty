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

// ListTags returns all tags for a ledger the current user can access.
func ListTags(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	ledgerIDStr := c.Query("ledger_id")
	if ledgerIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ledger_id is required"})
		return
	}
	lid, err := uuid.Parse(ledgerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
		return
	}
	if !userCanAccessLedger(userID, lid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	var tags []models.Tag
	service.DB.Where("ledger_id = ?", lid).Order("name ASC").Find(&tags)
	c.JSON(http.StatusOK, tags)
}

// CreateTag adds a new tag to the given ledger.
func CreateTag(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var req struct {
		LedgerID         uuid.UUID `json:"ledger_id" binding:"required"`
		Name             string    `json:"name" binding:"required"`
		Color            string    `json:"color"`
		ExcludeFromStats bool      `json:"exclude_from_stats"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !userCanAccessLedger(userID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name cannot be empty"})
		return
	}
	if len(name) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name too long (max 64)"})
		return
	}

	// Friendly duplicate check before hitting the unique index.
	var dup models.Tag
	err = service.DB.Where("ledger_id = ? AND LOWER(name) = ?", req.LedgerID, strings.ToLower(name)).First(&dup).Error
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "该账本已存在同名标签", "existing_id": dup.ID})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tag := models.Tag{
		LedgerID:         req.LedgerID,
		Name:             name,
		Color:            req.Color,
		ExcludeFromStats: req.ExcludeFromStats,
	}
	if err := service.DB.Create(&tag).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, tag)
}

// UpdateTag modifies a tag's display or exclusion behaviour.
func UpdateTag(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id := c.Param("id")
	var tag models.Tag
	if err := service.DB.First(&tag, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
		return
	}
	if !userCanAccessLedger(userID, tag.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	var req struct {
		Name             *string `json:"name"`
		Color            *string `json:"color"`
		ExcludeFromStats *bool   `json:"exclude_from_stats"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name cannot be empty"})
			return
		}
		if len(n) > 64 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name too long"})
			return
		}
		// Conflict check against siblings in the same ledger (excluding self)
		var dup models.Tag
		err = service.DB.Where("ledger_id = ? AND LOWER(name) = ? AND id <> ?",
			tag.LedgerID, strings.ToLower(n), tag.ID).First(&dup).Error
		if err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "该账本已存在同名标签"})
			return
		}
		tag.Name = n
	}
	if req.Color != nil {
		tag.Color = *req.Color
	}
	if req.ExcludeFromStats != nil {
		tag.ExcludeFromStats = *req.ExcludeFromStats
	}
	if err := service.DB.Save(&tag).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tag)
}

// DeleteTag removes a tag and all its junction rows (unlinks from transactions).
func DeleteTag(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id := c.Param("id")
	var tag models.Tag
	if err := service.DB.First(&tag, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
		return
	}
	if !userCanAccessLedger(userID, tag.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	// Unlink from every transaction first so we don't leave dangling junction rows.
	service.DB.Where("tag_id = ?", tag.ID).Delete(&models.TransactionTag{})
	if err := service.DB.Delete(&tag).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.Status(http.StatusNoContent)
}

// -------- helpers used by other packages (transactions, bot) --------

// LoadTagsForLedger returns the tag catalog of a ledger, keyed by lower-cased name
// for O(1) lookups during bulk matching (e.g. the Telegram parser).
func LoadTagsForLedger(ledgerID uuid.UUID) map[string]models.Tag {
	var tags []models.Tag
	service.DB.Where("ledger_id = ?", ledgerID).Find(&tags)
	out := make(map[string]models.Tag, len(tags))
	for _, t := range tags {
		out[strings.ToLower(t.Name)] = t
	}
	return out
}

// EnsureTag looks up a tag by (ledger, name). If it doesn't exist, the tag is
// created with a sensible default color. Used by the Bot's auto-create flow.
// Returns the tag and `created=true` iff it was just inserted.
func EnsureTag(ledgerID uuid.UUID, name string) (models.Tag, bool, error) {
	n := strings.TrimSpace(name)
	if n == "" {
		return models.Tag{}, false, errors.New("empty tag name")
	}
	var tag models.Tag
	err := service.DB.Where("ledger_id = ? AND LOWER(name) = ?", ledgerID, strings.ToLower(n)).First(&tag).Error
	if err == nil {
		return tag, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Tag{}, false, err
	}
	tag = models.Tag{
		LedgerID: ledgerID,
		Name:     n,
		Color:    "#A78BFA",
	}
	if err := service.DB.Create(&tag).Error; err != nil {
		return models.Tag{}, false, err
	}
	return tag, true, nil
}

// ReplaceTransactionTags drops all tag links for the given transaction and
// replaces them with the provided tag ids. All provided tag ids must belong
// to the transaction's ledger (verified via the Tag.LedgerID column).
//
// Used by both the REST handler and the Bot.
func ReplaceTransactionTags(tx *gorm.DB, transactionID, ledgerID uuid.UUID, tagIDs []uuid.UUID) error {
	if tx == nil {
		tx = service.DB
	}
	if err := tx.Where("transaction_id = ?", transactionID).Delete(&models.TransactionTag{}).Error; err != nil {
		return err
	}
	if len(tagIDs) == 0 {
		return nil
	}
	// Validate ledger ownership in one roundtrip.
	var validCount int64
	tx.Model(&models.Tag{}).Where("id IN ? AND ledger_id = ?", tagIDs, ledgerID).Count(&validCount)
	if int(validCount) != len(tagIDs) {
		return errors.New("one or more tag_ids do not belong to the transaction's ledger")
	}
	rows := make([]models.TransactionTag, 0, len(tagIDs))
	for _, tid := range tagIDs {
		rows = append(rows, models.TransactionTag{TransactionID: transactionID, TagID: tid})
	}
	return tx.Create(&rows).Error
}

// LoadTransactionTags returns tag rows for the given transaction IDs grouped
// by transaction ID, avoiding N+1 queries when listing transactions.
func LoadTransactionTags(transactionIDs []uuid.UUID) map[uuid.UUID][]models.Tag {
	out := map[uuid.UUID][]models.Tag{}
	if len(transactionIDs) == 0 {
		return out
	}
	type row struct {
		TransactionID uuid.UUID
		models.Tag
	}
	var rows []row
	service.DB.Table("transaction_tags").
		Select("transaction_tags.transaction_id, tags.*").
		Joins("JOIN tags ON tags.id = transaction_tags.tag_id").
		Where("transaction_tags.transaction_id IN ? AND tags.deleted_at IS NULL", transactionIDs).
		Scan(&rows)
	for _, r := range rows {
		out[r.TransactionID] = append(out[r.TransactionID], r.Tag)
	}
	return out
}
