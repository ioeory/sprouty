package api

import (
	"net/http"
	"strings"

	"sprouts-self/backend/internal/i18n"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
)

type putLocaleReq struct {
	PreferredLocale string `json:"preferred_locale" binding:"required"`
}

// PutUserLocale updates the signed-in user's preferred UI locale.
func PutUserLocale(c *gin.Context) {
	userID := c.MustGet("user_id").(string)
	var req putLocaleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	loc := strings.TrimSpace(req.PreferredLocale)
	if loc != "en" && loc != "zh-CN" {
		c.JSON(http.StatusBadRequest, ErrorJSON(c, "user.locale_invalid"))
		return
	}
	if err := service.DB.Model(&models.User{}).Where("id = ?", userID).Update("preferred_locale", loc).Error; err != nil {
		c.JSON(http.StatusInternalServerError, ErrorJSON(c, "common.internal_error"))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"preferred_locale": loc,
		"message":          i18n.T(Locale(c), "user.locale_updated"),
	})
}
