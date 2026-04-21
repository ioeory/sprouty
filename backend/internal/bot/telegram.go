package bot

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"
	"sprouts-self/backend/internal/api"
	"sprouts-self/backend/internal/models"
	"gorm.io/gorm"
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
		default:
			t.sendReply(msg.Chat.ID, "Unknown command. Use /start for help.")
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
		"  50 购物 新鞋"
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

	// 2) Load this user's ledger-keyword map for the parser
	ledgerKWMap := t.loadLedgerKeywordMap(conn.UserID)

	// 3) Run the deterministic parsing pipeline (pure function)
	result := ParseMessage(text, time.Now(), ledgerKWMap)
	if result.Amount <= 0 {
		t.sendReply(msg.Chat.ID, "没找到金额，试试：`午餐 50` 或 `50 午餐 (同事聚餐)`")
		return
	}

	// 4) Resolve target ledger:
	//    a) parser produced a LedgerHint -> use it (already validated membership when we loaded the map)
	//    b) default to the first ledger the user belongs to
	var ledgerID uuid.UUID
	if result.LedgerHint != "" {
		if lid, err := uuid.Parse(result.LedgerHint); err == nil {
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

	// 5) Resolve category within that ledger
	category, matched := t.resolveCategory(ledgerID, result.CategoryHint, result.Type)
	if !matched {
		t.sendReply(msg.Chat.ID, t.noCategoryReply(ledgerID, result.CategoryHint))
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
	lines := []string{
		fmt.Sprintf("✅ 已记账：¥%.2f · %s · %s", result.Amount, typeLabel, category.Name),
	}
	if transaction.Note != "" && transaction.Note != category.Name {
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

// resolveCategory implements the five-layer lookup described in the plan.
// txType filters by category.type so "收入 8000" matches income categories only.
//
//	1. name = hint (exact)
//	2. keyword = hint (exact)
//	3. hint contains some keyword
//	4. keyword contains hint
//	5. name contains hint OR hint contains name
//
// Ties within a layer are broken by (sort_order ASC, LENGTH(name) ASC).
func (t *TelegramAdapter) resolveCategory(ledgerID uuid.UUID, hint string, txType string) (models.Category, bool) {
	hint = strings.ToLower(strings.TrimSpace(hint))

	// Edge case: no hint. Fall back to the lowest-sort-order category of the
	// requested type so "收入 5000" still works.
	if hint == "" {
		var cat models.Category
		if err := t.db.Where("ledger_id = ? AND type = ?", ledgerID, txType).
			Order("sort_order ASC, is_system DESC, created_at ASC").
			First(&cat).Error; err == nil {
			return cat, true
		}
		return models.Category{}, false
	}

	// L1: exact name
	var cat models.Category
	if err := t.db.Where("ledger_id = ? AND type = ? AND LOWER(name) = ?", ledgerID, txType, hint).
		Order("sort_order ASC, LENGTH(name) ASC").
		First(&cat).Error; err == nil {
		return cat, true
	}

	// L2: exact keyword
	var kw models.CategoryKeyword
	if err := t.db.Table("category_keywords").
		Joins("JOIN categories ON categories.id = category_keywords.category_id").
		Where("category_keywords.ledger_id = ? AND category_keywords.keyword = ? AND categories.type = ?", ledgerID, hint, txType).
		Order("categories.sort_order ASC, LENGTH(category_keywords.keyword) ASC").
		Select("category_keywords.*").
		First(&kw).Error; err == nil {
		if err := t.db.First(&cat, "id = ?", kw.CategoryID).Error; err == nil {
			return cat, true
		}
	}

	// L3: hint contains some keyword (e.g. "买了件衣服" contains "衣服")
	var kws []models.CategoryKeyword
	t.db.Table("category_keywords").
		Joins("JOIN categories ON categories.id = category_keywords.category_id").
		Where("category_keywords.ledger_id = ? AND categories.type = ?", ledgerID, txType).
		Order("categories.sort_order ASC, LENGTH(category_keywords.keyword) DESC"). // longer keyword first = more specific
		Select("category_keywords.*").
		Scan(&kws)
	for _, k := range kws {
		if k.Keyword != "" && strings.Contains(hint, k.Keyword) {
			if err := t.db.First(&cat, "id = ?", k.CategoryID).Error; err == nil {
				return cat, true
			}
		}
	}

	// L4: keyword contains hint (user typed "咖" and keyword is "咖啡")
	for _, k := range kws {
		if k.Keyword != "" && strings.Contains(k.Keyword, hint) {
			if err := t.db.First(&cat, "id = ?", k.CategoryID).Error; err == nil {
				return cat, true
			}
		}
	}

	// L5: fuzzy name - ILIKE either direction
	if err := t.db.Where("ledger_id = ? AND type = ? AND (name ILIKE ? OR ? ILIKE '%' || name || '%')",
		ledgerID, txType, "%"+hint+"%", hint).
		Order("sort_order ASC, LENGTH(name) ASC").
		First(&cat).Error; err == nil {
		return cat, true
	}

	return models.Category{}, false
}

// noCategoryReply produces a helpful error listing the available categories so
// the user can pick an existing one without guessing.
func (t *TelegramAdapter) noCategoryReply(ledgerID uuid.UUID, hint string) string {
	var cats []models.Category
	t.db.Where("ledger_id = ?", ledgerID).
		Order("sort_order ASC, name ASC").
		Limit(12).Find(&cats)
	names := make([]string, 0, len(cats))
	for _, c := range cats {
		names = append(names, c.Name)
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
