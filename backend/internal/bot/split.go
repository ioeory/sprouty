package bot

import (
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"

	"sprouts-self/backend/internal/api"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
)

const (
	splitUsageZh = "用法：/split <总金额> <分类关键字> [备注] [<金额>@<子账本>(备注)] …\n" +
		"未指定分账时自动平均分到所有子账本，例：\n" +
		"  /split 100 水果 TEST                       → 各子账本平均分摊\n" +
		"  /split 100 水果 TEST 40@A1(给A1) 60@A2(给A2)\n" +
		"也可写成 “分账 100 …”（无需斜杠）。"
	splitUsageEn = "Usage: /split <total> <category> [note] [<amount>@<sub>(note)] …\n" +
		"Without allocations, splits equally across every linked sub-ledger.\n" +
		"You can also type: split 100 fruit TEST"
)

// allocToken matches the new allocation grammar:
//
//	[amount]?@?<name>[=amount]?[(note)]?
//
// Group 1: leading amount (optional)
// Group 2: name
// Group 3: trailing =amount (optional, legacy)
// Group 4: per-allocation note (optional, ASCII or full-width parens)
var allocTokenRe = regexp.MustCompile(`^(\d+(?:\.\d+)?)?@?([^\s()（）=＝]+?)(?:[=＝](\d+(?:\.\d+)?))?(?:[（(]([^)）]*)[)）])?$`)

// splitTriggerRe matches a leading `分账` or `split` keyword on a plain
// message, optionally followed by ASCII / full-width whitespace (or no
// space at all). The remainder of the text becomes the /split argument
// payload.
var splitTriggerRe = regexp.MustCompile(`^(?i:split|分账)[\s　]*`)

// matchSplitTrigger returns the args portion if `text` is a plain-message
// /split invocation, plus a flag indicating a match.
func matchSplitTrigger(text string) (args string, ok bool) {
	loc := splitTriggerRe.FindStringIndex(text)
	if loc == nil {
		return "", false
	}
	return strings.TrimSpace(text[loc[1]:]), true
}

// handleSplit implements the /split command. It is a thin shell around
// runSplit so the same logic can be reused by the plain-message trigger.
func (t *TelegramAdapter) handleSplit(msg *tgbotapi.Message) {
	conn, ok := t.requireBinding(msg)
	if !ok {
		return
	}
	preferEn := t.userPreferEn(conn.UserID)
	args := strings.TrimSpace(msg.CommandArguments())
	t.sendReply(msg.Chat.ID, t.runSplit(conn, args, preferEn, ""))
}

// requireBinding returns the chat's binding row, replying with the standard
// "not bound" message and false when missing. Centralised so the split path
// and any future commands can reuse it.
func (t *TelegramAdapter) requireBinding(msg *tgbotapi.Message) (models.UserConnection, bool) {
	var conn models.UserConnection
	if err := t.db.Where("platform = ? AND external_id = ?", "telegram", strconv.FormatInt(msg.Chat.ID, 10)).First(&conn).Error; err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。")
		return conn, false
	}
	return conn, true
}

