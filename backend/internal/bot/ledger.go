package bot

import (
	"fmt"
	"strconv"
	"strings"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"

	"sprouts-self/backend/internal/models"
)

// loadAccessibleLedgers returns every ledger the user has access to via
// LedgerUser membership. Used by `/ledger` and `/split` to resolve a user
// supplied name (case-insensitive substring match).
func (t *TelegramAdapter) loadAccessibleLedgers(userID uuid.UUID) []models.Ledger {
	var lus []models.LedgerUser
	if err := t.db.Where("user_id = ?", userID).Find(&lus).Error; err != nil || len(lus) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(lus))
	for _, lu := range lus {
		ids = append(ids, lu.LedgerID)
	}
	var ledgers []models.Ledger
	if err := t.db.Where("id IN ?", ids).Find(&ledgers).Error; err != nil {
		return nil
	}
	return ledgers
}

// resolveLedgerByName picks the user-accessible ledger whose name matches the
// query. Matching is case-insensitive and prefers exact name first, then
// prefix, then substring. Returns (ledger, true) on a unique match.
func (t *TelegramAdapter) resolveLedgerByName(userID uuid.UUID, query string) (models.Ledger, bool) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return models.Ledger{}, false
	}
	ledgers := t.loadAccessibleLedgers(userID)
	if len(ledgers) == 0 {
		return models.Ledger{}, false
	}
	var exact, prefix, substr []models.Ledger
	for _, l := range ledgers {
		ln := strings.ToLower(l.Name)
		switch {
		case ln == q:
			exact = append(exact, l)
		case strings.HasPrefix(ln, q):
			prefix = append(prefix, l)
		case strings.Contains(ln, q):
			substr = append(substr, l)
		}
	}
	for _, group := range [][]models.Ledger{exact, prefix, substr} {
		if len(group) == 1 {
			return group[0], true
		}
	}
	return models.Ledger{}, false
}

// stripLedgerPrefix peels a leading `@账本名` (or `@account name`) token off
// the message text. The name runs until whitespace; quoted names are not
// supported (matches typical chat usage). Returns "" if no prefix.
func stripLedgerPrefix(text string) (ledgerName, remainder string) {
	t := strings.TrimSpace(text)
	if !strings.HasPrefix(t, "@") {
		return "", text
	}
	rest := t[1:]
	idx := strings.IndexAny(rest, " \t\n")
	if idx < 0 {
		// only the prefix, no payload
		return strings.TrimSpace(rest), ""
	}
	return strings.TrimSpace(rest[:idx]), strings.TrimSpace(rest[idx:])
}

// handleLedger implements /ledger [name|清除|clear]. With no arg it prints
// the current default; with "clear"/"清除" it nils the binding default.
func (t *TelegramAdapter) handleLedger(msg *tgbotapi.Message) {
	var conn models.UserConnection
	if err := t.db.Where("platform = ? AND external_id = ?", "telegram", strconv.FormatInt(msg.Chat.ID, 10)).First(&conn).Error; err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。")
		return
	}
	preferEn := t.userPreferEn(conn.UserID)

	arg := strings.TrimSpace(msg.CommandArguments())
	if arg == "" {
		if conn.DefaultLedgerID == nil {
			if preferEn {
				t.sendReply(msg.Chat.ID, "No default ledger set. Usage: /ledger <name>")
			} else {
				t.sendReply(msg.Chat.ID, "未设置默认账本。用法：/ledger <账本名称>")
			}
			return
		}
		var l models.Ledger
		if err := t.db.First(&l, "id = ?", *conn.DefaultLedgerID).Error; err != nil {
			t.sendReply(msg.Chat.ID, "默认账本不存在或已删除。")
			return
		}
		if preferEn {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("Current default ledger: %s", l.Name))
		} else {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("当前默认账本：%s", l.Name))
		}
		return
	}

	if arg == "清除" || strings.EqualFold(arg, "clear") || strings.EqualFold(arg, "reset") {
		conn.DefaultLedgerID = nil
		if err := t.db.Save(&conn).Error; err != nil {
			t.sendReply(msg.Chat.ID, "保存失败，请稍后再试。")
			return
		}
		if preferEn {
			t.sendReply(msg.Chat.ID, "✅ Default ledger cleared.")
		} else {
			t.sendReply(msg.Chat.ID, "✅ 已清除默认账本。")
		}
		return
	}

	l, ok := t.resolveLedgerByName(conn.UserID, arg)
	if !ok {
		if preferEn {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("No unique ledger matches %q. Try a more specific name.", arg))
		} else {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("没找到唯一匹配 %q 的账本，换个更具体的名字试试。", arg))
		}
		return
	}
	conn.DefaultLedgerID = &l.ID
	if err := t.db.Save(&conn).Error; err != nil {
		t.sendReply(msg.Chat.ID, "保存失败，请稍后再试。")
		return
	}
	if preferEn {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("✅ Default ledger set to %s", l.Name))
	} else {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("✅ 已将默认账本设为 %s", l.Name))
	}
}
