package service

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sprouts-self/backend/internal/models"
)

// UserCanWriteLedger returns false when the user is a ledger member with member_role
// viewer. Ledger owners always return true. Non-members return false.
func UserCanWriteLedger(db *gorm.DB, userID, ledgerID uuid.UUID) bool {
	var led models.Ledger
	if err := db.First(&led, "id = ?", ledgerID).Error; err != nil {
		return false
	}
	if led.OwnerID == userID {
		return true
	}
	var mr string
	db.Table("ledger_users").
		Select("COALESCE(NULLIF(TRIM(member_role), ''), 'editor')").
		Where("user_id = ? AND ledger_id = ?", userID, ledgerID).
		Limit(1).
		Scan(&mr)
	if mr == "" {
		return false
	}
	return mr != "viewer"
}