// runSplit performs validation, parsing, allocation, and DB writes for a
// single /split invocation. It returns the user-facing reply text.
//
// ledgerOverrideName, when non-empty, comes from a leading `@账本名` prefix
// stripped earlier in the plain-message pipeline. In that case it MUST
// resolve to a writable family ledger; otherwise we surface an error.
func (t *TelegramAdapter) runSplit(conn models.UserConnection, args string, preferEn bool, ledgerOverrideName string) string {
	if args == "" {
		if preferEn {
			return splitUsageEn
		}
		return splitUsageZh
	}

	// --- Resolve source family ledger (Phase 1) ---
	src, autoFromPersonal, err := t.resolveSplitSource(conn, ledgerOverrideName, preferEn)
	if err != nil {
		return err.Error()
	}

	// --- Load the family's linked sub-ledgers ---
	var links []models.LedgerFamilyLink
	if err := t.db.Where("family_ledger_id = ?", src.ID).Find(&links).Error; err != nil || len(links) == 0 {
		if preferEn {
			return "Family ledger has no linked personal sub-ledgers; nothing to split into."
		}
		return "该家庭账本没有关联的子账本，无法分账。"
	}
	subIDs := make([]uuid.UUID, 0, len(links))
	for _, ln := range links {
		subIDs = append(subIDs, ln.PersonalLedgerID)
	}
	var subs []models.Ledger
	if err := t.db.Where("id IN ?", subIDs).Find(&subs).Error; err != nil || len(subs) == 0 {
		return "读取子账本失败。"
	}
	subByName := make(map[string]models.Ledger, len(subs))
	for _, s := range subs {
		subByName[strings.ToLower(s.Name)] = s
	}

	// --- Parse tokens (Phase 2) ---
	parsed, perr := parseSplitArgs(args, subByName)
	if perr != "" {
		return perr
	}
	if !parsed.haveTotal {
		if preferEn {
			return "Missing total amount.\n" + splitUsageEn
		}
		return "缺少总金额。\n" + splitUsageZh
	}

	// --- Phase 3: equal-across-all-subs default ---
	if len(parsed.allocs) == 0 {
		for _, s := range subs {
			parsed.allocs = append(parsed.allocs, splitAllocSpec{ledger: s})
		}
	}

	// --- Cents-precise distribution ---
	totalCents := int64(math.Round(parsed.total * 100))
	usedCents := int64(0)
	missing := 0
	for _, a := range parsed.allocs {
		if a.hasAmt {
			usedCents += int64(math.Round(a.amount * 100))
		} else {
			missing++
		}
	}
	if usedCents > totalCents {
		return fmt.Sprintf("已分配 ¥%.2f 超过总金额 ¥%.2f", float64(usedCents)/100, parsed.total)
	}
	if missing == 0 && usedCents != totalCents {
		return fmt.Sprintf("总金额不一致：¥%.2f vs 各项之和 ¥%.2f", parsed.total, float64(usedCents)/100)
	}
	if missing > 0 {
		remCents := totalCents - usedCents
		if remCents <= 0 {
			return "无剩余金额可分配给未指定金额的子账本。"
		}
		base := remCents / int64(missing)
		extra := remCents - base*int64(missing) // first `extra` allocations get +1 cent
		for i := range parsed.allocs {
			if !parsed.allocs[i].hasAmt {
				cents := base
				if extra > 0 {
					cents++
					extra--
				}
				parsed.allocs[i].amount = float64(cents) / 100
				parsed.allocs[i].hasAmt = true
			}
		}
	}

	// --- Resolve category via the regular keyword pipeline (Phase 2 step 3) ---
	// Build a synthetic plain-message string so ParseMessage handles
	// multi-word keywords / parens / l:tags exactly like a normal record.
	// We append the total at the end so ParseMessage finds an amount.
	freeText := strings.TrimSpace(parsed.freeText)
	if freeText == "" {
		if preferEn {
			return "Need a category keyword (after the total)."
		}
		return "需要分类关键字（紧跟在金额后面）。"
	}
	synthetic := freeText + " " + strconv.FormatFloat(parsed.total, 'f', -1, 64)
	// Filter the keyword map to only keywords belonging to the family or
	// its linked subs, so a user's other ledgers can't accidentally route
	// the category lookup. It's a soft hint anyway — resolveCategory still
	// uses sourceID below — but this keeps the parser's own LedgerHint sane.
	allowedLedgers := map[string]struct{}{src.ID.String(): {}}
	for _, s := range subs {
		allowedLedgers[s.ID.String()] = struct{}{}
	}
	rawKW := t.loadLedgerKeywordMap(conn.UserID)
	scopedKW := make(map[string]string, len(rawKW))
	for k, v := range rawKW {
		if _, ok := allowedLedgers[v]; ok {
			scopedKW[k] = v
		}
	}
	pr := ParseMessage(synthetic, time.Now(), scopedKW)
	categoryHint := strings.TrimSpace(pr.CategoryHint)
	if categoryHint == "" {
		categoryHint = freeText
	}
	cat, matched := t.resolveCategory(src.ID, categoryHint, "expense", preferEn)
	groupNote := ""
	if !matched {
		fallback, ok := t.fallbackCategory(src.ID, "expense")
		if !ok {
			return t.noCategoryReply(src.ID, categoryHint, preferEn)
		}
		cat = fallback
		groupNote = strings.TrimSpace(freeText)
	} else {
		groupNote = t.noteWithoutMatchedCategory(src.ID, cat, pr.Note, categoryHint)
	}

	// --- Build allocations for api.RunSplit (Phase 4: per-child note) ---
	allocations := make([]api.SplitAllocationInput, 0, len(parsed.allocs))
	for _, a := range parsed.allocs {
		allocations = append(allocations, api.SplitAllocationInput{
			TargetLedgerID: a.ledger.ID,
			Amount:         a.amount,
			Note:           a.note,
		})
	}
	group, children, err := api.RunSplit(t.db, api.SplitInput{
		SourceLedgerID: src.ID,
		UserID:         conn.UserID,
		Type:           "expense",
		CategoryID:     cat.ID,
		Note:           groupNote,
		Date:           time.Now(),
		Allocations:    allocations,
	})
	if err != nil {
		if api.IsSplitBadRequest(err) {
			return "分账失败：" + err.Error()
		}
		return "分账失败，请稍后再试。"
	}

	attachedNames := t.attachSplitTags(children, pr.TagHints)

	// --- Reply summary ---
	loc := "zh"
	if preferEn {
		loc = "en"
	}
	catLabel := service.PickCategoryDisplayName(loc, cat.NameZh, cat.NameEn)
	header := fmt.Sprintf("✅ 分账已创建：¥%.2f · %s · 共 %d 笔", group.TotalAmount, catLabel, len(children))
	if preferEn {
		header = fmt.Sprintf("✅ Split created: ¥%.2f · %s · %d children", group.TotalAmount, catLabel, len(children))
	}
	lines := []string{header}
	if preferEn {
		lines = append(lines, "Source: "+src.Name)
	} else {
		lines = append(lines, "源账本："+src.Name)
	}
	for _, a := range parsed.allocs {
		row := fmt.Sprintf("  • %s ¥%.2f", a.ledger.Name, a.amount)
		if a.note != "" {
			row += fmt.Sprintf("（%s）", a.note)
		}
		lines = append(lines, row)
	}
	if groupNote != "" {
		if preferEn {
			lines = append(lines, "Note: "+groupNote)
		} else {
			lines = append(lines, "备注："+groupNote)
		}
	}
	if len(attachedNames) > 0 {
		if preferEn {
			lines = append(lines, "Tags: "+strings.Join(attachedNames, ", "))
		} else {
			lines = append(lines, "标签："+strings.Join(attachedNames, "、"))
		}
	}
	if autoFromPersonal != "" {
		if preferEn {
			lines = append(lines, fmt.Sprintf("(default ledger %s auto-routed to family %s)", autoFromPersonal, src.Name))
		} else {
			lines = append(lines, fmt.Sprintf("（默认账本是 %s，已自动切换到家庭账本 %s）", autoFromPersonal, src.Name))
		}
	}
	return strings.Join(lines, "\n")
}

