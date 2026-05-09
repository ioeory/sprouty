package models

import (
	"github.com/google/uuid"
)

// PushNotificationSetting is one scheduled Telegram digest subscription per row.
// Multiple rows per user are allowed (different ledgers / schedules / languages).
type PushNotificationSetting struct {
	Base
	UserID   uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Enabled  bool      `gorm:"default:false;index" json:"enabled"`
	LedgerID uuid.UUID `gorm:"type:uuid;not null;index" json:"ledger_id"`

	Name           string `gorm:"size:64" json:"name"`
	MessageLocale  string `gorm:"size:16;default:auto" json:"message_locale"` // auto | zh-CN | en
	ScheduleType   string `gorm:"size:16;default:daily" json:"schedule_type"` // daily | weekly | monthly
	PushHour       int    `gorm:"default:9" json:"push_hour"`
	PushMinute     int    `gorm:"default:0" json:"push_minute"`
	Weekday        int    `gorm:"default:0" json:"weekday"`       // time.Weekday: 0=Sunday .. 6=Saturday (weekly)
	DayOfMonth     int    `gorm:"default:1" json:"day_of_month"`   // 1-31 (monthly)
	Timezone       string `gorm:"size:64;default:Asia/Shanghai" json:"timezone"`

	IncludeBudgetRemaining bool   `gorm:"default:true" json:"include_budget_remaining"`
	IncludeTodayExpense    bool   `gorm:"default:true" json:"include_today_expense"`
	IncludeComparison      bool   `gorm:"default:true" json:"include_comparison"`
	IncludeTopCategories   bool   `gorm:"default:true" json:"include_top_categories"`
	IncludeAnomaly         bool   `gorm:"default:true" json:"include_anomaly"`
	CustomPrefix           string `gorm:"size:240" json:"custom_prefix"`

	LastSentLocalDate string `gorm:"size:10" json:"last_sent_local_date"` // YYYY-MM-DD in user TZ
}
