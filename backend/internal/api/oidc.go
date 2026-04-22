package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errOIDCRegistrationClosed = errors.New("registration closed for new OIDC users")

const oidcStateCookie = "oidc_state"

func oidcConfigured() bool {
	return strings.TrimSpace(os.Getenv("OIDC_ISSUER")) != "" &&
		strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")) != "" &&
		strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URI")) != ""
}

// OIDCConfig exposes whether SSO is configured (public).
func OIDCConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"configured": oidcConfigured()})
}

// OIDCLogin redirects to the IdP authorization endpoint.
func OIDCLogin(c *gin.Context) {
	if !oidcConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OIDC 未配置"})
		return
	}
	ctx := context.Background()
	issuer := strings.TrimRight(strings.TrimSpace(os.Getenv("OIDC_ISSUER")), "/")
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "OIDC provider: " + err.Error()})
		return
	}

	clientID := os.Getenv("OIDC_CLIENT_ID")
	secret := os.Getenv("OIDC_CLIENT_SECRET")
	redirect := os.Getenv("OIDC_REDIRECT_URI")
	scopes := strings.Fields(os.Getenv("OIDC_SCOPES"))
	if len(scopes) == 0 {
		scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}

	oauth2Cfg := oauth2.Config{
		ClientID:     clientID,
		ClientSecret: secret,
		RedirectURL:  redirect,
		Endpoint:     provider.Endpoint(),
		Scopes:       scopes,
	}

	state := randomState()
	// 10 minutes; Path=/ so callback on same host receives it
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(oidcStateCookie, state, 600, "/", "", false, true)

	url := oauth2Cfg.AuthCodeURL(state, oauth2.AccessTypeOffline)
	c.Redirect(http.StatusFound, url)
}

// OIDCCallback handles redirect from IdP, issues one-time exchange code.
func OIDCCallback(c *gin.Context) {
	if !oidcConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OIDC 未配置"})
		return
	}
	stateCookie, err := c.Cookie(oidcStateCookie)
	if err != nil || stateCookie == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing state cookie"})
		return
	}
	c.SetCookie(oidcStateCookie, "", -1, "/", "", false, true)

	if c.Query("state") != stateCookie {
		c.JSON(http.StatusBadRequest, gin.H{"error": "state mismatch"})
		return
	}
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing code", "detail": c.Query("error")})
		return
	}

	ctx := context.Background()
	issuer := strings.TrimRight(strings.TrimSpace(os.Getenv("OIDC_ISSUER")), "/")
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	oauth2Cfg := oauth2.Config{
		ClientID:     os.Getenv("OIDC_CLIENT_ID"),
		ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("OIDC_REDIRECT_URI"),
		Endpoint:     provider.Endpoint(),
		Scopes:       strings.Fields(os.Getenv("OIDC_SCOPES")),
	}
	if len(oauth2Cfg.Scopes) == 0 {
		oauth2Cfg.Scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}

	tok, err := oauth2Cfg.Exchange(ctx, code)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token exchange: " + err.Error()})
		return
	}

	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id_token missing in response"})
		return
	}

	verifier := provider.Verifier(&oidc.Config{ClientID: oauth2Cfg.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "id_token invalid: " + err.Error()})
		return
	}

	var claims struct {
		Iss   string `json:"iss"`
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "claims: " + err.Error()})
		return
	}

	iss := claims.Iss
	if iss == "" {
		iss = issuer
	}

	user, err := findOrCreateOIDCUser(c, iss, claims.Sub, claims.Email, claims.Name)
	if err != nil {
		if errors.Is(err, errOIDCRegistrationClosed) {
			c.JSON(http.StatusForbidden, gin.H{"error": "未开放新用户注册，请联系管理员"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ex := randomState()
	row := models.OIDCExchange{
		Code:      ex,
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}
	if err := service.DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "exchange store failed"})
		return
	}

	WriteAuditLog(c, &user.ID, "auth.oidc_login", "user", strPtr(user.ID.String()), map[string]interface{}{
		"issuer": iss,
	})

	base := strings.TrimRight(os.Getenv("FRONTEND_BASE_URL"), "/")
	if base == "" {
		base = "http://localhost:4000"
	}
	redir := base + "/login?exchange=" + ex
	c.Redirect(http.StatusFound, redir)
}

