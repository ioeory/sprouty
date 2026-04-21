package bot

import (
	"log"
	"os"

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
