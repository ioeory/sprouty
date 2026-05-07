package bot

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sprouts-self/backend/internal/api"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
)

type TelegramAdapter struct {
	db     *gorm.DB
	bot    *tgbotapi.BotAPI
	stopCh chan struct{}
}

func NewTelegramAdapter(db *gorm.DB) (*TelegramAdapter, error) {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	if token == "" {
		return nil, fmt.Errorf("TELEGRAM_BOT_TOKEN not set")
	}

	// NOTE: Client.Timeout must be larger than the long-poll timeout used in
	// GetUpdates (u.Timeout = 60s below). Otherwise every long-poll call is
	// cancelled before Telegram has a chance to respond, producing the loop
	// "context deadline exceeded / retrying in 3 seconds".
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		MaxIdleConns:          10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	proxyURL := os.Getenv("BOT_PROXY")
	if proxyURL != "" {
		u, err := url.Parse(proxyURL)
		if err != nil {
			return nil, fmt.Errorf("invalid BOT_PROXY URL: %v", err)
		}
		transport.Proxy = http.ProxyURL(u)
		log.Printf("Using proxy for Telegram Bot: %s", proxyURL)
	}

	httpClient := &http.Client{
		Timeout:   90 * time.Second, // > long-poll timeout (60s)
		Transport: transport,
	}

	bot, err := tgbotapi.NewBotAPIWithClient(token, tgbotapi.APIEndpoint, httpClient)
	if err != nil {
		return nil, err
	}

	return &TelegramAdapter{
		db:     db,
		bot:    bot,
		stopCh: make(chan struct{}),
	}, nil
}

func (t *TelegramAdapter) Start() {
	log.Printf("Authorized on account %s", t.bot.Self.UserName)

	u := tgbotapi.NewUpdate(0)
	u.Timeout = 60

	updates := t.bot.GetUpdatesChan(u)

	for {
		select {
		case <-t.stopCh:
			return
		case update := <-updates:
			if update.Message == nil {
				continue
			}
			t.handleUpdate(update)
		}
	}
}

func (t *TelegramAdapter) Stop() {
	close(t.stopCh)
}

func (t *TelegramAdapter) handleUpdate(update tgbotapi.Update) {
	msg := update.Message
	if msg.IsCommand() {
		switch msg.Command() {
		case "start":
			t.handleStart(msg)
		case "bind":
			t.handleBind(msg)
		case "status":
			t.handleStatus(msg)
		case "install", "fenqi":
			t.handleInstallment(msg)
		case "budget":
			t.handleBudget(msg)
		case "today":
			t.handleToday(msg)
		case "week":
			t.handleSpentNDays(msg, 7)
		case "spent", "days":
			t.handleSpentNDays(msg, 0)
		case "detail", "recent":
			t.handleExpenseDetail(msg)
		case "ledger":
			t.handleLedger(msg)
		case "split":
			t.handleSplit(msg)
		default:
			t.sendReply(msg.Chat.ID, "未知指令。发送 /start 查看帮助。\nUnknown command. Use /start for help.")
		}
	} else if msg.Text != "" {
		t.handlePlainMessage(msg)
	}
}

func (t *TelegramAdapter) handleStart(msg *tgbotapi.Message) {
	// Deep-link payload: /start bind_123456 -> auto-bind
	payload := strings.TrimSpace(msg.CommandArguments())
	if strings.HasPrefix(payload, "bind_") {
		code := strings.TrimPrefix(payload, "bind_")
		t.bindWithCode(msg, code)
		return
	}

	helpText := "欢迎使用 Sprouty 记账机器人！\n\n" +
		"绑定账号：\n" +
		"1. 在 Web 端 → 设置 → Bot 集成 中生成 PIN\n" +
		"2. 点击「打开 Telegram」按钮即可一键绑定\n" +
		"   或手动发送 /bind 123456\n\n" +
		"绑定后直接发送消息即可记账，例如：\n" +
		"  午餐 50\n" +
		"  50 购物 新鞋\n\n" +
		"记一笔可加 `@账本名` 前缀记到指定账本。\n" +
		"  示例：@生活 午餐 50  → 记入 “生活” 账本\n\n" +
		"默认账本：\n" +
		"  /ledger <名称> —— 设为默认账本（不带参数查看当前）\n" +
		"  /ledger 清除 或 /ledger clear —— 恢复为「第一个账本」\n\n" +
		"分账（仅限家庭账本下拆到子账本）：\n" +
		"  /split <总金额> <分类关键字> [备注] [<金额>@<子账本>(备注)] …\n" +
		"  也可用 “分账 …” 直接触发（无需斜杠）。\n" +
		"  未指定分账时自动平均分到所有子账本。示例：\n" +
		"    /split 100 水果 TEST                       → 各子账本平均分摊\n" +
		"    分账 100 水果 TEST                          → 同上\n" +
		"    /split 100 水果 TEST 40@A1(给A1) 60@A2(给A2)\n" +
		"    分账 100 水果 TEST 40A1(给A1) 60@A2(给A2)\n\n" +
		"等额分期（多笔支出、同一分期组）：\n" +
		"  /install <期数> <总金额> <分类或关键字…>\n" +
		"  与发消息记账相同，可写账本关键字、`昨天`/`今天`、括号备注、`l:标签名`。\n" +
		"  示例：/install 6 1800 餐饮\n" +
		"  示例：/fenqi 12 12000 昨天 数码 (新手机) l:报销\n\n" +
		"查询（默认使用你在本群的绑定账号下第一个账本；家庭账本含子账本流水）：\n" +
		"  /budget — 本月预算剩余、日均可花、今日支出\n" +
		"  /today — 今日支出合计\n" +
		"  /week — 最近 7 天支出\n" +
		"  /days 14 — 最近 N 天支出（1–366）\n" +
		"  /spent — 同 /days，默认 7 天\n" +
		"  /detail — 最近支出明细（默认 10 条，可 /detail 20）\n\n" +
		"Installment (equal split): /install <months> <total> <category…> — alias /fenqi\n\n" +
		"Queries: /budget, /today, /week, /days N, /spent [N], /detail [N]"
	t.sendReply(msg.Chat.ID, helpText)
}