func (t *TelegramAdapter) fallbackCategory(ledgerID uuid.UUID, txType string) (models.Category, bool) {
	var cat models.Category
	if err := t.db.Where("ledger_id = ? AND type = ?", ledgerID, txType).
		Order("is_system DESC, sort_order ASC, created_at ASC").
		First(&cat).Error; err != nil {
		return models.Category{}, false
	}
	return cat, true
}

func (t *TelegramAdapter) noteWithoutMatchedCategory(ledgerID uuid.UUID, cat models.Category, note string, hint string) string {
	note = strings.TrimSpace(note)
	hint = strings.TrimSpace(hint)
	if note == "" || note != hint {
		return note
	}
	candidates := []string{cat.NameZh, cat.NameEn}
	var kws []models.CategoryKeyword
	t.db.Where("ledger_id = ? AND category_id = ?", ledgerID, cat.ID).Find(&kws)
	for _, kw := range kws {
		candidates = append(candidates, kw.KeywordZh, kw.KeywordEn)
	}
	best := ""
	lowerHint := strings.ToLower(hint)
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if strings.Contains(lowerHint, strings.ToLower(c)) && len([]rune(c)) > len([]rune(best)) {
			best = c
		}
	}
	if best == "" {
		return note
	}
	return strings.TrimSpace(strings.Join(strings.Fields(removeFirstInsensitive(hint, best)), " "))
}

func removeFirstInsensitive(s string, needle string) string {
	lower := strings.ToLower(s)
	n := strings.ToLower(needle)
	idx := strings.Index(lower, n)
	if idx < 0 {
		return s
	}
	return s[:idx] + " " + s[idx+len(needle):]
}

