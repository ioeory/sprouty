package push

import (
	"fmt"
	"strings"
	"time"

	"sprouts-self/backend/internal/models"
)

// BuildDigestMessage formats the Telegram digest from settings and metrics.
// langEN selects English vs Chinese line templates.
func BuildDigestMessage(s *models.PushNotificationSetting, m *DigestMetrics, langEN bool, localDate time.Time) string {
	var b strings.Builder
	title := strings.TrimSpace(s.CustomPrefix)
	if title == "" {
		if langEN {
			title = "Ledger digest"
		} else {
			title = "账本简报"
		}
	}
	b.WriteString("📊 ")
	b.WriteString(title)
	b.WriteString("\n")
	dateStr := localDate.Format("2006-01-02")
	if langEN {
		b.WriteString(fmt.Sprintf("Book: %s · %s\n", m.LedgerName, dateStr))
	} else {
		b.WriteString(fmt.Sprintf("账本：%s · %s\n", m.LedgerName, dateStr))
	}

	if s.IncludeBudgetRemaining {
		if langEN {
			b.WriteString(fmt.Sprintf("Monthly budget: ¥%.2f\nSpent (month): ¥%.2f\nRemaining: ¥%.2f\nDaily allowance (%d d left): ¥%.2f\n",
				m.TotalBudget, m.MonthExpense, m.Remaining, m.DaysLeft, m.DailyAllowance))
		} else {
			b.WriteString(fmt.Sprintf("本月预算：¥%.2f\n本月已花：¥%.2f\n预算剩余：¥%.2f\n日均可花（剩 %d 天）：¥%.2f\n",
				m.TotalBudget, m.MonthExpense, m.Remaining, m.DaysLeft, m.DailyAllowance))
		}
	}
	if s.IncludeTodayExpense {
		if langEN {
			b.WriteString(fmt.Sprintf("Today's expenses: ¥%.2f\n", m.TodayExpense))
		} else {
			b.WriteString(fmt.Sprintf("当天支出：¥%.2f\n", m.TodayExpense))
		}
	}
	// enriched comparison section
	if s.IncludeComparison {
		if langEN {
			b.WriteString(fmt.Sprintf("Yesterday: ¥%.2f | Last 7d: ¥%.2f\n", m.YesterdayExpense, m.WeekExpense))
			if m.MoMDeltaPct >= 0 {
				b.WriteString(fmt.Sprintf("MoM: +%.1f%%\n", m.MoMDeltaPct))
			} else {
				b.WriteString(fmt.Sprintf("MoM: %.1f%%\n", m.MoMDeltaPct))
			}
			if m.TotalBudget > 0 {
				sign := "+"
				if m.BudgetBurnRatePct < 0 {
					sign = ""
				}
				b.WriteString(fmt.Sprintf("Budget burn: %s%.1f%% vs expected\n", sign, m.BudgetBurnRatePct))
			}
		} else {
			b.WriteString(fmt.Sprintf("昨日支出：¥%.2f | 近 7 天：¥%.2f\n", m.YesterdayExpense, m.WeekExpense))
			if m.MoMDeltaPct >= 0 {
				b.WriteString(fmt.Sprintf("月同比：+%.1f%%\n", m.MoMDeltaPct))
			} else {
				b.WriteString(fmt.Sprintf("月同比：%.1f%%\n", m.MoMDeltaPct))
			}
			if m.TotalBudget > 0 {
				sign := "+"
				if m.BudgetBurnRatePct < 0 {
					sign = ""
				}
				b.WriteString(fmt.Sprintf("预算消耗：%s%.1f%%（相对时间进度）\n", sign, m.BudgetBurnRatePct))
			}
		}
	}
	// top categories today
	if s.IncludeTopCategories && len(m.TopCategoriesToday) > 0 {
		if langEN {
			b.WriteString("Top categories today:\n")
		} else {
			b.WriteString("今日消费分类：\n")
		}
		for _, cat := range m.TopCategoriesToday {
			b.WriteString(fmt.Sprintf("  • %s ¥%.2f\n", cat.Name, cat.Amount))
		}
	}
	// anomaly alert
	if s.IncludeAnomaly && m.AnomalyNote != "" {
		if langEN {
			// convert the Chinese note to a generic English message
			b.WriteString(fmt.Sprintf("⚠️ Spending spike: ¥%.2f today is >2× your recent daily average\n", m.TodayExpense))
		} else {
			b.WriteString(fmt.Sprintf("⚠️ 异常提醒：%s\n", m.AnomalyNote))
		}
	}
	return strings.TrimSpace(b.String())
}