func (t *TelegramAdapter) handleBind(msg *tgbotapi.Message) {
	t.bindWithCode(msg, strings.TrimSpace(msg.CommandArguments()))
}

// bindWithCode is shared by /bind and deep-link /start bind_XXXXXX.
func (t *TelegramAdapter) bindWithCode(msg *tgbotapi.Message, code string) {
	if len(code) != 6 {
		t.sendReply(msg.Chat.ID, "PIN 格式错误，应为 6 位数字。示例：/bind 123456")
		return
	}

	var session models.BindingSession
	now := time.Now().Unix()
	if err := t.db.Where("code = ? AND expires_at > ?", code, now).First(&session).Error; err != nil {
		t.sendReply(msg.Chat.ID, "PIN 无效或已过期，请到 Web 重新生成。")
		return
	}

	externalID := strconv.FormatInt(msg.Chat.ID, 10)

	// Upsert: 同一个 Telegram chat 只会关联到最新一次绑定的账号
	var existing models.UserConnection
	err := t.db.Where("platform = ? AND external_id = ?", "telegram", externalID).First(&existing).Error
	if err == nil {
		existing.UserID = session.UserID
		existing.Username = msg.From.UserName
		if err := t.db.Save(&existing).Error; err != nil {
			t.sendReply(msg.Chat.ID, "绑定失败，请稍后重试。")
			return
		}
	} else {
		conn := models.UserConnection{
			UserID:     session.UserID,
			Platform:   "telegram",
			ExternalID: externalID,
			Username:   msg.From.UserName,
		}
		if err := t.db.Create(&conn).Error; err != nil {
			t.sendReply(msg.Chat.ID, "绑定失败，请稍后重试。")
			return
		}
	}

	t.db.Delete(&session)
	t.sendReply(msg.Chat.ID, "✅ 绑定成功！现在可以直接发送消息记账，比如：午餐 50")
}

func (t *TelegramAdapter) handleStatus(msg *tgbotapi.Message) {
	var conn models.UserConnection
	err := t.db.Where("platform = ? AND external_id = ?", "telegram", strconv.FormatInt(msg.Chat.ID, 10)).First(&conn).Error
	if err != nil {
		t.sendReply(msg.Chat.ID, "Account not linked. Use /bind to start.")
		return
	}
	t.sendReply(msg.Chat.ID, "Status: Linked ✅")
}

func (t *TelegramAdapter) bindingUserID(chatID int64) (uuid.UUID, error) {
	var conn models.UserConnection
	if err := t.db.Where("platform = ? AND external_id = ?", "telegram", strconv.FormatInt(chatID, 10)).First(&conn).Error; err != nil {
		return uuid.Nil, err
	}
	return conn.UserID, nil
}

func (t *TelegramAdapter) firstLedgerID(userID uuid.UUID) (uuid.UUID, error) {
	var lu models.LedgerUser
	if err := t.db.Where("user_id = ?", userID).First(&lu).Error; err != nil {
		return uuid.Nil, err
	}
	return lu.LedgerID, nil
}

func (t *TelegramAdapter) userPreferEn(userID uuid.UUID) bool {
	var acct models.User
	if err := t.db.Select("preferred_locale").First(&acct, "id = ?", userID).Error; err != nil {
		return false
	}
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(acct.PreferredLocale)), "en")
}

