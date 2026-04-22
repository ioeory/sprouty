package api

import (
	"encoding/json"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// WriteAuditLog persists an audit row. actor may be nil for system events.
func WriteAuditLog(c *gin.Context, actorID *uuid.UUID, action, resourceType string, resourceID *string, meta map[string]interface{}) {
	metaJSON := ""
	if meta != nil {
		b, err := json.Marshal(meta)
		if err == nil {
			metaJSON = string(b)
		}
	}
	ip := c.ClientIP()
	ua := c.GetHeader("User-Agent")
	if len(ua) > 512 {
		ua = ua[:512]
	}
	log := models.AuditLog{
		ActorUserID:  actorID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		IP:           ip,
		UserAgent:    ua,
		Metadata:     metaJSON,
	}
	_ = service.DB.Create(&log).Error
}

// WriteAuditLogNoContext for background / no HTTP request context.
func WriteAuditLogNoContext(actorID *uuid.UUID, action, resourceType string, resourceID *string, meta map[string]interface{}) {
	metaJSON := ""
	if meta != nil {
		b, err := json.Marshal(meta)
		if err == nil {
			metaJSON = string(b)
		}
	}
	log := models.AuditLog{
		ActorUserID:  actorID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Metadata:     metaJSON,
	}
	_ = service.DB.Create(&log).Error
}

// RegistrationOpen returns whether public signup is allowed.
func RegistrationOpen() bool {
	var s models.SystemSettings
	if err := service.DB.First(&s, 1).Error; err != nil {
		return true
	}
	return s.RegistrationOpen
}
