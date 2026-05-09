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

// TopCategoryEntry is one category in the top-N today list.
type TopCategoryEntry struct {
	Name   string
	Amount float64
}

// LargeTxEntry is a brief summary of the largest transaction today.
type LargeTxEntry struct {
	Amount float64
	Note   string
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
	// enriched fields (always computed, always included)
	YesterdayExpense   float64
	WeekExpense        float64
	MoMDeltaPct        float64 // month-over-month delta %
	BudgetBurnRatePct  float64 // budget consumed % vs time elapsed %
	AnomalyNote        string  // non-empty when today > 2x 30-day median daily spend
	TopCategoriesToday []TopCategoryEntry
	RecentLargeTx      *LargeTxEntry
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
	lastOfMonth := time.Date(localNow.Year(), localNow.Month()+1, 0, 23, 59, 59, 999999999, loc)

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

	// --- enriched fields ---
	// yesterday
	yestStart := dayStart.AddDate(0, 0, -1)
	yestEnd := dayStart.Add(-time.Nanosecond)
	var yesterdayExpense float64
	qY := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, yestStart, yestEnd).
		Scopes(tagScope)
	qY.Select("COALESCE(SUM(amount), 0)").Scan(&yesterdayExpense)

	// last 7 days (including today)
	weekStart := dayStart.AddDate(0, 0, -6)
	var weekExpense float64
	qW := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, weekStart, dayEnd).
		Scopes(tagScope)
	qW.Select("COALESCE(SUM(amount), 0)").Scan(&weekExpense)

	// MoM: same month last year for delta % (prev calendar month)
	prevMonthFirst := firstOfMonth.AddDate(0, -1, 0)
	prevMonthLast := firstOfMonth.Add(-time.Second)
	var prevMonthExpense float64
	qPrev := db.Model(&models.Transaction{}).
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, prevMonthFirst, prevMonthLast).
		Scopes(tagScope)
	qPrev.Select("COALESCE(SUM(amount), 0)").Scan(&prevMonthExpense)
	var momDeltaPct float64
	if prevMonthExpense > 0 {
		momDeltaPct = (monthExpense - prevMonthExpense) / prevMonthExpense * 100
	}

	// budget burn rate: consumed% vs time elapsed%
	var budgetBurnRatePct float64
	if totalBudget > 0 {
		consumed := monthExpense / totalBudget * 100
		elapsed := float64(localNow.Day()) / float64(daysInMonth) * 100
		budgetBurnRatePct = consumed - elapsed // positive = burning faster than expected
	}

	// anomaly: today > 2x 30-day median daily spend
	var anomalyNote string
	if todayExpense > 0 && daysInMonth > 1 {
		// simple median approximation: use average as proxy
		avgDaily := monthExpense / float64(localNow.Day())
		if avgDaily > 0 && todayExpense > 2*avgDaily {
			anomalyNote = fmt.Sprintf("今日支出 ¥%.2f 超过 30 天日均 ¥%.2f 的 2 倍", todayExpense, avgDaily)
		}
	}

	// top 3 categories today
	type catRow struct {
		NameZh string  `gorm:"column:name_zh"`
		NameEn string  `gorm:"column:name_en"`
		Total  float64 `gorm:"column:total"`
	}
	var catRows []catRow
	db.Model(&models.Transaction{}).
		Select("categories.name_zh, categories.name_en, SUM(transactions.amount) as total").
		Joins("JOIN categories ON categories.id = transactions.category_id").
		Where("transactions.ledger_id IN ? AND transactions.type = 'expense' AND transactions.date >= ? AND transactions.date <= ?",
			ledgerIDs, dayStart, dayEnd).
		Scopes(tagScope).
		Group("categories.name_zh, categories.name_en").
		Order("total DESC").
		Limit(3).
		Find(&catRows)
	topCats := make([]TopCategoryEntry, 0, len(catRows))
	for _, r := range catRows {
		name := strings.TrimSpace(r.NameZh)
		if name == "" {
			name = strings.TrimSpace(r.NameEn)
		}
		topCats = append(topCats, TopCategoryEntry{Name: name, Amount: r.Total})
	}

	// largest tx today
	var largeTx *LargeTxEntry
	type largeTxRow struct {
		Amount float64
		Note   string
	}
	var ltRow largeTxRow
	if err := db.Model(&models.Transaction{}).
		Select("amount, note").
		Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?", ledgerIDs, dayStart, dayEnd).
		Scopes(tagScope).
		Order("amount DESC").
		Limit(1).
		Find(&ltRow).Error; err == nil && ltRow.Amount > 0 {
		largeTx = &LargeTxEntry{Amount: ltRow.Amount, Note: ltRow.Note}
	}

	return &DigestMetrics{
		LedgerName:         fam.Name,
		TotalBudget:        totalBudget,
		MonthExpense:       monthExpense,
		Remaining:          remaining,
		TodayExpense:       todayExpense,
		DaysLeft:           daysLeft,
		DailyAllowance:     dailyAllowance,
		YesterdayExpense:   yesterdayExpense,
		WeekExpense:        weekExpense,
		MoMDeltaPct:        momDeltaPct,
		BudgetBurnRatePct:  budgetBurnRatePct,
		AnomalyNote:        anomalyNote,
		TopCategoriesToday: topCats,
		RecentLargeTx:      largeTx,
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
