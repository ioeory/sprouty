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

// InstallmentCreateParams is shared by the REST handler and the Telegram bot.
type InstallmentCreateParams struct {
	Amount     float64
	CategoryID uuid.UUID
	LedgerID   uuid.UUID
	Note       string
	Date       time.Time // zero = now
	Months     int
	Mode       string // "equal" | "custom"
	Amounts    []float64
	TagIDs     []uuid.UUID
}

// ExecInstallment creates n linked expense rows in one DB transaction.
func ExecInstallment(db *gorm.DB, userID uuid.UUID, p InstallmentCreateParams) (groupID uuid.UUID, out []gin.H, err error) {
	if p.Months < 2 || p.Months > 60 {
		return uuid.Nil, nil, fmt.Errorf("months must be between 2 and 60")
	}
	if p.Amount <= 0 {
		return uuid.Nil, nil, fmt.Errorf("amount must be positive")
	}
	if !userCanAccessLedger(userID, p.LedgerID) {
		return uuid.Nil, nil, fmt.Errorf("forbidden")
	}
	var cat models.Category
	if err := db.Where("id = ? AND ledger_id = ?", p.CategoryID, p.LedgerID).First(&cat).Error; err != nil {
		return uuid.Nil, nil, fmt.Errorf("category does not belong to this ledger")
	}
	if cat.Type != "expense" {
		return uuid.Nil, nil, fmt.Errorf("installment applies to expense categories only")
	}

	loc := time.Now().Location()
	d0 := p.Date
	if d0.IsZero() {
		d0 = time.Now()
	}
	d0 = d0.In(loc)

	mode := strings.ToLower(strings.TrimSpace(p.Mode))
	if mode == "" {
		mode = "equal"
	}

	var parts []float64
	switch mode {
	case "equal":
		parts = splitEqualInstallmentCents(p.Amount, p.Months)
	case "custom":
		if len(p.Amounts) != p.Months {
			return uuid.Nil, nil, fmt.Errorf("amounts length must equal months")
		}
		var sum float64
		for _, a := range p.Amounts {
			if a <= 0 {
				return uuid.Nil, nil, fmt.Errorf("each custom amount must be positive")
			}
			sum += a
		}
		if math.Abs(sum-p.Amount) > 0.02 {
			return uuid.Nil, nil, fmt.Errorf("amounts must sum to total (got %.2f, want %.2f)", sum, p.Amount)
		}
		parts = p.Amounts
	default:
		return uuid.Nil, nil, fmt.Errorf("mode must be equal or custom")
	}

	gid := uuid.New()
	noteBase := strings.TrimSpace(p.Note)
	out = make([]gin.H, 0, p.Months)

	txErr := db.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < p.Months; i++ {
			dt := addMonthsKeepDay(d0, i, loc)
			note := noteBase
			if p.Months > 1 {
				if note != "" {
					note = fmt.Sprintf("%s (%d/%d)", noteBase, i+1, p.Months)
				} else {
					note = fmt.Sprintf("%d/%d", i+1, p.Months)
				}
			}
			tr := models.Transaction{
				Amount:             parts[i],
				Type:               "expense",
				CategoryID:         p.CategoryID,
				LedgerID:           p.LedgerID,
				UserID:             userID,
				Note:               note,
				Date:               dt,
				InstallmentGroupID: &gid,
			}
			if err := tx.Create(&tr).Error; err != nil {
				return err
			}
			if len(p.TagIDs) > 0 {
				if err := ReplaceTransactionTags(tx, tr.ID, p.LedgerID, p.TagIDs); err != nil {
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
	})
	if txErr != nil {
		return uuid.Nil, nil, txErr
	}
	return gid, out, nil
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

	gid, out, execErr := ExecInstallment(service.DB, userUUID, InstallmentCreateParams{
		Amount:     req.Amount,
		CategoryID: req.CategoryID,
		LedgerID:   req.LedgerID,
		Note:       req.Note,
		Date:       req.Date,
		Months:     req.Months,
		Mode:       req.Mode,
		Amounts:    req.Amounts,
		TagIDs:     req.TagIDs,
	})
	if execErr != nil {
		st := http.StatusBadRequest
		if execErr.Error() == "forbidden" {
			st = http.StatusForbidden
		}
		c.JSON(st, gin.H{"error": execErr.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"installment_group_id": gid,
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
