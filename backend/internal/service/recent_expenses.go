package service

import (
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sprouts-self/backend/internal/models"
)

// ExpenseLineBrief is one expense row for bot / summaries.
type ExpenseLineBrief struct {
	Amount          float64
	Date            time.Time
	CategoryDisplay string
	Note            string
}

// RecentExpenseLines returns latest expense rows for ledgers (tag exclusion applied).
func RecentExpenseLines(db *gorm.DB, ledgerIDs []uuid.UUID, locale string, limit int) ([]ExpenseLineBrief, error) {
	if len(ledgerIDs) == 0 {
		return nil, nil
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 25 {
		limit = 25
	}
	excluded := excludedTagIDsForDigest(db, ledgerIDs)
	tagScope := applyTagExclusionScope(excluded)

	type row struct {
		Amount   float64   `gorm:"column:amount"`
		TxDate   time.Time `gorm:"column:tx_date"`
		Note     string    `gorm:"column:note"`
		NameZh   string    `gorm:"column:name_zh"`
		NameEn   string    `gorm:"column:name_en"`
	}
	var raw []row
	q := db.Model(&models.Transaction{}).
		Select(`transactions.amount as amount, transactions.date as tx_date, transactions.note as note,
			categories.name_zh as name_zh, categories.name_en as name_en`).
		Joins("JOIN categories ON transactions.category_id = categories.id").
		Where("transactions.ledger_id IN ? AND transactions.type = 'expense'", ledgerIDs).
		Scopes(tagScope).
		Order("transactions.date DESC, transactions.created_at DESC").
		Limit(limit)
	if err := q.Scan(&raw).Error; err != nil {
		return nil, err
	}
	pickLoc := "zh-CN"
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(locale)), "en") {
		pickLoc = "en"
	}
	out := make([]ExpenseLineBrief, 0, len(raw))
	for _, r := range raw {
		cat := PickCategoryDisplayName(pickLoc, r.NameZh, r.NameEn)
		out = append(out, ExpenseLineBrief{
			Amount:          r.Amount,
			Date:            r.TxDate,
			CategoryDisplay: cat,
			Note:            strings.TrimSpace(r.Note),
		})
	}
	return out, nil
}
