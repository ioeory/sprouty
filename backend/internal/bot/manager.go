package bot

import (
	"errors"
	"log"
	"os"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type BotManager struct {
	db              *gorm.DB
	telegramAdapter *TelegramAdapter
}

func NewBotManager(db *gorm.DB) *BotManager {
	return &BotManager{
		db: db,
	}
}

func (m *BotManager) StartAll() {
	// Telegram 
	if os.Getenv("TELEGRAM_BOT_TOKEN") != "" {
		tg, err := NewTelegramAdapter(m.db)
		if err != nil {
			log.Printf("Failed to initialize Telegram Bot: %v", err)
		} else {
			m.telegramAdapter = tg
			go m.telegramAdapter.Start()
		}
	}

	// Future bots (Feishu, Slack) can be added here
}

func (m *BotManager) StopAll() {
	if m.telegramAdapter != nil {
		m.telegramAdapter.Stop()
	}
}

// SendTelegramToUser implements push.TelegramNotifier for scheduled digests.
func (m *BotManager) SendTelegramToUser(userID uuid.UUID, text string) error {
	if m.telegramAdapter == nil {
		return errors.New("telegram bot not configured")
	}
	return m.telegramAdapter.SendToUser(userID, text)
}
