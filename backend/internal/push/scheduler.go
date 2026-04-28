package push

import (
	"log"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"sprouts-self/backend/internal/models"
)

func hasTelegram(db *gorm.DB, userID uuid.UUID) bool {
	var n int64
	db.Model(&models.UserConnection{}).
		Where("user_id = ? AND platform = ?", userID, "telegram").
		Count(&n)
	return n > 0
}

// RunSchedulerTick evaluates all enabled settings and sends due digests.
// Intended to be called periodically (e.g. every 30s) from a background goroutine.
func RunSchedulerTick(db *gorm.DB) {
	if DefaultNotifier == nil {
		return
	}
	now := time.Now()
	var settings []models.PushNotificationSetting
	if err := db.Where("enabled = ?", true).Find(&settings).Error; err != nil {
		log.Printf("push scheduler: list settings: %v", err)
		return
	}

	for i := range settings {
		s := &settings[i]
		loc, err := time.LoadLocation(s.Timezone)
		if err != nil {
			loc = time.UTC
		}
		local := now.In(loc)
		if local.Hour() != s.PushHour || local.Minute() != s.PushMinute {
			continue
		}
		switch s.ScheduleType {
		case "weekly":
			if int(local.Weekday()) != s.Weekday {
				continue
			}
		case "monthly":
			dim := time.Date(local.Year(), local.Month()+1, 0, 0, 0, 0, 0, loc).Day()
			target := s.DayOfMonth
			if target < 1 {
				target = 1
			}
			if target > dim {
				target = dim
			}
			if local.Day() != target {
				continue
			}
		case "daily", "":
			// every day at push hour
		default:
			continue
		}

		today := local.Format("2006-01-02")
		if s.LastSentLocalDate == today {
			continue
		}

		if !hasTelegram(db, s.UserID) {
			continue
		}

		metrics, err := ComputeDigestMetrics(db, s.UserID, s.LedgerID, now, loc)
		if err != nil {
			log.Printf("push digest user=%s ledger=%s: %v", s.UserID, s.LedgerID, err)
			continue
		}

		if !s.IncludeBudgetRemaining && !s.IncludeTodayExpense {
			continue
		}

		langEN := ResolvePushLangEN(db, s.UserID, s.MessageLocale)
		text := BuildDigestMessage(s, metrics, langEN, local)
		if err := DefaultNotifier.SendTelegramToUser(s.UserID, text); err != nil {
			log.Printf("push telegram user=%s: %v", s.UserID, err)
			continue
		}

		if err := db.Model(&models.PushNotificationSetting{}).
			Where("id = ?", s.ID).
			Update("last_sent_local_date", today).Error; err != nil {
			log.Printf("push update last_sent user=%s: %v", s.UserID, err)
		}
	}
}

// StartScheduler runs RunSchedulerTick on a fixed interval until the process exits.
func StartScheduler(db *gorm.DB) {
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for range t.C {
			RunSchedulerTick(db)
		}
	}()
}

// SendTestDigest sends one digest immediately (for manual test from API).
func SendTestDigest(db *gorm.DB, userID uuid.UUID, s *models.PushNotificationSetting) error {
	if DefaultNotifier == nil {
		return ErrNotifierMissing
	}
	if !hasTelegram(db, userID) {
		return ErrTelegramNotLinked
	}
	if !s.IncludeBudgetRemaining && !s.IncludeTodayExpense {
		return ErrNothingToInclude
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		loc = time.UTC
	}
	now := time.Now()
	metrics, err := ComputeDigestMetrics(db, userID, s.LedgerID, now, loc)
	if err != nil {
		return err
	}
	langEN := ResolvePushLangEN(db, userID, s.MessageLocale)
	text := BuildDigestMessage(s, metrics, langEN, now.In(loc))
	return DefaultNotifier.SendTelegramToUser(userID, text)
}
