package api

import (
	"errors"
	"net/http"
	"os"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errRegistrationClosed = errors.New("registration closed")

type RegisterReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required,min=6"`
	Email    string `json:"email"`
	Nickname string `json:"nickname"`
}

type LoginReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// SignAppJWT issues a JWT with user_id and role (used by password login and OIDC).
func SignAppJWT(user *models.User) (string, error) {
	role := user.Role
	if role == "" {
		role = "user"
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID.String(),
		"role":    role,
		"exp":     time.Now().Add(time.Hour * 72).Unix(),
	})
	return token.SignedString([]byte(os.Getenv("JWT_SECRET")))
}

func userJSON(user *models.User) gin.H {
	role := user.Role
	if role == "" {
		role = "user"
	}
	return gin.H{
		"id":                user.ID,
		"username":          user.Username,
		"nickname":          user.Nickname,
		"is_active":         user.IsActive,
		"role":              role,
		"preferred_locale":  strings.TrimSpace(user.PreferredLocale),
	}
}

// RegistrationStatus is public: whether the signup form should be shown.
func RegistrationStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"registration_open": RegistrationOpen()})
}

// Register handler
func Register(c *gin.Context) {
	var req RegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !RegistrationOpen() {
		WriteAuditLog(c, nil, "auth.register_denied", "settings", nil, map[string]interface{}{
			"reason": "registration_closed", "username": req.Username,
		})
		c.JSON(http.StatusForbidden, ErrorJSON(c, "auth.registration_closed"))
		return
	}

	var existingUser models.User
	if err := service.DB.Where("username = ?", req.Username).First(&existingUser).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "User already exists"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "hash failed"})
		return
	}
	pw := string(hashedPassword)

	var emailPtr *string
	if req.Email != "" {
		emailPtr = &req.Email
	}

	user := models.User{
		Username: req.Username,
		Password: &pw,
		Email:    emailPtr,
		Nickname: req.Nickname,
		IsActive: true,
		Role:     "user",
	}
	if user.ID == uuid.Nil {
		user.ID = uuid.New()
	}

	loc := Locale(c)
	personalLedger := models.Ledger{
		Name:    defaultPersonalLedgerName(loc),
		OwnerID: user.ID,
		Type:    "personal",
	}

	err = service.DB.Transaction(func(tx *gorm.DB) error {
		var sys models.SystemSettings
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&sys, 1).Error; err != nil {
			return err
		}
		if !sys.RegistrationOpen {
			return errRegistrationClosed
		}

		var cnt int64
		if err := tx.Model(&models.User{}).Count(&cnt).Error; err != nil {
			return err
		}
		isFirst := cnt == 0
		if isFirst {
			user.Role = "admin"
		}

		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		if err := bootstrapPersonalLedgerForUser(tx, user.ID, &personalLedger, loc); err != nil {
			return err
		}

		if isFirst {
			if err := tx.Model(&models.SystemSettings{}).Where("id = ?", 1).Update("registration_open", false).Error; err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		if errors.Is(err, errRegistrationClosed) {
			c.JSON(http.StatusForbidden, ErrorJSON(c, "auth.registration_closed"))
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Registration failure: " + err.Error()})
		return
	}

	WriteAuditLog(c, &user.ID, "auth.register", "user", strPtr(user.ID.String()), map[string]interface{}{
		"username": user.Username, "role": user.Role,
	})

	c.JSON(http.StatusCreated, gin.H{"message": "User registered successfully", "user_id": user.ID})
}

func strPtr(s string) *string { return &s }

func Login(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := service.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		WriteAuditLog(c, nil, "auth.login_failed", "user", nil, map[string]interface{}{
			"username": req.Username, "reason": "user_not_found",
		})
		c.JSON(http.StatusUnauthorized, ErrorJSON(c, "auth.invalid_credentials"))
		return
	}

	if user.Password == nil {
		WriteAuditLog(c, &user.ID, "auth.login_failed", "user", strPtr(user.ID.String()), map[string]interface{}{
			"reason": "oidc_only_user",
		})
		c.JSON(http.StatusUnauthorized, ErrorJSON(c, "auth.oidc_only"))
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.Password), []byte(req.Password)); err != nil {
		WriteAuditLog(c, &user.ID, "auth.login_failed", "user", strPtr(user.ID.String()), map[string]interface{}{
			"reason": "bad_password",
		})
		c.JSON(http.StatusUnauthorized, ErrorJSON(c, "auth.invalid_credentials"))
		return
	}
	if !user.IsActive {
		WriteAuditLog(c, &user.ID, "auth.login_failed", "user", strPtr(user.ID.String()), map[string]interface{}{
			"reason": "inactive_user",
		})
		c.JSON(http.StatusUnauthorized, ErrorJSON(c, "auth.account_disabled"))
		return
	}

	tokenString, err := SignAppJWT(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not generate token"})
		return
	}

	WriteAuditLog(c, &user.ID, "auth.login", "user", strPtr(user.ID.String()), nil)

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"user":  userJSON(&user),
	})
}

func defaultPersonalLedgerName(locale string) string {
	if locale == "en" {
		return "My ledger"
	}
	return "我的账本"
}

// bootstrapPersonalLedgerForUser persists the ledger row, membership, and default categories.
func bootstrapPersonalLedgerForUser(tx *gorm.DB, userID uuid.UUID, ledger *models.Ledger, locale string) error {
	if err := tx.Create(ledger).Error; err != nil {
		return err
	}
	if err := tx.Exec("INSERT INTO ledger_users (user_id, ledger_id) VALUES (?, ?)", userID, ledger.ID).Error; err != nil {
		return err
	}
	initDefaultCategoriesForLedger(tx, ledger.ID, locale)
	return nil
}

// initDefaultCategoriesForLedger seeds core system categories plus optional
// expense categories (IsSystem=false, user-deletable) with keyword hints.
func initDefaultCategoriesForLedger(tx *gorm.DB, ledgerID uuid.UUID, locale string) {
	service.SeedDefaultLedgerCategories(tx, ledgerID, locale)
}