func (t *TelegramAdapter) handleBudget(msg *tgbotapi.Message) {
	userID, err := t.bindingUserID(msg.Chat.ID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。")
		return
	}
	lid, err := t.firstLedgerID(userID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "未找到账本。")
		return
	}
	if !service.UserHasLedgerAccess(t.db, userID, lid) {
		t.sendReply(msg.Chat.ID, "无账本访问权限。")
		return
	}
	loc := service.UserDigestTimezone(t.db, userID)
	m, err := service.ComputeDigestMetrics(t.db, userID, lid, time.Now(), loc)
	if err != nil {
		log.Printf("handleBudget: %v", err)
		t.sendReply(msg.Chat.ID, "无法读取数据，请稍后再试。")
		return
	}
	en := t.userPreferEn(userID)
	if en {
		t.sendReply(msg.Chat.ID, fmt.Sprintf(
			"📗 %s\nMonthly budget: ¥%.2f\nSpent (month): ¥%.2f\nRemaining: ¥%.2f\nDaily allowance (%d d left): ¥%.2f\nToday's expenses: ¥%.2f",
			m.LedgerName, m.TotalBudget, m.MonthExpense, m.Remaining, m.DaysLeft, m.DailyAllowance, m.TodayExpense,
		))
		return
	}
	t.sendReply(msg.Chat.ID, fmt.Sprintf(
		"📗 %s\n本月预算：¥%.2f\n本月已花：¥%.2f\n预算剩余：¥%.2f\n日均可花（剩 %d 天）：¥%.2f\n今日支出：¥%.2f",
		m.LedgerName, m.TotalBudget, m.MonthExpense, m.Remaining, m.DaysLeft, m.DailyAllowance, m.TodayExpense,
	))
}

func (t *TelegramAdapter) handleToday(msg *tgbotapi.Message) {
	userID, err := t.bindingUserID(msg.Chat.ID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。")
		return
	}
	lid, err := t.firstLedgerID(userID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "未找到账本。")
		return
	}
	cluster, err := service.LedgerExpenseClusterIDs(t.db, lid)
	if err != nil {
		t.sendReply(msg.Chat.ID, "读取账本失败。")
		return
	}
	loc := service.UserDigestTimezone(t.db, userID)
	local := time.Now().In(loc)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	end := start.AddDate(0, 0, 1).Add(-time.Nanosecond)
	sum := service.SumExpenseInRange(t.db, cluster, start, end)
	var led models.Ledger
	_ = t.db.First(&led, "id = ?", lid).Error
	en := t.userPreferEn(userID)
	if en {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("📅 %s · %s\nToday's expenses: ¥%.2f", led.Name, local.Format("2006-01-02"), sum))
		return
	}
	t.sendReply(msg.Chat.ID, fmt.Sprintf("📅 %s · %s\n今日支出：¥%.2f", led.Name, local.Format("2006-01-02"), sum))
}

func (t *TelegramAdapter) handleSpentNDays(msg *tgbotapi.Message, fixed int) {
	userID, err := t.bindingUserID(msg.Chat.ID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。")
		return
	}
	lid, err := t.firstLedgerID(userID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "未找到账本。")
		return
	}
	n := fixed
	if n <= 0 {
		n = 7
		args := strings.Fields(strings.TrimSpace(msg.CommandArguments()))
		if len(args) > 0 {
			if v, e := strconv.Atoi(args[0]); e == nil && v > 0 {
				n = v
			}
		}
	}
	if n > 366 {
		n = 366
	}
	cluster, err := service.LedgerExpenseClusterIDs(t.db, lid)
	if err != nil {
		t.sendReply(msg.Chat.ID, "读取账本失败。")
		return
	}
	loc := service.UserDigestTimezone(t.db, userID)
	sum := service.SumExpenseLastNDays(t.db, cluster, loc, time.Now(), n)
	var led models.Ledger
	_ = t.db.First(&led, "id = ?", lid).Error
	en := t.userPreferEn(userID)
	if en {
		t.sendReply(msg.Chat.ID, fmt.Sprintf("📉 %s\nLast %d days expenses: ¥%.2f", led.Name, n, sum))
		return
	}
	t.sendReply(msg.Chat.ID, fmt.Sprintf("📉 %s\n最近 %d 天支出：¥%.2f", led.Name, n, sum))
}

func (t *TelegramAdapter) handleExpenseDetail(msg *tgbotapi.Message) {
	userID, err := t.bindingUserID(msg.Chat.ID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN]。")
		return
	}
	lid, err := t.firstLedgerID(userID)
	if err != nil {
		t.sendReply(msg.Chat.ID, "未找到账本。")
		return
	}
	limit := 10
	if args := strings.Fields(strings.TrimSpace(msg.CommandArguments())); len(args) > 0 {
		if v, e := strconv.Atoi(args[0]); e == nil && v > 0 {
			limit = v
		}
	}
	cluster, err := service.LedgerExpenseClusterIDs(t.db, lid)
	if err != nil {
		t.sendReply(msg.Chat.ID, "读取账本失败。")
		return
	}
	loc := service.UserDigestTimezone(t.db, userID)
	var u models.User
	_ = t.db.Select("preferred_locale").First(&u, "id = ?", userID).Error
	lines, err := service.RecentExpenseLines(t.db, cluster, u.PreferredLocale, limit)
	if err != nil {
		log.Printf("handleExpenseDetail: %v", err)
		t.sendReply(msg.Chat.ID, "读取明细失败。")
		return
	}
	var led models.Ledger
	_ = t.db.First(&led, "id = ?", lid).Error
	en := t.userPreferEn(userID)
	var b strings.Builder
	if en {
		b.WriteString(fmt.Sprintf("🧾 %s — recent expenses\n", led.Name))
	} else {
		b.WriteString(fmt.Sprintf("🧾 %s — 最近支出\n", led.Name))
	}
	if len(lines) == 0 {
		if en {
			b.WriteString("(none)")
		} else {
			b.WriteString("（暂无）")
		}
		t.sendReply(msg.Chat.ID, b.String())
		return
	}
	for i, ln := range lines {
		note := ln.Note
		if len(note) > 40 {
			note = note[:37] + "…"
		}
		if note != "" {
			note = " · " + note
		}
		b.WriteString(fmt.Sprintf("%d. %s · ¥%.2f · %s%s\n", i+1, ln.Date.In(loc).Format("01-02"), ln.Amount, ln.CategoryDisplay, note))
	}
	text := strings.TrimSpace(b.String())
	if len(text) > 4000 {
		text = text[:3997] + "…"
	}
	t.sendReply(msg.Chat.ID, text)
}

