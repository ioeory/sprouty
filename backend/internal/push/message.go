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
	return strings.TrimSpace(b.String())
}
