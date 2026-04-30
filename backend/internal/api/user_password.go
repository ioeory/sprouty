package api

import (
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type putUserPasswordReq struct {
	CurrentPassword *string `json:"current_password"`
	NewPassword     string  `json:"new_password" binding:"required,min=6"`
}

// PutUserPassword allows a signed-in user to set or change their password.
// OIDC-only users (no password): omit current_password to set an initial password.
func PutUserPassword(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var req putUserPasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.NewPassword = strings.TrimSpace(req.NewPassword)
	if len(req.NewPassword) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new_password must be at least 6 characters"})
		return
	}

	var user models.User
	if err := service.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	hasPassword := user.Password != nil && strings.TrimSpace(*user.Password) != ""
	if hasPassword {
		if req.CurrentPassword == nil || strings.TrimSpace(*req.CurrentPassword) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "current_password is required"})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(*user.Password), []byte(*req.CurrentPassword)); err != nil {
			WriteAuditLog(c, &userID, "auth.password_change_failed", "user", strPtr(userID.String()), map[string]interface{}{
				"reason": "bad_current_password",
			})
			c.JSON(http.StatusForbidden, gin.H{"error": "current password is incorrect"})
			return
		}
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "hash failed"})
		return
	}
	pw := string(hashed)
	if err := service.DB.Model(&user).Update("password", pw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	WriteAuditLog(c, &userID, "user.password_change", "user", strPtr(userID.String()), map[string]interface{}{
		"had_password": hasPassword,
	})

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
