package push

import (
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"sprouts-self/backend/internal/models"
)

func userPreferredEnglish(db *gorm.DB, userID uuid.UUID) bool {
	var u models.User
	if err := db.Select("preferred_locale").First(&u, "id = ?", userID).Error; err != nil {
		return false
	}
	pl := u.PreferredLocale
	return len(pl) >= 2 && (pl == "en" || pl[:2] == "en")
}

// ResolvePushLangEN returns true when digest body should use English templates.
// messageLocale: auto (empty treated as auto), zh-CN, en, or en-* .
func ResolvePushLangEN(db *gorm.DB, userID uuid.UUID, messageLocale string) bool {
	ml := strings.TrimSpace(strings.ToLower(messageLocale))
	if ml == "" || ml == "auto" {
		return userPreferredEnglish(db, userID)
	}
	if ml == "en" || (len(ml) >= 2 && ml[:2] == "en") {
		return true
	}
	return false
}
