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

type pushSubscriptionBody struct {
	Name                   string    `json:"name"`
	MessageLocale          string    `json:"message_locale"`
	Enabled                bool      `json:"enabled"`
	LedgerID               uuid.UUID `json:"ledger_id"`
	ScheduleType           string    `json:"schedule_type"`
	PushHour               int       `json:"push_hour"`
	PushMinute             int       `json:"push_minute"`
	Weekday                int       `json:"weekday"`
	DayOfMonth             int       `json:"day_of_month"`
	Timezone               string    `json:"timezone"`
	IncludeBudgetRemaining bool      `json:"include_budget_remaining"`
	IncludeTodayExpense    bool      `json:"include_today_expense"`
	CustomPrefix           string    `json:"custom_prefix"`
}

func validatePushSubscription(userID uuid.UUID, req *pushSubscriptionBody) error {
	st := strings.TrimSpace(strings.ToLower(req.ScheduleType))
	if st == "" {
		st = "daily"
	}
	if st != "daily" && st != "weekly" && st != "monthly" {
		return errors.New("schedule_type must be daily, weekly, or monthly")
	}
	if req.PushHour < 0 || req.PushHour > 23 || req.PushMinute < 0 || req.PushMinute > 59 {
		return errors.New("invalid push time")
	}
	if st == "weekly" && (req.Weekday < 0 || req.Weekday > 6) {
		return errors.New("weekday must be 0-6")
	}
	if st == "monthly" && (req.DayOfMonth < 1 || req.DayOfMonth > 31) {
		return errors.New("day_of_month must be 1-31")
	}
	tz := strings.TrimSpace(req.Timezone)
	if tz == "" {
		tz = "Asia/Shanghai"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return errors.New("invalid timezone")
	}
	if req.LedgerID == uuid.Nil {
		return errors.New("ledger_id is required")
	}
	if !userCanAccessLedger(userID, req.LedgerID) {
		return errors.New("no access to this ledger")
	}
	ml := strings.TrimSpace(strings.ToLower(req.MessageLocale))
	if ml == "" {
		ml = "auto"
	}
	if ml != "auto" && ml != "zh-cn" && ml != "en" {
		return errors.New("message_locale must be auto, zh-CN, or en")
	}
	if req.Enabled && !req.IncludeBudgetRemaining && !req.IncludeTodayExpense {
		return errors.New("enable at least one digest section")
	}
	prefix := strings.TrimSpace(req.CustomPrefix)
	if len([]rune(prefix)) > 200 {
		return errors.New("custom_prefix too long")
	}
	n := strings.TrimSpace(req.Name)
	if len([]rune(n)) > 64 {
		return errors.New("name too long")
	}
	return nil
}

func applyPushBody(row *models.PushNotificationSetting, req *pushSubscriptionBody) {
	st := strings.TrimSpace(strings.ToLower(req.ScheduleType))
	if st == "" {
		st = "daily"
	}
	tz := strings.TrimSpace(req.Timezone)
	if tz == "" {
		tz = "Asia/Shanghai"
	}
	ml := strings.TrimSpace(req.MessageLocale)
	if ml == "" {
		ml = "auto"
	}
	if strings.EqualFold(ml, "zh-cn") {
		ml = "zh-CN"
	}
	if strings.EqualFold(ml, "en") {
		ml = "en"
	}
	row.Name = strings.TrimSpace(req.Name)
	row.MessageLocale = ml
	row.Enabled = req.Enabled
	row.LedgerID = req.LedgerID
	row.ScheduleType = st
	row.PushHour = req.PushHour
	row.PushMinute = req.PushMinute
	row.Weekday = req.Weekday
	if st == "monthly" {
		row.DayOfMonth = req.DayOfMonth
		if row.DayOfMonth < 1 {
			row.DayOfMonth = 1
		}
	} else {
		row.DayOfMonth = 1
	}
	row.Timezone = tz
	row.IncludeBudgetRemaining = req.IncludeBudgetRemaining
	row.IncludeTodayExpense = req.IncludeTodayExpense
	row.CustomPrefix = strings.TrimSpace(req.CustomPrefix)
}

// ListPushSubscriptions GET /api/push-subscriptions
func ListPushSubscriptions(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var rows []models.PushNotificationSetting
	if err := service.DB.Where("user_id = ?", userID).Order("created_at ASC").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscriptions": rows})
}

// CreatePushSubscription POST /api/push-subscriptions
func CreatePushSubscription(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var req pushSubscriptionBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validatePushSubscription(userID, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	row := models.PushNotificationSetting{UserID: userID}
	applyPushBody(&row, &req)
	if err := service.DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create failed"})
		return
	}
	c.JSON(http.StatusCreated, row)
}

// UpdatePushSubscription PUT /api/push-subscriptions/:id
func UpdatePushSubscription(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req pushSubscriptionBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validatePushSubscription(userID, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var row models.PushNotificationSetting
	if err := service.DB.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database error"})
		return
	}
	applyPushBody(&row, &req)
	if !req.Enabled {
		row.LastSentLocalDate = ""
	}
	if err := service.DB.Save(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save failed"})
		return
	}
	c.JSON(http.StatusOK, row)
}

// DeletePushSubscription DELETE /api/push-subscriptions/:id
func DeletePushSubscription(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	res := service.DB.Where("id = ? AND user_id = ?", id, userID).Delete(&models.PushNotificationSetting{})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

// PostPushSubscriptionTest POST /api/push-subscriptions/:id/test
func PostPushSubscriptionTest(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var row models.PushNotificationSetting
	if err := service.DB.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
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
