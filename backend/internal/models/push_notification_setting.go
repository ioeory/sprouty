package models

import (
	"github.com/google/uuid"
)

// PushNotificationSetting stores per-user scheduled digest pushes (e.g. Telegram).
// One row per user (unique user_id).
type PushNotificationSetting struct {
	Base
	UserID   uuid.UUID `gorm:"type:uuid;uniqueIndex;not null" json:"user_id"`
	Enabled  bool      `gorm:"default:false;index" json:"enabled"`
	LedgerID uuid.UUID `gorm:"type:uuid;not null;index" json:"ledger_id"`

	ScheduleType string `gorm:"size:16;default:daily" json:"schedule_type"` // daily | weekly
	PushHour     int    `gorm:"default:9" json:"push_hour"`
	PushMinute   int    `gorm:"default:0" json:"push_minute"`
	Weekday      int    `gorm:"default:0" json:"weekday"` // time.Weekday: 0=Sunday .. 6=Saturday
	Timezone     string `gorm:"size:64;default:Asia/Shanghai" json:"timezone"`

	IncludeBudgetRemaining bool   `gorm:"default:true" json:"include_budget_remaining"`
	IncludeTodayExpense    bool   `gorm:"default:true" json:"include_today_expense"`
	CustomPrefix           string `gorm:"size:240" json:"custom_prefix"`

	LastSentLocalDate string `gorm:"size:10" json:"last_sent_local_date"` // YYYY-MM-DD in user TZ, last successful send
}
