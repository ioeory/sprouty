package bot

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"

	"sprouts-self/backend/internal/api"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
)

// handleList handles /list [N] — shows the last N transactions (default 10).
func (t *TelegramAdapter) handleList(msg *tgbotapi.Message) {
	conn, err := t.requireBinding(msg)
	if err != nil {
		return
	}
	preferEn := t.userPreferEn(conn.UserID)

	n := 10
	if arg := strings.TrimSpace(msg.CommandArguments()); arg != "" {
		if v, e := strconv.Atoi(arg); e == nil && v > 0 && v <= 50 {
			n = v
		}
	}

	// Get all ledger IDs accessible by the user
	var members []models.LedgerUser
	t.db.Where("user_id = ?", conn.UserID).Find(&members)
	if len(members) == 0 {
		t.sendReply(msg.Chat.ID, "暂无账本。\nNo ledgers found.")
		return
	}
	ledgerIDs := make([]uuid.UUID, 0, len(members))
	for _, m := range members {
		ledgerIDs = append(ledgerIDs, m.LedgerID)
	}

	since := time.Now().AddDate(0, 0, -90)
	type rawRow struct {
		models.Transaction
		CategoryNameZh string `gorm:"column:cat_name_zh"`
		CategoryNameEn string `gorm:"column:cat_name_en"`
		LedgerName     string `gorm:"column:ledger_name"`
	}
	var rows []rawRow
	if err := t.db.Model(&models.Transaction{}).
		Select("transactions.*, categories.name_zh as cat_name_zh, categories.name_en as cat_name_en, ledgers.name as ledger_name").
		Joins("JOIN categories ON categories.id = transactions.category_id").
		Joins("JOIN ledgers ON ledgers.id = transactions.ledger_id").
		Where("transactions.ledger_id IN ? AND transactions.date >= ?", ledgerIDs, since).
		Order("transactions.date DESC, transactions.created_at DESC").
		Limit(n).
		Find(&rows).Error; err != nil {
		t.sendReply(msg.Chat.ID, "查询失败，请稍后再试。")
		return
	}

	if len(rows) == 0 {
		if preferEn {
			t.sendReply(msg.Chat.ID, "No transactions in the last 90 days.")
		} else {
			t.sendReply(msg.Chat.ID, "最近 90 天没有流水记录。")
		}
		return
	}

	loc := "zh"
	if preferEn {
		loc = "en"
	}
	lines := make([]string, 0, len(rows)+1)
	if preferEn {
		lines = append(lines, fmt.Sprintf("Last %d transactions:", len(rows)))
	} else {
		lines = append(lines, fmt.Sprintf("最近 %d 条流水：", len(rows)))
	}
	for _, r := range rows {
		catLabel := service.PickCategoryDisplayName(loc, r.CategoryNameZh, r.CategoryNameEn)
		if catLabel == "" {
			catLabel = r.CategoryNameZh
		}
		sign := "-"
		if r.Transaction.Type == "income" {
			sign = "+"
		}
		note := ""
		if r.Transaction.Note != "" {
			note = " · " + r.Transaction.Note
		}
		line := fmt.Sprintf("#%s %s %s¥%.2f %s%s @%s",
			r.Transaction.ID.String()[:6],
			r.Transaction.Date.Format("01-02"),
			sign,
			r.Transaction.Amount,
			catLabel,
			note,
			r.LedgerName,
		)
		lines = append(lines, line)
	}
	t.sendReply(msg.Chat.ID, strings.Join(lines, "\n"))
}