// handleInstallment creates equal-split expense installments (same installment_group_id as Web).
func (t *TelegramAdapter) handleInstallment(msg *tgbotapi.Message) {
	var conn models.UserConnection
	if err := t.db.Where("platform = ? AND external_id = ?", "telegram", strconv.FormatInt(msg.Chat.ID, 10)).First(&conn).Error; err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN] 或在 Web 端生成 PIN 后一键绑定。")
		return
	}

	args := strings.Fields(strings.TrimSpace(msg.CommandArguments()))
	if len(args) < 3 {
		t.sendReply(msg.Chat.ID, "用法：/install <期数> <总金额> <分类或关键字…>\n"+
			"例：/install 6 1800 餐饮\n"+
			"与发消息记账相同，支持账本关键字、日期、括号备注、`l:标签`。\n"+
			"Alias: /fenqi …")
		return
	}

	months, err := strconv.Atoi(args[0])
	if err != nil || months < 2 || months > 60 {
		t.sendReply(msg.Chat.ID, "期数须为 2–60 的整数。")
		return
	}
	total, err := strconv.ParseFloat(args[1], 64)
	if err != nil || total <= 0 {
		t.sendReply(msg.Chat.ID, "总金额须为正数。")
		return
	}

	rest := strings.Join(args[2:], " ")
	ledgerKWMap := t.loadLedgerKeywordMap(conn.UserID)
	pr := ParseMessage(rest, time.Now(), ledgerKWMap)
	if pr.Type != "expense" {
		t.sendReply(msg.Chat.ID, "分期仅支持支出分类，请勿使用收入类标记。")
		return
	}
	if strings.TrimSpace(pr.CategoryHint) == "" {
		t.sendReply(msg.Chat.ID, "请写上分类或关键字（在金额后面的整段描述）。")
		return
	}

	var ledgerID uuid.UUID
	if pr.LedgerHint != "" {
		if lid, err := uuid.Parse(pr.LedgerHint); err == nil {
			ledgerID = lid
		}
	}
	if ledgerID == uuid.Nil {
		var lu models.LedgerUser
		if err := t.db.Where("user_id = ?", conn.UserID).First(&lu).Error; err != nil {
			t.sendReply(msg.Chat.ID, "未找到账本，请先在 Web 端创建一个账本。")
			return
		}
		ledgerID = lu.LedgerID
	}

	preferEn := false
	var acct models.User
	if err := t.db.Select("preferred_locale").First(&acct, "id = ?", conn.UserID).Error; err == nil {
		preferEn = strings.HasPrefix(strings.ToLower(strings.TrimSpace(acct.PreferredLocale)), "en")
	}
	if !service.UserCanWriteLedger(t.db, conn.UserID, ledgerID) {
		if preferEn {
			t.sendReply(msg.Chat.ID, "Read-only member: cannot create installments on this ledger.")
		} else {
			t.sendReply(msg.Chat.ID, "只读成员：无法在此账本创建分期。")
		}
		return
	}
	category, matched := t.resolveCategory(ledgerID, pr.CategoryHint, "expense", preferEn)
	if !matched {
		t.sendReply(msg.Chat.ID, t.noCategoryReply(ledgerID, pr.CategoryHint, preferEn))
		return
	}

	var tagIDs []uuid.UUID
	var attachedNames []string
	var createdTagNames []string
	for _, name := range pr.TagHints {
		tag, created, err := api.EnsureTag(ledgerID, name)
		if err != nil {
			log.Printf("bot install: ensure tag %q failed: %v", name, err)
			continue
		}
		tagIDs = append(tagIDs, tag.ID)
		attachedNames = append(attachedNames, tag.Name)
		if created {
			createdTagNames = append(createdTagNames, tag.Name)
		}
	}

	noteBase := strings.TrimSpace(pr.Note)
	loc := "zh"
	if preferEn {
		loc = "en"
	}
	catLabel := service.PickCategoryDisplayName(loc, category.NameZh, category.NameEn)
	if noteBase == pr.CategoryHint || noteBase == strings.TrimSpace(category.NameZh) || noteBase == strings.TrimSpace(category.NameEn) || noteBase == catLabel {
		noteBase = ""
	}

	gid, _, execErr := api.ExecInstallment(t.db, conn.UserID, api.InstallmentCreateParams{
		Amount:     total,
		CategoryID: category.ID,
		LedgerID:   ledgerID,
		Note:       noteBase,
		Date:       pr.Date,
		Months:     months,
		Mode:       "equal",
		TagIDs:     tagIDs,
	})
	if execErr != nil {
		log.Printf("bot install: ExecInstallment failed: %v", execErr)
		if errors.Is(execErr, api.ErrReadOnlyLedgerMember) {
			if preferEn {
				t.sendReply(msg.Chat.ID, "Read-only member: cannot create installments on this ledger.")
			} else {
				t.sendReply(msg.Chat.ID, "只读成员：无法在此账本创建分期。")
			}
			return
		}
		t.sendReply(msg.Chat.ID, "创建分期失败："+execErr.Error())
		return
	}

	var ledger models.Ledger
	_ = t.db.First(&ledger, "id = ?", ledgerID).Error
	per := total / float64(months)
	lines := []string{
		fmt.Sprintf("✅ 已创建分期：共 ¥%.2f · %d 期 · 每期约 ¥%.2f · %s", total, months, per, catLabel),
		fmt.Sprintf("分期组 ID：%s", gid.String()),
		fmt.Sprintf("首期日期：%s · 账本：%s", pr.Date.Format("2006-01-02"), ledger.Name),
	}
	if len(attachedNames) > 0 {
		lines = append(lines, "标签："+strings.Join(attachedNames, ", "))
	}
	if len(createdTagNames) > 0 {
		lines = append(lines, "🆕 新建标签："+strings.Join(createdTagNames, ", "))
	}
	t.sendReply(msg.Chat.ID, strings.Join(lines, "\n"))
}

