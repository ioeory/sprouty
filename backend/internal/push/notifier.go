package push

import "github.com/google/uuid"

// TelegramNotifier sends plain-text digests to a linked Telegram chat.
type TelegramNotifier interface {
	SendTelegramToUser(userID uuid.UUID, text string) error
}

// DefaultNotifier is wired from main (BotManager). Nil if Telegram is off.
var DefaultNotifier TelegramNotifier