// handleDel handles /del <shortId> [single|group]
func (t *TelegramAdapter) handleDel(msg *tgbotapi.Message) {
	conn, err := t.requireBinding(msg)
	if err != nil {
		return
	}
	preferEn := t.userPreferEn(conn.UserID)

	args := strings.Fields(strings.TrimSpace(msg.CommandArguments()))
	if len(args) == 0 {
		if preferEn {
			t.sendReply(msg.Chat.ID, "Usage: /del <shortId> [single|group]\nExample: /del abc123")
		} else {
			t.sendReply(msg.Chat.ID, "用法：/del <流水短ID> [single|group]\n示例：/del abc123\n可选模式 single（仅删此条）或 group（删整组分账）；不填时按账本类型自动选择。")
		}
		return
	}

	short := strings.ToLower(args[0])
	delMode := ""
	if len(args) >= 2 {
		switch strings.ToLower(args[1]) {
		case "single", "group":
			delMode = strings.ToLower(args[1])
		}
	}

	matches, err := service.ResolveShortTxID(t.db, conn.UserID, short)
	if err != nil {
		t.sendReply(msg.Chat.ID, "查询失败："+err.Error())
		return
	}
	if len(matches) == 0 {
		if preferEn {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("No transaction found with ID #%s in the last 90 days.", short))
		} else {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("最近 90 天未找到短 ID 为 #%s 的流水。", short))
		}
		return
	}
	if len(matches) > 1 {
		ids := make([]string, 0, len(matches))
		for _, m := range matches {
			ids = append(ids, fmt.Sprintf("#%s ¥%.2f %s", m.ShortID, m.Amount, m.Date.Format("01-02")))
		}
		if preferEn {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("Ambiguous short ID #%s — %d matches:\n%s\nPlease use more characters.", short, len(matches), strings.Join(ids, "\n")))
		} else {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("短 ID #%s 有 %d 条匹配，请补充更多字符：\n%s", short, len(matches), strings.Join(ids, "\n")))
		}
		return
	}

	match := matches[0]
	n, err := api.BotDeleteTransaction(t.db, conn.UserID, match.ID, delMode)
	if err != nil {
		if errors.Is(err, api.ErrReadOnlyLedgerMember) {
			if preferEn {
				t.sendReply(msg.Chat.ID, "Read-only member: cannot delete this transaction.")
			} else {
				t.sendReply(msg.Chat.ID, "只读成员：无权删除该流水。")
			}
			return
		}
		t.sendReply(msg.Chat.ID, "删除失败："+err.Error())
		return
	}
	if preferEn {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("✅ Deleted %d transaction(s) (#%s).", n, match.ShortID))
	} else {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("✅ 已删除 %d 条流水 (#%s)。", n, match.ShortID))
	}
}

// handleFind handles /find <keyword> — searches last 30d transactions by note/category.
func (t *TelegramAdapter) handleFind(msg *tgbotapi.Message) {
	conn, err := t.requireBinding(msg)
	if err != nil {
		return
	}
	preferEn := t.userPreferEn(conn.UserID)

	keyword := strings.TrimSpace(msg.CommandArguments())
	if keyword == "" {
		if preferEn {
			t.sendReply(msg.Chat.ID, "Usage: /find <keyword>\nSearches note and category in the last 30 days.")
		} else {
			t.sendReply(msg.Chat.ID, "用法：/find <关键词>\n搜索最近 30 天的备注与分类。")
		}
		return
	}

	var members []models.LedgerUser
	t.db.Where("user_id = ?", conn.UserID).Find(&members)
	if len(members) == 0 {
		t.sendReply(msg.Chat.ID, "暂无账本。")
		return
	}
	ledgerIDs := make([]uuid.UUID, 0, len(members))
	for _, m := range members {
		ledgerIDs = append(ledgerIDs, m.LedgerID)
	}

	since := time.Now().AddDate(0, 0, -30)
	like := "%" + keyword + "%"
	type rawRow struct {
		models.Transaction
		CategoryNameZh string `gorm:"column:cat_name_zh"`
		CategoryNameEn string `gorm:"column:cat_name_en"`
		LedgerName     string `gorm:"column:ledger_name"`
	}
	var rows []rawRow
	t.db.Model(&models.Transaction{}).
		Select("transactions.*, categories.name_zh as cat_name_zh, categories.name_en as cat_name_en, ledgers.name as ledger_name").
		Joins("JOIN categories ON categories.id = transactions.category_id").
		Joins("JOIN ledgers ON ledgers.id = transactions.ledger_id").
		Where("transactions.ledger_id IN ? AND transactions.date >= ? AND (transactions.note ILIKE ? OR categories.name_zh ILIKE ? OR categories.name_en ILIKE ?)",
			ledgerIDs, since, like, like, like).
		Order("transactions.date DESC").
		Limit(10).
		Find(&rows)

	if len(rows) == 0 {
		if preferEn {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("No results for %q in the last 30 days.", keyword))
		} else {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("最近 30 天没有匹配 %q 的记录。", keyword))
		}
		return
	}

	loc := "zh"
	if preferEn {
		loc = "en"
	}
	lines := make([]string, 0, len(rows)+1)
	if preferEn {
		lines = append(lines, fmt.Sprintf("Search: %q — %d results:", keyword, len(rows)))
	} else {
		lines = append(lines, fmt.Sprintf("搜索「%s」— %d 条结果：", keyword, len(rows)))
	}
	for _, r := range rows {
		catLabel := service.PickCategoryDisplayName(loc, r.CategoryNameZh, r.CategoryNameEn)
		sign := "-"
		if r.Transaction.Type == "income" {
			sign = "+"
		}
		note := ""
		if r.Transaction.Note != "" {
			note = " · " + r.Transaction.Note
		}
		lines = append(lines, fmt.Sprintf("#%s %s %s¥%.2f %s%s",
			r.Transaction.ID.String()[:6],
			r.Transaction.Date.Format("01-02"),
			sign,
			r.Transaction.Amount,
			catLabel,
			note,
		))
	}
	t.sendReply(msg.Chat.ID, strings.Join(lines, "\n"))
}