func (t *TelegramAdapter) handlePlainMessage(msg *tgbotapi.Message) {
	// 1) Check binding
	var conn models.UserConnection
	if err := t.db.Where("platform = ? AND external_id = ?", "telegram", strconv.FormatInt(msg.Chat.ID, 10)).First(&conn).Error; err != nil {
		t.sendReply(msg.Chat.ID, "账号未绑定，请先 /bind [PIN] 或在 Web 端生成 PIN 后一键绑定。")
		return
	}

	text := strings.TrimSpace(msg.Text)
	if text == "" {
		return
	}

	// 2a) Optional `@账本名` prefix override (highest precedence). Strip it
	// before running the keyword parser so it doesn't end up in the note.
	prefixLedgerName, text := stripLedgerPrefix(text)

	// 2a') Plain-text /split trigger: `分账 …` or `split …` (case-insensitive,
	// no/full-width space allowed). Routes to the same engine as /split, with
	// any `@账本名` prefix becoming the (family) override.
	if args, ok := matchSplitTrigger(text); ok {
		preferEn := t.userPreferEn(conn.UserID)
		t.sendReply(msg.Chat.ID, t.runSplit(conn, args, preferEn, prefixLedgerName))
		return
	}

	// 2b) Load this user's ledger-keyword map for the parser
	ledgerKWMap := t.loadLedgerKeywordMap(conn.UserID)

	// 3) Run the deterministic parsing pipeline (pure function)
	result := ParseMessage(text, time.Now(), ledgerKWMap)
	if result.Amount <= 0 {
		t.sendReply(msg.Chat.ID, "没找到金额，试试：`午餐 50` 或 `50 午餐 (同事聚餐)`")
		return
	}

	// 4) Resolve target ledger by precedence:
	//    a) leading `@account` prefix on the message
	//    b) parser produced a LedgerHint via per-ledger keyword
	//    c) binding's saved default (set via /ledger)
	//    d) fallback: first ledger the user belongs to
	var ledgerID uuid.UUID
	if prefixLedgerName != "" {
		if l, ok := t.resolveLedgerByName(conn.UserID, prefixLedgerName); ok {
			ledgerID = l.ID
		} else {
			t.sendReply(msg.Chat.ID, fmt.Sprintf("找不到名为 %q 的账本，已忽略 @ 前缀。", prefixLedgerName))
		}
	}
	if ledgerID == uuid.Nil && result.LedgerHint != "" {
		if lid, err := uuid.Parse(result.LedgerHint); err == nil {
			ledgerID = lid
		}
	}
	if ledgerID == uuid.Nil && conn.DefaultLedgerID != nil {
		ledgerID = *conn.DefaultLedgerID
	}
	if ledgerID == uuid.Nil {
		var lu models.LedgerUser
		if err := t.db.Where("user_id = ?", conn.UserID).First(&lu).Error; err != nil {
			t.sendReply(msg.Chat.ID, "未找到账本，请先在 Web 端创建一个账本。")
			return
		}
		ledgerID = lu.LedgerID
	}

	preferEn := false
	var acct models.User
	if err := t.db.Select("preferred_locale").First(&acct, "id = ?", conn.UserID).Error; err == nil {
		preferEn = strings.HasPrefix(strings.ToLower(strings.TrimSpace(acct.PreferredLocale)), "en")
	}
	if !service.UserCanWriteLedger(t.db, conn.UserID, ledgerID) {
		if preferEn {
			t.sendReply(msg.Chat.ID, "Read-only member: cannot log entries on this ledger.")
		} else {
			t.sendReply(msg.Chat.ID, "只读成员：无法在此账本记账。")
		}
		return
	}

	// 5) Resolve category within that ledger (keyword zh/en preference follows account locale)
	category, matched := t.resolveCategory(ledgerID, result.CategoryHint, result.Type, preferEn)
	if !matched {
		t.sendReply(msg.Chat.ID, t.noCategoryReply(ledgerID, result.CategoryHint, preferEn))
		return
	}

	// 6) Write transaction
	transaction := models.Transaction{
		LedgerID:   ledgerID,
		CategoryID: category.ID,
		UserID:     conn.UserID,
		Amount:     result.Amount,
		Type:       result.Type,
		Note:       strings.TrimSpace(result.Note),
		Date:       result.Date,
	}
	if err := t.db.Create(&transaction).Error; err != nil {
		log.Printf("bot: create transaction failed: %v", err)
		t.sendReply(msg.Chat.ID, "保存失败，请稍后再试。")
		return
	}

	// 6.5) Resolve / auto-create tags from `l:xxx` hints and link them.
	//      Failure is non-fatal: the transaction is already saved.
	var attachedTags []models.Tag
	var createdTags []string
	for _, name := range result.TagHints {
		tag, created, err := api.EnsureTag(ledgerID, name)
		if err != nil {
			log.Printf("bot: ensure tag %q failed: %v", name, err)
			continue
		}
		attachedTags = append(attachedTags, tag)
		if created {
			createdTags = append(createdTags, tag.Name)
		}
	}
	if len(attachedTags) > 0 {
		tagIDs := make([]uuid.UUID, 0, len(attachedTags))
		for _, tg := range attachedTags {
			tagIDs = append(tagIDs, tg.ID)
		}
		if err := api.ReplaceTransactionTags(t.db, transaction.ID, ledgerID, tagIDs); err != nil {
			log.Printf("bot: replace transaction tags failed: %v", err)
		}
	}

	// 7) Compose a reply with the context we resolved so the user can spot mis-parses
	var ledger models.Ledger
	t.db.First(&ledger, "id = ?", ledgerID)
	typeLabel := "支出"
	if result.Type == "income" {
		typeLabel = "收入"
	}
	loc := "zh"
	if preferEn {
		loc = "en"
	}
	catLabel := service.PickCategoryDisplayName(loc, category.NameZh, category.NameEn)
	lines := []string{
		fmt.Sprintf("✅ 已记账：¥%.2f · %s · %s", result.Amount, typeLabel, catLabel),
	}
	noteTrim := strings.TrimSpace(transaction.Note)
	noteRedundant := noteTrim == catLabel ||
		noteTrim == strings.TrimSpace(category.NameZh) ||
		noteTrim == strings.TrimSpace(category.NameEn)
	if noteTrim != "" && !noteRedundant {
		lines = append(lines, "备注："+transaction.Note)
	}
	lines = append(lines, fmt.Sprintf("账本：%s · %s", ledger.Name, result.Date.Format("2006-01-02")))
	if len(attachedTags) > 0 {
		names := make([]string, 0, len(attachedTags))
		for _, tg := range attachedTags {
			if tg.ExcludeFromStats {
				names = append(names, tg.Name+"(已排除)")
			} else {
				names = append(names, tg.Name)
			}
		}
		lines = append(lines, "标签："+strings.Join(names, ", "))
	}
	if len(createdTags) > 0 {
		// Make new tags impossible to miss so typos get caught immediately.
		lines = append(lines, "🆕 新建标签："+strings.Join(createdTags, ", ")+
			"（可在 Web 端「分类 → 标签」卡片里改名/设为默认排除）")
	}
	t.sendReply(msg.Chat.ID, strings.Join(lines, "\n"))
}

