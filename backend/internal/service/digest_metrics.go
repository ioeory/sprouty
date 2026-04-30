package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sprouts-self/backend/internal/models"
)

// UserHasLedgerAccess returns true if the user is a member of the ledger.
func UserHasLedgerAccess(db *gorm.DB, userID, ledgerID uuid.UUID) bool {
	var n int64
	db.Table("ledger_users").Where("user_id = ? AND ledger_id = ?", userID, ledgerID).Count(&n)
	return n > 0
}

func expandFamilyLinkedClusterForDigest(db *gorm.DB, familyID uuid.UUID) []uuid.UUID {
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

func excludedTagIDsForDigest(db *gorm.DB, ledgerIDs []uuid.UUID) []uuid.UUID {
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

func applyTagExclusionScope(excluded []uuid.UUID) func(*gorm.DB) *gorm.DB {
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
	LedgerName     string
	TotalBudget    float64
	MonthExpense   float64
	Remaining      float64
	TodayExpense   float64
	DaysLeft       int
	DailyAllowance float64
}

// ComputeDigestMetrics aggregates current calendar month and today's expenses in loc,
// with the same family-cluster + exclude_from_stats semantics as the dashboard.
func ComputeDigestMetrics(db *gorm.DB, userID, ledgerID uuid.UUID, now time.Time, loc *time.Location) (*DigestMetrics, error) {
	if loc == nil {
		loc = time.UTC
	}
	if !UserHasLedgerAccess(db, userID, ledgerID) {
		return nil, fmt.Errorf("no ledger access")
	}

	var fam models.Ledger
	if err := db.First(&fam, "id = ?", ledgerID).Error; err != nil {
		return nil, err
	}

	ledgerIDs := []uuid.UUID{ledgerID}
	budgetLedgerIDs := ledgerIDs
	if fam.Type == "family" {
		ledgerIDs = expandFamilyLinkedClusterForDigest(db, ledgerID)
		if len(ledgerIDs) > 1 {
			budgetLedgerIDs = []uuid.UUID{ledgerID}
		}
	}

	excluded := excludedTagIDsForDigest(db, ledgerIDs)
	tagScope := applyTagExclusionScope(excluded)

	localNow := now.In(loc)
	ym := localNow.Format("2006-01")
	firstOfMonth := time.Date(localNow.Year(), localNow.Month(), 1, 0, 0, 0, 0, loc)

	var totalBudget float64
	for _, lid := range budgetLedgerIDs {
		totalBudget += EffectiveLedgerTotalBudget(db, lid, ym)
	}

	var monthExpense float64
	q := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, firstOfMonth, lastOfMonth).
		Scopes(tagScope)
	q.Select("COALESCE(SUM(amount), 0)").Scan(&monthExpense)

	remaining := totalBudget - monthExpense

	daysInMonth := time.Date(localNow.Year(), localNow.Month()+1, 0, 0, 0, 0, 0, loc).Day()
	daysLeft := daysInMonth - localNow.Day() + 1
	if daysLeft <= 0 {
		daysLeft = 1
	}
	dailyAllowance := 0.0
	if daysLeft > 0 && totalBudget > 0 {
		dailyAllowance = remaining / float64(daysLeft)
	}

	dayStart := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	dayEnd := dayStart.AddDate(0, 0, 1).Add(-time.Nanosecond)
	var todayExpense float64
	q2 := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, dayStart, dayEnd).
		Scopes(tagScope)
	q2.Select("COALESCE(SUM(amount), 0)").Scan(&todayExpense)

	return &DigestMetrics{
		LedgerName:     fam.Name,
		TotalBudget:    totalBudget,
		MonthExpense:   monthExpense,
		Remaining:      remaining,
		TodayExpense:   todayExpense,
		DaysLeft:       daysLeft,
		DailyAllowance: dailyAllowance,
	}, nil
}

// SumExpenseInRange sums expense transactions in [start, end] inclusive for ledger cluster
// with the same tag exclusion as digest metrics.
func SumExpenseInRange(db *gorm.DB, ledgerIDs []uuid.UUID, start, end time.Time) float64 {
	if len(ledgerIDs) == 0 {
		return 0
	}
	excluded := excludedTagIDsForDigest(db, ledgerIDs)
	tagScope := applyTagExclusionScope(excluded)
	var sum float64
	q := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, start, end).
		Scopes(tagScope)
	q.Select("COALESCE(SUM(amount), 0)").Scan(&sum)
	return sum
}

// LedgerExpenseClusterIDs returns ledger IDs used for expense aggregation for the given book
// (family cluster expansion for family ledgers).
func LedgerExpenseClusterIDs(db *gorm.DB, ledgerID uuid.UUID) ([]uuid.UUID, error) {
	var led models.Ledger
	if err := db.First(&led, "id = ?", ledgerID).Error; err != nil {
		return nil, err
	}
	if led.Type == "family" {
		return expandFamilyLinkedClusterForDigest(db, ledgerID), nil
	}
	return []uuid.UUID{ledgerID}, nil
}

// UserDigestTimezone picks a location for digest-style date math: first push
// subscription timezone, else Shanghai vs UTC from preferred_locale.
func UserDigestTimezone(db *gorm.DB, userID uuid.UUID) *time.Location {
	var s models.PushNotificationSetting
	err := db.Where("user_id = ?", userID).
		Order("enabled DESC, updated_at DESC").
		First(&s).Error
	if err == nil && strings.TrimSpace(s.Timezone) != "" {
		if loc, e := time.LoadLocation(strings.TrimSpace(s.Timezone)); e == nil {
			return loc
		}
	}
	var u models.User
	if err := db.Select("preferred_locale").First(&u, "id = ?", userID).Error; err == nil {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(u.PreferredLocale)), "en") {
			return time.UTC
		}
	}
	loc, _ := time.LoadLocation("Asia/Shanghai")
	return loc
}

// SumExpenseLastNDays sums expenses from start of (today − n + 1) through end of today in loc.
func SumExpenseLastNDays(db *gorm.DB, ledgerIDs []uuid.UUID, loc *time.Location, now time.Time, n int) float64 {
	if len(ledgerIDs) == 0 {
		return 0
	}
	if n < 1 {
		n = 1
	}
	if n > 366 {
		n = 366
	}
	if loc == nil {
		loc = time.UTC
	}
	local := now.In(loc)
	end := time.Date(local.Year(), local.Month(), local.Day(), 23, 59, 59, 999999999, loc)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(n - 1))
	return SumExpenseInRange(db, ledgerIDs, start, end)
}