func (t *TelegramAdapter) attachSplitTags(children []models.Transaction, tagHints []string) []string {
	if len(children) == 0 || len(tagHints) == 0 {
		return nil
	}
	seenNames := map[string]struct{}{}
	attachedNames := []string{}
	for _, child := range children {
		ids := make([]uuid.UUID, 0, len(tagHints))
		for _, name := range tagHints {
			tag, _, err := api.EnsureTag(child.LedgerID, name)
			if err != nil {
				log.Printf("bot split: ensure tag %q on ledger %s failed: %v", name, child.LedgerID, err)
				continue
			}
			ids = append(ids, tag.ID)
			key := strings.ToLower(strings.TrimSpace(tag.Name))
			if key != "" {
				if _, ok := seenNames[key]; !ok {
					seenNames[key] = struct{}{}
					attachedNames = append(attachedNames, tag.Name)
				}
			}
		}
		if len(ids) > 0 {
			if err := api.ReplaceTransactionTags(t.db, child.ID, child.LedgerID, ids); err != nil {
				log.Printf("bot split: replace tags on transaction %s failed: %v", child.ID, err)
			}
		}
	}
	sort.Strings(attachedNames)
	return attachedNames
}

// resolveSplitSource implements the precedence chain described in plan3.md
// Phase 1. It returns the chosen family ledger and, when the source was
// auto-promoted from a personal default ledger, the personal ledger's name
// (for the user-facing hint). The returned error is already user-facing.
func (t *TelegramAdapter) resolveSplitSource(conn models.UserConnection, override string, preferEn bool) (models.Ledger, string, error) {
	// Override path (`@账本名 分账 …`)
	if override != "" {
		l, ok := t.resolveLedgerByName(conn.UserID, override)
		if !ok {
			return models.Ledger{}, "", fmt.Errorf("找不到名为 %q 的账本，已忽略 @ 前缀。", override)
		}
		if l.Type != "family" {
			return models.Ledger{}, "", fmt.Errorf("/split 只能在家庭账本中执行，%q 不是家庭账本。", l.Name)
		}
		if !service.UserCanWriteLedger(t.db, conn.UserID, l.ID) {
			return models.Ledger{}, "", fmt.Errorf("没有写入 %q 的权限。", l.Name)
		}
		return l, "", nil
	}

	// Default-ledger path
	if conn.DefaultLedgerID != nil {
		var def models.Ledger
		if err := t.db.First(&def, "id = ?", *conn.DefaultLedgerID).Error; err == nil {
			if def.Type == "family" && service.UserCanWriteLedger(t.db, conn.UserID, def.ID) {
				return def, "", nil
			}
			if def.Type == "personal" {
				// Find any writable family that links this personal sub.
				var lk models.LedgerFamilyLink
				if err := t.db.Where("personal_ledger_id = ?", def.ID).First(&lk).Error; err == nil {
					var fam models.Ledger
					if err := t.db.First(&fam, "id = ?", lk.FamilyLedgerID).Error; err == nil && service.UserCanWriteLedger(t.db, conn.UserID, fam.ID) {
						return fam, def.Name, nil
					}
				}
			}
		}
	}

	// Single-writable-family fallback
	var lus []models.LedgerUser
	t.db.Where("user_id = ?", conn.UserID).Find(&lus)
	if len(lus) == 0 {
		return models.Ledger{}, "", fmt.Errorf("未找到账本，请先在 Web 端创建一个账本。")
	}
	ids := make([]uuid.UUID, 0, len(lus))
	for _, lu := range lus {
		ids = append(ids, lu.LedgerID)
	}
	var families []models.Ledger
	t.db.Where("id IN ? AND type = ?", ids, "family").Find(&families)
	writable := families[:0]
	for _, f := range families {
		if service.UserCanWriteLedger(t.db, conn.UserID, f.ID) {
			writable = append(writable, f)
		}
	}
	switch len(writable) {
	case 0:
		if preferEn {
			return models.Ledger{}, "", fmt.Errorf("No writable family ledger found. Create one in the web app first.")
		}
		return models.Ledger{}, "", fmt.Errorf("未找到可写的家庭账本，请先在 Web 端创建并关联子账本。")
	case 1:
		return writable[0], "", nil
	default:
		names := make([]string, 0, len(writable))
		for _, f := range writable {
			names = append(names, f.Name)
		}
		sort.Strings(names)
		if preferEn {
			return models.Ledger{}, "", fmt.Errorf("Multiple family ledgers found: %s. Use /ledger <name> to pick one.", strings.Join(names, ", "))
		}
		return models.Ledger{}, "", fmt.Errorf("找到多个家庭账本：%s；请先用 /ledger <名称> 选定。", strings.Join(names, "、"))
	}
}

