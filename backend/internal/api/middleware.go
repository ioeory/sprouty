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
	"gorm.io/gorm"
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
		var u models.User
		if err := service.DB.Select("id, role, is_active").First(&u, "id = ?", uid).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error": "账号已不存在，请重新登录",
					"code":  "auth/user-not-found",
				})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "auth check failed"})
			return
		}
		if u.ID == uuid.Nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "账号已不存在，请重新登录",
				"code":  "auth/user-not-found",
			})
			return
		}
		if !u.IsActive {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "账号已禁用，请联系管理员",
				"code":  "auth/user-disabled",
			})
			return
		}

		c.Set("user_id", rawUserID)
		role := u.Role
		if role == "" {
			if r, ok := claims["role"].(string); ok && r != "" {
				role = r
			} else {
				role = "user"
			}
		}
		c.Set("role", role)
		c.Next()
	}
}

// RequireAdmin aborts unless JWT role is admin (falls back to DB if claim missing).
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		rs, _ := role.(string)
		if rs == "admin" {
			c.Next()
			return
		}
		uidStr, ok := c.Get("user_id")
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		raw, _ := uidStr.(string)
		uid, err := uuid.Parse(raw)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		var u models.User
		if err := service.DB.Select("role").First(&u, "id = ?", uid).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		if u.Role == "admin" {
			c.Set("role", "admin")
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理员权限"})
	}
}
