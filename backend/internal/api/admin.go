package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
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

type adminCreateUserReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required,min=6"`
	Nickname string `json:"nickname"`
	Email    string `json:"email"`
	Role     string `json:"role"` // optional: user/admin
}

type adminUserListItem struct {
	ID        uuid.UUID `json:"id"`
	Username  string    `json:"username"`
	Nickname  string    `json:"nickname"`
	Email     *string   `json:"email"`
	Role      string    `json:"role"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
}

// AdminCreateUser creates a password user from admin panel.
func AdminCreateUser(c *gin.Context) {
	adminID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var req adminCreateUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var existing models.User
	if err := service.DB.Where("username = ?", req.Username).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "用户名已存在"})
		return
	} else if err != nil && err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "hash failed"})
		return
	}
	pw := string(hashed)

	role := req.Role
	if role == "" {
		role = "user"
	}
	if role != "user" && role != "admin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be user or admin"})
		return
	}

	var emailPtr *string
	if req.Email != "" {
		email := req.Email
		emailPtr = &email
	}

	user := models.User{
		Username: req.Username,
		Password: &pw,
		Email:    emailPtr,
		Nickname: req.Nickname,
		IsActive: true,
		Role:     role,
	}
	if user.ID == uuid.Nil {
		user.ID = uuid.New()
	}
	if user.Nickname == "" {
		user.Nickname = user.Username
	}

	personalLedger := models.Ledger{
		Name:    "我的账本",
		OwnerID: user.ID,
		Type:    "personal",
	}

	if err := service.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		return bootstrapPersonalLedgerForUser(tx, user.ID, &personalLedger)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create user failed: " + err.Error()})
		return
	}

	WriteAuditLog(c, &adminID, "admin.user_create", "user", strPtr(user.ID.String()), map[string]interface{}{
		"username": user.Username,
		"role":     user.Role,
	})
	c.JSON(http.StatusCreated, gin.H{
		"id":       user.ID,
		"username": user.Username,
		"nickname": user.Nickname,
		"is_active": user.IsActive,
		"role":     user.Role,
	})
}

// GetAdminUsers returns user list for management.
func GetAdminUsers(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("q"))
	q := service.DB.Model(&models.User{}).Order("created_at DESC")
	if keyword != "" {
		like := "%" + keyword + "%"
		q = q.Where("username ILIKE ? OR nickname ILIKE ? OR email ILIKE ?", like, like, like)
	}
	var rows []adminUserListItem
	if err := q.Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": rows})
}

type adminResetPasswordReq struct {
	NewPassword string `json:"new_password" binding:"required,min=6"`
}

// AdminResetUserPassword resets a user's password (admin only).
func AdminResetUserPassword(c *gin.Context) {
	adminID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	var req adminResetPasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := service.DB.First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
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
	WriteAuditLog(c, &adminID, "admin.user_reset_password", "user", strPtr(user.ID.String()), nil)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type adminSetUserStatusReq struct {
	IsActive *bool `json:"is_active"`
}

// AdminSetUserStatus enables/disables a user.
func AdminSetUserStatus(c *gin.Context) {
	adminID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	var req adminSetUserStatusReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.IsActive == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "is_active is required"})
		return
	}
	if uid == adminID && !*req.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能禁用当前登录管理员"})
		return
	}

	var user models.User
	if err := service.DB.First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	old := user.IsActive
	if err := service.DB.Model(&user).Update("is_active", *req.IsActive).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	WriteAuditLog(c, &adminID, "admin.user_status", "user", strPtr(user.ID.String()), map[string]interface{}{
		"from": old, "to": *req.IsActive,
	})
	c.JSON(http.StatusOK, gin.H{"id": user.ID, "is_active": *req.IsActive})
}
