package api

import (
	"net/http"
	"strconv"
	"time"

	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// GetAdminSettings returns registration_open (admin only).
func GetAdminSettings(c *gin.Context) {
	var s models.SystemSettings
	if err := service.DB.First(&s, 1).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"registration_open": s.RegistrationOpen})
}

type putAdminSettingsReq struct {
	RegistrationOpen *bool `json:"registration_open"`
}

// PutAdminSettings updates system flags.
func PutAdminSettings(c *gin.Context) {
	var req putAdminSettingsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	if req.RegistrationOpen == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no fields"})
		return
	}
	before := RegistrationOpen()
	if err := service.DB.Model(&models.SystemSettings{}).Where("id = ?", 1).Update("registration_open", *req.RegistrationOpen).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	WriteAuditLog(c, &uid, "admin.settings_update", "settings", strPtr("1"), map[string]interface{}{
		"registration_open": map[string]interface{}{"from": before, "to": *req.RegistrationOpen},
	})
	c.JSON(http.StatusOK, gin.H{"registration_open": *req.RegistrationOpen})
}

// GetAuditLogs lists audit entries with pagination.
func GetAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	q := service.DB.Model(&models.AuditLog{})
	if a := c.Query("action"); a != "" {
		q = q.Where("action = ?", a)
	}
	if actor := c.Query("actor_user_id"); actor != "" {
		if id, err := uuid.Parse(actor); err == nil {
			q = q.Where("actor_user_id = ?", id)
		}
	}
	if from := c.Query("from"); from != "" {
		if t, err := time.Parse(time.RFC3339, from); err == nil {
			q = q.Where("created_at >= ?", t)
		}
	}
	if to := c.Query("to"); to != "" {
		if t, err := time.Parse(time.RFC3339, to); err == nil {
			q = q.Where("created_at <= ?", t)
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var rows []models.AuditLog
	if err := q.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items": rows,
		"total": total,
		"page":  page,
		"page_size": pageSize,
	})
}