// loadLedgerKeywordMap fetches all ledger keywords for the user and returns a
// lookup table keyword (lowercased) -> ledger_id string. We filter via the
// ledger_users membership so a stale keyword for a left ledger won't route.
func (t *TelegramAdapter) loadLedgerKeywordMap(userID uuid.UUID) map[string]string {
	var kws []models.LedgerKeyword
	t.db.Where("user_id = ?", userID).Find(&kws)
	out := make(map[string]string, len(kws))
	for _, k := range kws {
		out[strings.ToLower(k.Keyword)] = k.LedgerID.String()
	}
	return out
}

// catKwWithSort is an in-memory row for resolution (avoids GORM Scan+JOIN quirks
// with embedded models that could yield empty keyword_zh/en).
type catKwWithSort struct {
	Kw      models.CategoryKeyword
	CatSort int
}

func (t *TelegramAdapter) loadCategoryKeywordsForLedgerType(ledgerID uuid.UUID, txType string) []catKwWithSort {
	var kws []models.CategoryKeyword
	if err := t.db.Where("ledger_id = ?", ledgerID).Find(&kws).Error; err != nil {
		log.Printf("resolveCategory: list category_keywords: %v", err)
		return nil
	}
	if len(kws) == 0 {
		return nil
	}
	var cats []models.Category
	if err := t.db.Select("id", "sort_order", "type").Where("ledger_id = ?", ledgerID).Find(&cats).Error; err != nil {
		log.Printf("resolveCategory: list categories: %v", err)
		return nil
	}
	sortOf := make(map[uuid.UUID]int, len(cats))
	typeOf := make(map[uuid.UUID]string, len(cats))
	for _, c := range cats {
		sortOf[c.ID] = c.SortOrder
		typeOf[c.ID] = c.Type
	}
	out := make([]catKwWithSort, 0, len(kws))
	for i := range kws {
		k := kws[i]
		if typeOf[k.CategoryID] != txType {
			continue
		}
		out = append(out, catKwWithSort{Kw: k, CatSort: sortOf[k.CategoryID]})
	}
	return out
}

