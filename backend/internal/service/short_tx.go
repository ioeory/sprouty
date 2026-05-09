package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sprouts-self/backend/internal/models"
)

// TxShortInfo is a brief transaction summary returned by short-id resolution.
type TxShortInfo struct {
	ID           uuid.UUID  `json:"id"`
	ShortID      string     `json:"short_id"`
	Amount       float64    `json:"amount"`
	Type         string     `json:"type"`
	Note         string     `json:"note"`
	Date         time.Time  `json:"date"`
	CategoryID   uuid.UUID  `json:"category_id"`
	LedgerID     uuid.UUID  `json:"ledger_id"`
	LedgerName   string     `json:"ledger_name"`
	SplitGroupID *uuid.UUID `json:"split_group_id,omitempty"`
}

// ResolveShortTxID finds recent transactions (within 90 days) accessible by
// userID whose UUID hex string starts with the given short prefix (3–8 hex chars).
// Returns all matches; callers should reject ambiguous (len > 1) results.
func ResolveShortTxID(db *gorm.DB, userID uuid.UUID, short string) ([]TxShortInfo, error) {
	short = strings.ToLower(strings.TrimSpace(short))
	if len(short) < 3 || len(short) > 8 {
		return nil, fmt.Errorf("short id must be 3–8 hex characters")
	}
	for _, c := range short {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return nil, fmt.Errorf("invalid character %q in short id", c)
		}
	}

	var members []models.LedgerUser
	if err := db.Where("user_id = ?", userID).Find(&members).Error; err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, nil
	}
	ledgerIDs := make([]uuid.UUID, 0, len(members))
	for _, m := range members {
		ledgerIDs = append(ledgerIDs, m.LedgerID)
	}

	since := time.Now().AddDate(0, 0, -90)
	type rawRow struct {
		models.Transaction
		LedgerName string `gorm:"column:ledger_name"`
	}
	var rows []rawRow
	if err := db.Model(&models.Transaction{}).
		Select("transactions.*, ledgers.name as ledger_name").
		Joins("JOIN ledgers ON ledgers.id = transactions.ledger_id").
		Where("transactions.ledger_id IN ? AND transactions.date >= ? AND transactions.id::text LIKE ?",
			ledgerIDs, since, short+"%").
		Order("transactions.date DESC, transactions.created_at DESC").
		Limit(10).
		Find(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]TxShortInfo, 0, len(rows))
	for _, r := range rows {
		out = append(out, TxShortInfo{
			ID:           r.Transaction.ID,
			ShortID:      r.Transaction.ID.String()[:6],
			Amount:       r.Transaction.Amount,
			Type:         r.Transaction.Type,
			Note:         r.Transaction.Note,
			Date:         r.Transaction.Date,
			CategoryID:   r.Transaction.CategoryID,
			LedgerID:     r.Transaction.LedgerID,
			LedgerName:   r.LedgerName,
			SplitGroupID: r.Transaction.SplitGroupID,
		})
	}
	return out, nil
}
