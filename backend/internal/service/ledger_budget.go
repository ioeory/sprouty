package service

import (
	"errors"

	"sprouts-self/backend/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// EffectiveLedgerTotalBudget returns ledger_total for year_month if a row exists,
// otherwise the ledger's default_monthly_budget (or 0).
func EffectiveLedgerTotalBudget(db *gorm.DB, ledgerID uuid.UUID, yearMonth string) float64 {
	var row models.Budget
	if err := db.Where("ledger_id = ? AND scope = ? AND year_month = ?", ledgerID, "ledger_total", yearMonth).First(&row).Error; err == nil {
		return row.Amount
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0
	}
	var led models.Ledger
	if err := db.Select("default_monthly_budget").First(&led, "id = ?", ledgerID).Error; err != nil {
		return 0
	}
	if led.DefaultMonthlyBudget != nil {
		return *led.DefaultMonthlyBudget
	}
	return 0
}
