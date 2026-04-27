package push

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"sprouts-self/backend/internal/models"
)

func userCanAccessLedger(db *gorm.DB, userID, ledgerID uuid.UUID) bool {
	var n int64
	db.Table("ledger_users").Where("user_id = ? AND ledger_id = ?", userID, ledgerID).Count(&n)
	return n > 0
}

func expandFamilyLinkedCluster(db *gorm.DB, familyID uuid.UUID) []uuid.UUID {
	var fam models.Ledger
	if err := db.First(&fam, "id = ?", familyID).Error; err != nil || fam.Type != "family" {
		return []uuid.UUID{familyID}
	}
	out := []uuid.UUID{familyID}
	var links []models.LedgerFamilyLink
	db.Where("family_ledger_id = ?", familyID).Find(&links)
	for _, lk := range links {
		out = append(out, lk.PersonalLedgerID)
	}
	return out
}

func excludedTagIDs(db *gorm.DB, ledgerIDs []uuid.UUID) []uuid.UUID {
	if len(ledgerIDs) == 0 {
		return nil
	}
	var tags []models.Tag
	db.Where("ledger_id IN ? AND exclude_from_stats = TRUE", ledgerIDs).Find(&tags)
	seen := make(map[uuid.UUID]bool)
	var ids []uuid.UUID
	for _, t := range tags {
		if !seen[t.ID] {
			seen[t.ID] = true
			ids = append(ids, t.ID)
		}
	}
	return ids
}

func applyTagExclusion(_ *gorm.DB, excluded []uuid.UUID) func(*gorm.DB) *gorm.DB {
	return func(tx *gorm.DB) *gorm.DB {
		if len(excluded) == 0 {
			return tx
		}
		return tx.Where(
			"NOT EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = transactions.id AND tt.tag_id IN ?)",
			excluded,
		)
	}
}

// DigestMetrics mirrors dashboard headline numbers for one ledger (incl. family cluster).
type DigestMetrics struct {
	LedgerName   string
	TotalBudget  float64
	MonthExpense float64
	Remaining    float64
	TodayExpense float64
}

// ComputeDigestMetrics aggregates current calendar month and today's expenses in loc,
// with the same family-cluster + exclude_from_stats semantics as the dashboard.
func ComputeDigestMetrics(db *gorm.DB, userID, ledgerID uuid.UUID, now time.Time, loc *time.Location) (*DigestMetrics, error) {
	if loc == nil {
		loc = time.UTC
	}
	if !userCanAccessLedger(db, userID, ledgerID) {
		return nil, fmt.Errorf("no ledger access")
	}

	var fam models.Ledger
	if err := db.First(&fam, "id = ?", ledgerID).Error; err != nil {
		return nil, err
	}

	ledgerIDs := []uuid.UUID{ledgerID}
	budgetLedgerIDs := ledgerIDs
	if fam.Type == "family" {
		ledgerIDs = expandFamilyLinkedCluster(db, ledgerID)
		if len(ledgerIDs) > 1 {
			budgetLedgerIDs = []uuid.UUID{ledgerID}
		}
	}

	excluded := excludedTagIDs(db, ledgerIDs)
	tagScope := applyTagExclusion(db, excluded)

	localNow := now.In(loc)
	ym := localNow.Format("2006-01")
	firstOfMonth := time.Date(localNow.Year(), localNow.Month(), 1, 0, 0, 0, 0, loc)
	lastOfMonth := firstOfMonth.AddDate(0, 1, 0).Add(-time.Second)

	var totalBudget float64
	db.Model(&models.Budget{}).
		Where("ledger_id IN ? AND scope = 'ledger_total' AND year_month = ?", budgetLedgerIDs, ym).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&totalBudget)

	var monthExpense float64
	q := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, firstOfMonth, lastOfMonth).
		Scopes(tagScope)
	q.Select("COALESCE(SUM(amount), 0)").Scan(&monthExpense)

	remaining := totalBudget - monthExpense

	dayStart := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	dayEnd := dayStart.AddDate(0, 0, 1).Add(-time.Nanosecond)
	var todayExpense float64
	q2 := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, dayStart, dayEnd).
		Scopes(tagScope)
	q2.Select("COALESCE(SUM(amount), 0)").Scan(&todayExpense)

	return &DigestMetrics{
		LedgerName:   fam.Name,
		TotalBudget:  totalBudget,
		MonthExpense: monthExpense,
		Remaining:    remaining,
		TodayExpense: todayExpense,
	}, nil
}
