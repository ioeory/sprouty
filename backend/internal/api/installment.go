package api

import (
	"fmt"
	"math"
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// splitEqualInstallmentCents splits total into n parts in currency cents (remainder to earliest months).
func splitEqualInstallmentCents(total float64, n int) []float64 {
	if n <= 0 {
		return nil
	}
	totalCents := int64(math.Round(total * 100))
	base := totalCents / int64(n)
	rem := totalCents % int64(n)
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		c := base
		if int64(i) < rem {
			c++
		}
		out[i] = float64(c) / 100
	}
	return out
}

func addMonthsKeepDay(t time.Time, add int, loc *time.Location) time.Time {
	if loc == nil {
		loc = t.Location()
	}
	t = t.In(loc)
	y, m, d := t.Date()
	first := time.Date(y, m+time.Month(add), 1, 12, 0, 0, 0, loc)
	lastDay := time.Date(first.Year(), first.Month()+1, 0, 12, 0, 0, 0, loc).Day()
	day := d
	if day > lastDay {
		day = lastDay
	}
	return time.Date(first.Year(), first.Month(), day, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), loc)
}

// CreateInstallment creates n expense transactions sharing installment_group_id.
func CreateInstallment(c *gin.Context) {
	userUUID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var req struct {
		Amount     float64     `json:"amount" binding:"required"`
		CategoryID uuid.UUID   `json:"category_id" binding:"required"`
		LedgerID   uuid.UUID   `json:"ledger_id" binding:"required"`
		Note       string      `json:"note"`
		Date       time.Time   `json:"date"`
		Months     int         `json:"months" binding:"required"`
		Mode       string      `json:"mode"` // "equal" | "custom"
		Amounts    []float64   `json:"amounts"`
		TagIDs     []uuid.UUID `json:"tag_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Months < 2 || req.Months > 60 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "months must be between 2 and 60"})
		return
	}
	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount must be positive"})
		return
	}
	if !userCanAccessLedger(userUUID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	var cat models.Category
	if err := service.DB.Where("id = ? AND ledger_id = ?", req.CategoryID, req.LedgerID).First(&cat).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category does not belong to this ledger"})
		return
	}
	if cat.Type != "expense" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "installment applies to expense categories only"})
		return
	}

	loc := time.Now().Location()
	if req.Date.IsZero() {
		req.Date = time.Now()
	}
	req.Date = req.Date.In(loc)

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "equal"
	}

	var parts []float64
	switch mode {
	case "equal":
		parts = splitEqualInstallmentCents(req.Amount, req.Months)
	case "custom":
		if len(req.Amounts) != req.Months {
			c.JSON(http.StatusBadRequest, gin.H{"error": "amounts length must equal months"})
			return
		}
		var sum float64
		for _, a := range req.Amounts {
			if a <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "each custom amount must be positive"})
				return
			}
			sum += a
		}
		if math.Abs(sum-req.Amount) > 0.02 {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("amounts must sum to total (got %.2f, want %.2f)", sum, req.Amount)})
			return
		}
		parts = req.Amounts
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be equal or custom"})
		return
	}

	groupID := uuid.New()
	noteBase := strings.TrimSpace(req.Note)
	out := make([]gin.H, 0, req.Months)

	if txErr := service.DB.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < req.Months; i++ {
			dt := addMonthsKeepDay(req.Date, i, loc)
			note := noteBase
			if req.Months > 1 {
				if note != "" {
					note = fmt.Sprintf("%s (%d/%d)", noteBase, i+1, req.Months)
				} else {
					note = fmt.Sprintf("%d/%d", i+1, req.Months)
				}
			}
			tr := models.Transaction{
				Amount:             parts[i],
				Type:               "expense",
				CategoryID:         req.CategoryID,
				LedgerID:           req.LedgerID,
				UserID:             userUUID,
				Note:               note,
				Date:               dt,
				InstallmentGroupID: &groupID,
			}
			if err := tx.Create(&tr).Error; err != nil {
				return err
			}
			if len(req.TagIDs) > 0 {
				if err := ReplaceTransactionTags(tx, tr.ID, req.LedgerID, req.TagIDs); err != nil {
					return err
				}
			}
			var loaded models.Transaction
			if err := tx.First(&loaded, "id = ?", tr.ID).Error; err != nil {
				return err
			}
			out = append(out, withTransactionTagsDB(tx, loaded))
		}
		return nil
	}); txErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": txErr.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"installment_group_id": groupID,
		"transactions":         out,
	})
}

// DeleteInstallmentGroup removes all transactions in an installment group (same ledger).
func DeleteInstallmentGroup(c *gin.Context) {
	userUUID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	gid, err := uuid.Parse(c.Param("groupId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
		return
	}
	var txs []models.Transaction
	if err := service.DB.Where("installment_group_id = ?", gid).Find(&txs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(txs) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no such installment group"})
		return
	}
	lid := txs[0].LedgerID
	for _, t := range txs {
		if t.LedgerID != lid {
			c.JSON(http.StatusBadRequest, gin.H{"error": "inconsistent ledger in group"})
			return
		}
	}
	if !userCanAccessLedger(userUUID, lid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	if err := service.DB.Transaction(func(tx *gorm.DB) error {
		for _, t := range txs {
			if err := tx.Where("transaction_id = ?", t.ID).Delete(&models.TransactionTag{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&models.Transaction{}, "id = ?", t.ID).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "deleted": len(txs)})
}