// splitAllocSpec is one resolved allocation slot.
type splitAllocSpec struct {
	ledger models.Ledger
	amount float64
	hasAmt bool
	note   string
}

// splitParseResult is the structured output of parseSplitArgs.
type splitParseResult struct {
	total     float64
	haveTotal bool
	allocs    []splitAllocSpec
	freeText  string
}

// parseSplitArgs walks the whitespace-separated tokens of `args`, classifying
// each into the total, an allocation, or free text. See plan3.md Phase 2.
//
// `subByName` is keyed by lowercase sub-ledger name and is used to resolve
// allocation tokens. Returns an empty error string on success or a
// user-facing message on hard failure (duplicate target, unknown @-prefix,
// invalid amount, etc.).
func parseSplitArgs(args string, subByName map[string]models.Ledger) (splitParseResult, string) {
	out := splitParseResult{}
	tokens := strings.Fields(args)
	seen := map[uuid.UUID]struct{}{}
	freeWords := make([]string, 0, len(tokens))

	for _, tok := range tokens {
		hasAt := strings.HasPrefix(tok, "@")
		body := tok
		if hasAt {
			body = tok[1:]
		}

		// Try total first when no `@` and no leading numeric+name combo.
		if !out.haveTotal && !hasAt && isPlainAmount(tok) {
			if v, err := strconv.ParseFloat(strings.TrimRight(strings.TrimRight(tok, "元"), "¥￥"), 64); err == nil && v > 0 {
				out.total = v
				out.haveTotal = true
				continue
			}
		}

		m := allocTokenRe.FindStringSubmatch(body)
		if m != nil {
			leadAmt := m[1]
			name := strings.TrimSpace(m[2])
			tailAmt := m[3]
			note := strings.TrimSpace(m[4])

			lookup, known := subByName[strings.ToLower(name)]
			if !known {
				// fallback to prefix match
				matches := []models.Ledger{}
				for k, v := range subByName {
					if strings.HasPrefix(k, strings.ToLower(name)) {
						matches = append(matches, v)
					}
				}
				if len(matches) == 1 {
					lookup = matches[0]
					known = true
				}
			}

			if hasAt {
				// `@name` is always an allocation; unknown name is an error.
				if !known {
					return out, fmt.Sprintf("子账本 %q 找不到或不唯一，可用：%s", name, joinLedgerNames(subsValues(subByName)))
				}
			} else if !known {
				// Bare token that doesn't resolve → free text.
				freeWords = append(freeWords, tok)
				continue
			}

			if _, dup := seen[lookup.ID]; dup {
				return out, fmt.Sprintf("重复的子账本：%s", lookup.Name)
			}
			seen[lookup.ID] = struct{}{}

			spec := splitAllocSpec{ledger: lookup, note: note}
			amtStr := leadAmt
			if amtStr == "" {
				amtStr = tailAmt
			}
			if amtStr != "" {
				v, err := strconv.ParseFloat(amtStr, 64)
				if err != nil || v <= 0 {
					return out, fmt.Sprintf("金额格式无效：%s", tok)
				}
				spec.amount = v
				spec.hasAmt = true
			}
			out.allocs = append(out.allocs, spec)
			continue
		}

		freeWords = append(freeWords, tok)
	}

	out.freeText = strings.Join(freeWords, " ")
	return out, ""
}

// isPlainAmount returns true if tok looks like a bare number (optionally
// suffixed with currency markers) and contains no `@`/`=` separators.
func isPlainAmount(tok string) bool {
	if tok == "" {
		return false
	}
	if strings.ContainsAny(tok, "@=＝") {
		return false
	}
	stripped := strings.TrimRight(strings.TrimRight(tok, "元"), "¥￥")
	if stripped == "" {
		return false
	}
	for _, r := range stripped {
		if (r < '0' || r > '9') && r != '.' {
			return false
		}
	}
	return true
}

func subsValues(m map[string]models.Ledger) []models.Ledger {
	out := make([]models.Ledger, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

func joinLedgerNames(ls []models.Ledger) string {
	names := make([]string, 0, len(ls))
	for _, l := range ls {
		names = append(names, l.Name)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}
