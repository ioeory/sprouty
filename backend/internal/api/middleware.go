package api

import (
	"net/http"
	"os"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization format"})
			return
		}

		tokenString := parts[1]
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("JWT_SECRET")), nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
		}

		claims, _ := token.Claims.(jwt.MapClaims)
		rawUserID, _ := claims["user_id"].(string)

		// Extra guard: the token signature can still verify after the
		// underlying user has been deleted (e.g. DB reset, manual cleanup).
		// Without this check, downstream handlers that write to
		// `ledger_users` / `transactions` would fail with confusing FK errors
		// (SQLSTATE 23503). Short-circuiting here returns a clean 401 so the
		// frontend auto-redirects to the login page.
		uid, err := uuid.Parse(rawUserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "malformed user id in token",
				"code":  "auth/invalid-subject",
			})
			return
		}
		var count int64
		if err := service.DB.Model(&models.User{}).Where("id = ?", uid).Count(&count).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "auth check failed"})
			return
		}
		if count == 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "账号已不存在，请重新登录",
				"code":  "auth/user-not-found",
			})
			return
		}

		c.Set("user_id", rawUserID)
		c.Next()
	}
}
