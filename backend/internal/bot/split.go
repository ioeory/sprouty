package bot

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"

	"sprouts-self/backend/internal/api"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
)

const splitUsageZh = "用法：/split <总金额> <分类> [备注] @<子账本>[=金额] @<子账本>[=金额] …\n" +
	"未指定金额时自动均分，例：/split 100 餐饮 @小A @小B"
const splitUsageEn = "Usage: /split <total> <category> [note] @<sub>[=amt] @<sub>[=amt] …\n" +
	"Missing amounts split equally, e.g. /split 100 lunch @AlA @Bob"

// handleSplit implements /split — convert a single command into a SplitGroup
// across the linked personal sub-ledgers of a family ledger.
//
// Grammar (whitespace-tokenized, leading `/split` already stripped):
//
//	<amount>                  required, first numeric token
//	[free-text words]         category hint + optional note (parenthetical
//	                          chunks are treated as note, just like the plain
//	                          message parser)
//	@<name>[=<amount>] …      one or more allocation tokens; missing amount
//	                          ⇒ equal split of the unallocated remainder
func (t *TelegramAdapter) handleSplit(msg *tgbotapi.Message) {
	var conn models.UserConnection
	if err := t.db.Where("platform = ? AND external_id = ?", "telegram", strconv.FormatInt(msg.Chat.ID, 10)).First(&conn).Error; err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。")
		return
	}
	preferEn := t.userPreferEn(conn.UserID)

	args := strings.TrimSpace(msg.CommandArguments())
	if args == "" {
		if preferEn {
			t.sendReply(msg.Chat.ID, splitUsageEn)
		} else {
			t.sendReply(msg.Chat.ID, splitUsageZh)
		}
		return
	}

	// Resolve source ledger first (binding default → first owned). Source
	// ledger must be a family ledger with at least 2 linked personal sub-
	// ledgers; otherwise /split makes no sense.
	var sourceID uuid.UUID
	if conn.DefaultLedgerID != nil {
		sourceID = *conn.DefaultLedgerID
	} else {
		var lu models.LedgerUser
		if err := t.db.Where("user_id = ?", conn.UserID).First(&lu).Error; err != nil {
			t.sendReply(msg.Chat.ID, "未找到账本，请先在 Web 端创建一个账本。")
			return
		}
		sourceID = lu.LedgerID
	}
	var src models.Ledger
	if err := t.db.First(&src, "id = ?", sourceID).Error; err != nil {
		t.sendReply(msg.Chat.ID, "源账本不存在。")
		return
	}
	if src.Type != "family" {
		if preferEn {
			t.sendReply(msg.Chat.ID, "/split requires a family ledger as source. Use /ledger <name> to switch.")
		} else {
			t.sendReply(msg.Chat.ID, "/split 仅支持家庭账本作为源账本。请先用 /ledger <账本名> 切换。")
		}
		return
	}
	if !service.UserCanWriteLedger(t.db, conn.UserID, sourceID) {
		t.sendReply(msg.Chat.ID, "只读成员：无法在此账本记账。")
		return
	}

	// Load linked personal sub-ledgers for the source family.
	var links []models.LedgerFamilyLink
	if err := t.db.Where("family_ledger_id = ?", sourceID).Find(&links).Error; err != nil || len(links) == 0 {
		if preferEn {
			t.sendReply(msg.Chat.ID, "Family ledger has no linked personal sub-ledgers; nothing to split into.")
		} else {
			t.sendReply(msg.Chat.ID, "该家庭账本没有关联的子账本，无法分账。")
		}
		return
	}
	subIDs := make([]uuid.UUID, 0, len(links))
	for _, ln := range links {
		subIDs = append(subIDs, ln.PersonalLedgerID)
	}
	var subs []models.Ledger
	if err := t.db.Where("id IN ?", subIDs).Find(&subs).Error; err != nil {
		t.sendReply(msg.Chat.ID, "读取子账本失败。")
		return
	}
	subByName := make(map[string]models.Ledger, len(subs))
	for _, s := range subs {
		subByName[strings.ToLower(s.Name)] = s
	}

	// --- Tokenize args ---
	// Pull out parenthetical notes first so the @-token scanner doesn't trip
	// over spaces inside (...) groups.
	noteParts, stripped := extractParenNotes(args)
	tokens := strings.Fields(stripped)

	type allocSpec struct {
		name   string
		amount float64
		hasAmt bool
	}
	var (
		total     float64
		haveTotal bool
		hintWords []string
		allocs    []allocSpec
	)
	for _, tok := range tokens {
		if strings.HasPrefix(tok, "@") {
			rest := strings.TrimSpace(tok[1:])
			if rest == "" {
				continue
			}
			name := rest
			var amt float64
			has := false
			if eq := strings.IndexAny(rest, "=＝"); eq >= 0 {
				name = strings.TrimSpace(rest[:eq])
				amtStr := strings.TrimSpace(rest[eq+1:])
				if v, err := strconv.ParseFloat(amtStr, 64); err == nil && v > 0 {
					amt = v
					has = true
				} else {
					t.sendReply(msg.Chat.ID, fmt.Sprintf("金额格式无效：%s", tok))
					return
				}
			}
			if name == "" {
				continue
			}
			allocs = append(allocs, allocSpec{name: name, amount: amt, hasAmt: has})
			continue
		}
		if !haveTotal {
			if v, err := strconv.ParseFloat(strings.TrimRight(tok, "元¥￥"), 64); err == nil && v > 0 {
				total = v
				haveTotal = true
				continue
			}
		}
		hintWords = append(hintWords, tok)
	}

	if !haveTotal {
		if preferEn {
			t.sendReply(msg.Chat.ID, "Missing total amount. "+splitUsageEn)
		} else {
			t.sendReply(msg.Chat.ID, "缺少总金额。"+splitUsageZh)
		}
		return
	}
	if len(allocs) < 1 {
		if preferEn {
			t.sendReply(msg.Chat.ID, "Need at least one @sub-ledger. "+splitUsageEn)
		} else {
			t.sendReply(msg.Chat.ID, "至少需要 1 个 @子账本。"+splitUsageZh)
		}
		return
	}

	// --- Resolve allocation names against sub-ledgers (case-insensitive,
	// then prefix). Reject duplicates and unknown names.
	seen := make(map[uuid.UUID]struct{}, len(allocs))
	resolved := make([]struct {
		ledger models.Ledger
		amount float64
		hasAmt bool
	}, 0, len(allocs))
	for _, a := range allocs {
		key := strings.ToLower(a.name)
		l, ok := subByName[key]
		if !ok {
			// fallback: prefix match
			matches := []models.Ledger{}
			for k, v := range subByName {
				if strings.HasPrefix(k, key) {
					matches = append(matches, v)
				}
			}
			if len(matches) == 1 {
				l = matches[0]
				ok = true
			}
		}
		if !ok {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("子账本 %q 找不到或不唯一，可用：%s", a.name, joinLedgerNames(subs)))
			return
		}
		if _, dup := seen[l.ID]; dup {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("重复的子账本：%s", l.Name))
			return
		}
		seen[l.ID] = struct{}{}
		resolved = append(resolved, struct {
			ledger models.Ledger
			amount float64
			hasAmt bool
		}{l, a.amount, a.hasAmt})
	}

	// --- Compute amounts: explicit values stay; remaining cents distributed
	// equally across the un-amount'd allocations (remainder to first).
	totalCents := int64(math.Round(total * 100))
	usedCents := int64(0)
	missing := 0
	for _, r := range resolved {
		if r.hasAmt {
			usedCents += int64(math.Round(r.amount * 100))
		} else {
			missing++
		}
	}
	if usedCents > totalCents {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("已分配 ¥%.2f 超过总金额 ¥%.2f", float64(usedCents)/100, total))
		return
	}
	if missing == 0 && usedCents != totalCents {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("总金额不一致：¥%.2f vs 各项之和 ¥%.2f", total, float64(usedCents)/100))
		return
	}
	if missing > 0 {
		remCents := totalCents - usedCents
		if remCents <= 0 {
			t.sendReply(msg.Chat.ID, "无剩余金额可分配给未指定金额的子账本。")
			return
		}
		base := remCents / int64(missing)
		extra := remCents - base*int64(missing) // first `extra` allocations get +1 cent
		for i := range resolved {
			if !resolved[i].hasAmt {
				cents := base
				if extra > 0 {
					cents++
					extra--
				}
				resolved[i].amount = float64(cents) / 100
				resolved[i].hasAmt = true
			}
		}
	}

	// --- Resolve category against the SOURCE family ledger (RunSplit will
	// auto-map it to each target sub-ledger by name).
	hint := strings.TrimSpace(strings.Join(hintWords, " "))
	if hint == "" {
		t.sendReply(msg.Chat.ID, "需要分类关键字（紧跟在金额后面）。")
		return
	}
	cat, matched := t.resolveCategory(sourceID, hint, "expense", preferEn)
	if !matched {
		t.sendReply(msg.Chat.ID, t.noCategoryReply(sourceID, hint, preferEn))
		return
	}

	note := strings.TrimSpace(strings.Join(noteParts, " "))

	allocations := make([]api.SplitAllocationInput, 0, len(resolved))
	for _, r := range resolved {
		allocations = append(allocations, api.SplitAllocationInput{
			TargetLedgerID: r.ledger.ID,
			Amount:         r.amount,
		})
	}
	group, children, err := api.RunSplit(t.db, api.SplitInput{
		SourceLedgerID: sourceID,
		UserID:         conn.UserID,
		Type:           "expense",
		CategoryID:     cat.ID,
		Note:           note,
		Date:           time.Now(),
		Allocations:    allocations,
	})
	if err != nil {
		if api.IsSplitBadRequest(err) {
			t.sendReply(msg.Chat.ID, "分账失败："+err.Error())
		} else {
			t.sendReply(msg.Chat.ID, "分账失败，请稍后再试。")
		}
		return
	}

	// --- Reply summary
	loc := "zh"
	if preferEn {
		loc = "en"
	}
	catLabel := service.PickCategoryDisplayName(loc, cat.NameZh, cat.NameEn)
	header := fmt.Sprintf("✅ 分账已创建：¥%.2f · %s · 共 %d 笔", group.TotalAmount, catLabel, len(children))
	if preferEn {
		header = fmt.Sprintf("✅ Split created: ¥%.2f · %s · %d children", group.TotalAmount, catLabel, len(children))
	}
	lines := []string{header, "源账本：" + src.Name}
	for _, r := range resolved {
		lines = append(lines, fmt.Sprintf("  • %s ¥%.2f", r.ledger.Name, r.amount))
	}
	if note != "" {
		lines = append(lines, "备注："+note)
	}
	t.sendReply(msg.Chat.ID, strings.Join(lines, "\n"))
}

// extractParenNotes pulls every `(...)` and `（...）` span out of `text` and
// returns the inner contents plus the original text minus those spans.
// Mirrors the parenRe behaviour used in ParseMessage so /split feels
// consistent with plain-message recording.
func extractParenNotes(text string) (notes []string, stripped string) {
	out := text
	for {
		start := strings.IndexAny(out, "(（")
		if start < 0 {
			break
		}
		// find matching close character (we don't try to balance nested groups)
		end := strings.IndexAny(out[start+1:], ")）")
		if end < 0 {
			break
		}
		end += start + 1
		notes = append(notes, strings.TrimSpace(out[start+1:end]))
		out = strings.TrimSpace(out[:start] + " " + out[end+1:])
	}
	return notes, out
}

func joinLedgerNames(ls []models.Ledger) string {
	names := make([]string, 0, len(ls))
	for _, l := range ls {
		names = append(names, l.Name)
	}
	return strings.Join(names, ", ")
}
