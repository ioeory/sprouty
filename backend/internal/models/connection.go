package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserConnection stores associations between Sprouts users and external apps like TG/Slack
type UserConnection struct {
	gorm.Model
	UserID     uuid.UUID `gorm:"type:uuid;not null;index"`
	Platform   string    `gorm:"size:50;not null;index"` // e.g., "telegram", "feishu"
	ExternalID string    `gorm:"size:100;not null;index"` // The Chat ID or User ID from the platform
	Username   string    `gorm:"size:100"`               // External username for display
	Settings   string    `gorm:"type:text"`              // JSON string for platform-specific settings
}

// BindingSession stores temporary PIN codes for linking accounts
type BindingSession struct {
	gorm.Model
	UserID    uuid.UUID `gorm:"type:uuid;not null"`
	Code      string    `gorm:"size:6;not null;index"`
	ExpiresAt int64     `gorm:"not null"`
}

// LedgerInvite stores invitation codes for joining a shared ledger
type LedgerInvite struct {
	gorm.Model
	LedgerID  uuid.UUID `gorm:"type:uuid;not null;index"`
	Code      string    `gorm:"size:8;not null;uniqueIndex"`
	InviterID uuid.UUID `gorm:"type:uuid;not null"`
	ExpiresAt int64     `gorm:"not null"`
}