func findOrCreateOIDCUser(c *gin.Context, iss, sub, email, displayName string) (*models.User, error) {
	var existing models.User
	err := service.DB.Where("oidc_issuer = ? AND oidc_subject = ?", iss, sub).First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	return createOIDCUserInTx(c, iss, sub, email, displayName)
}

func createOIDCUserInTx(c *gin.Context, iss, sub, email, displayName string) (*models.User, error) {
	var out *models.User
	err := service.DB.Transaction(func(tx *gorm.DB) error {
		var sys models.SystemSettings
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&sys, 1).Error; err != nil {
			return err
		}

		var cnt int64
		if err := tx.Model(&models.User{}).Count(&cnt).Error; err != nil {
			return err
		}
		isFirst := cnt == 0
		if !isFirst && !sys.RegistrationOpen {
			return errOIDCRegistrationClosed
		}

		uname, err := pickOIDCUsername(tx, email, sub)
		if err != nil {
			return err
		}

		u := models.User{
			Username:    uname,
			Password:    nil,
			Nickname:    displayName,
			Role:        "user",
			OIDCIssuer:  &iss,
			OIDCSubject: &sub,
		}
		if isFirst {
			u.Role = "admin"
		}
		if email != "" {
			e := email
			u.Email = &e
		}
		if strings.TrimSpace(u.Nickname) == "" {
			u.Nickname = uname
		}
		if u.ID == uuid.Nil {
			u.ID = uuid.New()
		}

		if err := tx.Create(&u).Error; err != nil {
			return err
		}

		ledger := models.Ledger{
			Name:    "我的账本",
			OwnerID: u.ID,
			Type:    "personal",
		}
		if err := bootstrapPersonalLedgerForUser(tx, u.ID, &ledger); err != nil {
			return err
		}

		if isFirst {
			if err := tx.Model(&models.SystemSettings{}).Where("id = ?", 1).Update("registration_open", false).Error; err != nil {
				return err
			}
		}

		out = &u
		return nil
	})
	if err != nil {
		return nil, err
	}
	WriteAuditLog(c, &out.ID, "auth.register_oidc", "user", strPtr(out.ID.String()), map[string]interface{}{
		"username": out.Username, "role": out.Role,
	})
	return out, nil
}

func pickOIDCUsername(tx *gorm.DB, email, sub string) (string, error) {
	base := "oidc"
	if email != "" {
		p := strings.Split(email, "@")[0]
		p = strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
				return r
			}
			return '_'
		}, p)
		if len(p) > 2 {
			base = strings.ToLower(p)
		}
	}
	if len(base) > 32 {
		base = base[:32]
	}
	for i := 0; i < 50; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s_%d", base, i)
		}
		var n int64
		tx.Model(&models.User{}).Where("username = ?", candidate).Count(&n)
		if n == 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not allocate username")
}

func randomState() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type oidcExchangeReq struct {
	Code string `json:"code" binding:"required"`
}

// OIDCExchange swaps a short-lived code from the OIDC callback redirect for an app JWT.
func OIDCExchange(c *gin.Context) {
	var req oidcExchangeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	service.DB.Where("expires_at < ?", time.Now()).Delete(&models.OIDCExchange{})

	var row models.OIDCExchange
	if err := service.DB.Where("code = ?", req.Code).First(&row).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "无效或已过期的登录凭证"})
		return
	}
	if time.Now().After(row.ExpiresAt) {
		service.DB.Delete(&row)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "登录凭证已过期"})
		return
	}

	var user models.User
	if err := service.DB.First(&user, "id = ?", row.UserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user missing"})
		return
	}
	service.DB.Delete(&row)

	tokenString, err := SignAppJWT(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": tokenString, "user": userJSON(&user)})
}