func normKeywordSide(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func kwExactLocaleRank(k models.CategoryKeyword, hint string, preferEn bool) int {
	zh, en := normKeywordSide(k.KeywordZh), normKeywordSide(k.KeywordEn)
	if hint != zh && hint != en {
		return -1
	}
	if preferEn {
		if hint == en {
			return 2
		}
		return 1
	}
	if hint == zh {
		return 2
	}
	return 1
}

func maxBilingualKeywordLen(k models.CategoryKeyword) int {
	a, b := len(normKeywordSide(k.KeywordZh)), len(normKeywordSide(k.KeywordEn))
	if a > b {
		return a
	}
	return b
}

func layer3PreferRank(k models.CategoryKeyword, hint string, preferEn bool) int {
	zh, en := normKeywordSide(k.KeywordZh), normKeywordSide(k.KeywordEn)
	hitZh := zh != "" && strings.Contains(hint, zh)
	hitEn := en != "" && strings.Contains(hint, en)
	if !hitZh && !hitEn {
		return 0
	}
	if preferEn {
		r := 0
		if hitEn {
			r += 2
		}
		if hitZh {
			r += 1
		}
		return r
	}
	r := 0
	if hitZh {
		r += 2
	}
	if hitEn {
		r += 1
	}
	return r
}

func containedSideMaxLen(zh, en, hint string) int {
	m := 0
	if zh != "" && strings.Contains(hint, zh) && len(zh) > m {
		m = len(zh)
	}
	if en != "" && strings.Contains(hint, en) && len(en) > m {
		m = len(en)
	}
	return m
}

func layer4PreferRank(k models.CategoryKeyword, hint string, preferEn bool) int {
	zh, en := normKeywordSide(k.KeywordZh), normKeywordSide(k.KeywordEn)
	hitZh := zh != "" && strings.Contains(zh, hint)
	hitEn := en != "" && strings.Contains(en, hint)
	if !hitZh && !hitEn {
		return 0
	}
	if preferEn {
		r := 0
		if hitEn {
			r += 2
		}
		if hitZh {
			r += 1
		}
		return r
	}
	r := 0
	if hitZh {
		r += 2
	}
	if hitEn {
		r += 1
	}
	return r
}

func prefixSideMaxLen(zh, en, hint string) int {
	m := 0
	if zh != "" && strings.Contains(zh, hint) && len(zh) > m {
		m = len(zh)
	}
	if en != "" && strings.Contains(en, hint) && len(en) > m {
		m = len(en)
	}
	return m
}

// resolveCategory implements the five-layer lookup described in the plan.
// txType filters by category.type so "收入 8000" matches income categories only.
// preferEn follows users.preferred_locale (en* → English keyword side first).
//
//	1. name = hint (exact)
//	2. keyword_zh or keyword_en = hint (exact), locale-aware tie-break
//	3. hint contains some keyword (substring), locale-aware then longer match
//	4. keyword side contains hint (prefix-ish), locale-aware
//	5. name contains hint OR hint contains name
func (t *TelegramAdapter) resolveCategory(ledgerID uuid.UUID, hint string, txType string, preferEn bool) (models.Category, bool) {
	hint = strings.ToLower(strings.TrimSpace(hint))

	if hint == "" {
		var cat models.Category
		if err := t.db.Where("ledger_id = ? AND type = ?", ledgerID, txType).
			Order("sort_order ASC, is_system DESC, created_at ASC").
			First(&cat).Error; err == nil {
			return cat, true
		}
		return models.Category{}, false
	}

	// L1: exact name (either language side)
	var cat models.Category
	if err := t.db.Where("ledger_id = ? AND type = ? AND (LOWER(name_zh) = ? OR LOWER(name_en) = ?)",
		ledgerID, txType, hint, hint).
		Order("sort_order ASC").
		First(&cat).Error; err == nil {
		return cat, true
	}

	all := t.loadCategoryKeywordsForLedgerType(ledgerID, txType)

	// L2: exact keyword (zh or en column)
	var l2 []catKwWithSort
	for _, r := range all {
		zh, en := normKeywordSide(r.Kw.KeywordZh), normKeywordSide(r.Kw.KeywordEn)
		if (zh != "" && hint == zh) || (en != "" && hint == en) {
			l2 = append(l2, r)
		}
	}
	if len(l2) > 0 {
		sort.Slice(l2, func(i, j int) bool {
			ri := kwExactLocaleRank(l2[i].Kw, hint, preferEn)
			rj := kwExactLocaleRank(l2[j].Kw, hint, preferEn)
			if ri != rj {
				return ri > rj
			}
			if l2[i].CatSort != l2[j].CatSort {
				return l2[i].CatSort < l2[j].CatSort
			}
			return maxBilingualKeywordLen(l2[i].Kw) < maxBilingualKeywordLen(l2[j].Kw)
		})
		if err := t.db.First(&cat, "id = ?", l2[0].Kw.CategoryID).Error; err == nil {
			return cat, true
		}
	}

	// L3: hint contains whole keyword side (e.g. "买了蔬菜" contains "蔬菜")
	var l3 []catKwWithSort
	for _, r := range all {
		zh, en := normKeywordSide(r.Kw.KeywordZh), normKeywordSide(r.Kw.KeywordEn)
		if (zh != "" && strings.Contains(hint, zh)) || (en != "" && strings.Contains(hint, en)) {
			l3 = append(l3, r)
		}
	}
	if len(l3) > 0 {
		sort.Slice(l3, func(i, j int) bool {
			a, b := l3[i], l3[j]
			if a.CatSort != b.CatSort {
				return a.CatSort < b.CatSort
			}
			ri := layer3PreferRank(a.Kw, hint, preferEn)
			rj := layer3PreferRank(b.Kw, hint, preferEn)
			if ri != rj {
				return ri > rj
			}
			zi, ei := normKeywordSide(a.Kw.KeywordZh), normKeywordSide(a.Kw.KeywordEn)
			zj, ej := normKeywordSide(b.Kw.KeywordZh), normKeywordSide(b.Kw.KeywordEn)
			return containedSideMaxLen(zi, ei, hint) > containedSideMaxLen(zj, ej, hint)
		})
		if err := t.db.First(&cat, "id = ?", l3[0].Kw.CategoryID).Error; err == nil {
			return cat, true
		}
	}

	// L4: keyword side contains hint (e.g. hint "菜" inside keyword "蔬菜")
	var l4 []catKwWithSort
	for _, r := range all {
		zh, en := normKeywordSide(r.Kw.KeywordZh), normKeywordSide(r.Kw.KeywordEn)
		if (zh != "" && strings.Contains(zh, hint)) || (en != "" && strings.Contains(en, hint)) {
			l4 = append(l4, r)
		}
	}
	if len(l4) > 0 {
		sort.Slice(l4, func(i, j int) bool {
			a, b := l4[i], l4[j]
			if a.CatSort != b.CatSort {
				return a.CatSort < b.CatSort
			}
			ri := layer4PreferRank(a.Kw, hint, preferEn)
			rj := layer4PreferRank(b.Kw, hint, preferEn)
			if ri != rj {
				return ri > rj
			}
			zi, ei := normKeywordSide(a.Kw.KeywordZh), normKeywordSide(a.Kw.KeywordEn)
			zj, ej := normKeywordSide(b.Kw.KeywordZh), normKeywordSide(b.Kw.KeywordEn)
			return prefixSideMaxLen(zi, ei, hint) > prefixSideMaxLen(zj, ej, hint)
		})
		if err := t.db.First(&cat, "id = ?", l4[0].Kw.CategoryID).Error; err == nil {
			return cat, true
		}
	}

	// L5: fuzzy name — substring match either direction (ILIKE, bilingual columns)
	pLike := "%" + hint + "%"
	if err := t.db.Where(
		`ledger_id = ? AND type = ? AND (
			name_zh ILIKE ? OR name_en ILIKE ?
			OR ? ILIKE '%' || name_zh || '%' OR ? ILIKE '%' || name_en || '%'
		)`,
		ledgerID, txType, pLike, pLike, hint, hint).
		Order("sort_order ASC").
		First(&cat).Error; err == nil {
		return cat, true
	}

	return models.Category{}, false
}

// noCategoryReply produces a helpful error listing the available categories so
// the user can pick an existing one without guessing.
func (t *TelegramAdapter) noCategoryReply(ledgerID uuid.UUID, hint string, preferEn bool) string {
	var cats []models.Category
	t.db.Where("ledger_id = ?", ledgerID).
		Order("sort_order ASC, name_zh ASC").
		Limit(12).Find(&cats)
	loc := "zh"
	if preferEn {
		loc = "en"
	}
	names := make([]string, 0, len(cats))
	for _, c := range cats {
		names = append(names, service.PickCategoryDisplayName(loc, c.NameZh, c.NameEn))
	}
	out := fmt.Sprintf("没有找到分类「%s」。", hint)
	if len(names) > 0 {
		out += "\n可用分类：" + strings.Join(names, " / ")
	}
	out += "\n提示：在 Web 端给分类添加关键字后，就能用更口语化的描述记账。"
	return out
}

func (t *TelegramAdapter) sendReply(chatID int64, text string) {
	msg := tgbotapi.NewMessage(chatID, text)
	t.bot.Send(msg)
}

// SendToUser delivers a plain-text message to the user's linked Telegram chat (private).
func (t *TelegramAdapter) SendToUser(userID uuid.UUID, text string) error {
	var conn models.UserConnection
	if err := t.db.Where("user_id = ? AND platform = ?", userID, "telegram").First(&conn).Error; err != nil {
		return err
	}
	chatID, err := strconv.ParseInt(conn.ExternalID, 10, 64)
	if err != nil {
		return fmt.Errorf("parse telegram chat id: %w", err)
	}
	msg := tgbotapi.NewMessage(chatID, text)
	_, err = t.bot.Send(msg)
	return err
}