// handleUndo handles /undo — deletes the user's most recent Telegram-created tx within 3 hours.
func (t *TelegramAdapter) handleUndo(msg *tgbotapi.Message) {
	conn, err := t.requireBinding(msg)
	if err != nil {
		return
	}
	preferEn := t.userPreferEn(conn.UserID)

	window := time.Now().Add(-3 * time.Hour)
	type rawRow struct {
		models.Transaction
		LedgerName string `gorm:"column:ledger_name"`
	}
	var row rawRow
	err = t.db.Model(&models.Transaction{}).
		Select("transactions.*, ledgers.name as ledger_name").
		Joins("JOIN ledgers ON ledgers.id = transactions.ledger_id").
		Where("transactions.user_id = ? AND transactions.created_at >= ?", conn.UserID, window).
		Order("transactions.created_at DESC").
		Limit(1).
		First(&row).Error
	if err != nil {
		if preferEn {
			t.sendReply(msg.Chat.ID, "No transaction to undo in the last 3 hours.")
		} else {
			t.sendReply(msg.Chat.ID, "最近 3 小时没有可撤销的流水记录。")
		}
		return
	}

	shortID := row.Transaction.ID.String()[:6]
	n, delErr := api.BotDeleteTransaction(t.db, conn.UserID, row.Transaction.ID, "")
	if delErr != nil {
		t.sendReply(msg.Chat.ID, "撤销失败："+delErr.Error())
		return
	}
	if preferEn {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("✅ Undone: deleted %d record(s) (#%s · ¥%.2f · %s)",
			n, shortID, row.Transaction.Amount, row.LedgerName))
	} else {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("✅ 已撤销：删除 %d 条流水（#%s · ¥%.2f · %s）",
			n, shortID, row.Transaction.Amount, row.LedgerName))
	}
}

// requireBinding looks up the UserConnection for this chat, sends an error reply
// if not found, and returns the connection.
func (t *TelegramAdapter) requireBinding(msg *tgbotapi.Message) (models.UserConnection, error) {
	var conn models.UserConnection
	if err := t.db.Where("platform = ? AND external_id = ?", "telegram",
		strconv.FormatInt(msg.Chat.ID, 10)).First(&conn).Error; err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。\nAccount not linked. Use /bind [PIN].")
		return conn, err
	}
	return conn, nil
}
