package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/push"
	"sprouts-self/backend/internal/service"
)

func firstLedgerIDForUser(userID uuid.UUID) (uuid.UUID, bool) {
	var lu models.LedgerUser
	if err := service.DB.Where("user_id = ?", userID).Order("ledger_id ASC").First(&lu).Error; err != nil {
		return uuid.Nil, false
	}
	return lu.LedgerID, true
}

func defaultPushSetting(userID uuid.UUID) models.PushNotificationSetting {
	row := models.PushNotificationSetting{
		UserID:                 userID,
		Enabled:                false,
		ScheduleType:           "daily",
		PushHour:               9,
		PushMinute:             0,
		Weekday:                1,
		Timezone:               "Asia/Shanghai",
		IncludeBudgetRemaining: true,
		IncludeTodayExpense:    true,
	}
	if lid, ok := firstLedgerIDForUser(userID); ok {
		row.LedgerID = lid
	}
	return row
}

// GetPushSettings GET /api/push-settings
func GetPushSettings(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var row models.PushNotificationSetting
	if err := service.DB.Where("user_id = ?", userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, defaultPushSetting(userID))
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	c.JSON(http.StatusOK, row)
}

type pushSettingsPut struct {
	Enabled                bool      `json:"enabled"`
	LedgerID               uuid.UUID `json:"ledger_id"`
	ScheduleType           string    `json:"schedule_type"`
	PushHour               int       `json:"push_hour"`
	PushMinute             int       `json:"push_minute"`
	Weekday                int       `json:"weekday"`
	Timezone               string    `json:"timezone"`
	IncludeBudgetRemaining bool      `json:"include_budget_remaining"`
	IncludeTodayExpense    bool      `json:"include_today_expense"`
	CustomPrefix           string    `json:"custom_prefix"`
}

// PutPushSettings PUT /api/push-settings
func PutPushSettings(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var req pushSettingsPut
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	st := strings.TrimSpace(strings.ToLower(req.ScheduleType))
	if st == "" {
		st = "daily"
	}
	if st != "daily" && st != "weekly" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "schedule_type must be daily or weekly"})
		return
	}
	if req.PushHour < 0 || req.PushHour > 23 || req.PushMinute < 0 || req.PushMinute > 59 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid push time"})
		return
	}
	if st == "weekly" && (req.Weekday < 0 || req.Weekday > 6) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "weekday must be 0-6 (Sunday-Saturday)"})
		return
	}
	tz := strings.TrimSpace(req.Timezone)
	if tz == "" {
		tz = "Asia/Shanghai"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid timezone"})
		return
	}
	if req.LedgerID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ledger_id is required"})
		return
	}
	if !userCanAccessLedger(userID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}
	if req.Enabled && !req.IncludeBudgetRemaining && !req.IncludeTodayExpense {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enable at least one of budget or today expense"})
		return
	}

	prefix := strings.TrimSpace(req.CustomPrefix)
	if len([]rune(prefix)) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "custom_prefix too long"})
		return
	}

	var row models.PushNotificationSetting
	r := service.DB.Where("user_id = ?", userID).First(&row)
	if r.Error != nil && errors.Is(r.Error, gorm.ErrRecordNotFound) {
		row = models.PushNotificationSetting{
			UserID: userID,
		}
	} else if r.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}

	row.Enabled = req.Enabled
	row.LedgerID = req.LedgerID
	row.ScheduleType = st
	row.PushHour = req.PushHour
	row.PushMinute = req.PushMinute
	row.Weekday = req.Weekday
	row.Timezone = tz
	row.IncludeBudgetRemaining = req.IncludeBudgetRemaining
	row.IncludeTodayExpense = req.IncludeTodayExpense
	row.CustomPrefix = prefix
	// Turning off or changing schedule clears dedupe so next enable fires cleanly
	if !req.Enabled {
		row.LastSentLocalDate = ""
	}

	if err := service.DB.Save(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save failed"})
		return
	}
	c.JSON(http.StatusOK, row)
}

// PostPushSettingsTest POST /api/push-settings/test — send one digest now.
func PostPushSettingsTest(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var row models.PushNotificationSetting
	if err := service.DB.Where("user_id = ?", userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "save push settings first"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	if err := push.SendTestDigest(service.DB, userID, &row); err != nil {
		switch {
		case errors.Is(err, push.ErrNotifierMissing):
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "telegram bot not configured on server"})
		case errors.Is(err, push.ErrTelegramNotLinked):
			c.JSON(http.StatusBadRequest, gin.H{"error": "link telegram in bot settings first"})
		case errors.Is(err, push.ErrNothingToInclude):
			c.JSON(http.StatusBadRequest, gin.H{"error": "enable at least one digest section in settings"})
		default:
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
