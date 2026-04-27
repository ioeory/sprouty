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

func pickCategoryDisplayName(locale, zh, en string) string {
	if locale == "en" && strings.TrimSpace(en) != "" {
		return en
	}
	return zh
}

// initDefaultCategoriesForLedger seeds core system categories plus optional
// expense categories (IsSystem=false, user-deletable) with keyword hints.
func initDefaultCategoriesForLedger(tx *gorm.DB, ledgerID uuid.UUID, locale string) {
	type seed struct {
		nameZh, nameEn string
		icon           string
		color          string
		kind           string
		sort           int
		system         bool
		keywords       []string
	}
	defaults := []seed{
		{
			nameZh: "餐饮", nameEn: "Dining", icon: "Utensils", color: "#FF6B6B", kind: "expense", sort: 10, system: true,
			keywords: []string{"饭", "吃", "午饭", "晚饭", "早饭", "午餐", "晚餐", "早餐", "夜宵", "咖啡", "奶茶", "外卖", "聚餐", "火锅", "水果", "零食"},
		},
		{
			nameZh: "交通", nameEn: "Transport", icon: "Car", color: "#45B7D1", kind: "expense", sort: 20, system: true,
			keywords: []string{"打车", "出租", "滴滴", "地铁", "公交", "加油", "停车", "高铁", "火车", "飞机"},
		},
		{
			nameZh: "购物", nameEn: "Shopping", icon: "ShoppingCart", color: "#96CEB4", kind: "expense", sort: 30, system: true,
			keywords: []string{"衣服", "鞋", "包", "化妆品", "电器", "家具", "百货"},
		},
		{
			nameZh: "日用", nameEn: "Groceries & daily", icon: "ShoppingBag", color: "#4ECDC4", kind: "expense", sort: 40, system: true,
			keywords: []string{"纸巾", "洗衣液", "牙膏", "日用品", "超市"},
		},
		{
			nameZh: "娱乐", nameEn: "Entertainment", icon: "Gamepad", color: "#FFEEAD", kind: "expense", sort: 50, system: true,
			keywords: []string{"电影", "游戏", "KTV", "唱K", "演唱会", "门票", "游乐"},
		},
		{
			nameZh: "工资", nameEn: "Salary", icon: "Coins", color: "#FFAD60", kind: "income", sort: 60, system: true,
			keywords: []string{"薪水", "工资", "奖金", "年终奖", "报销"},
		},
		{
			nameZh: "房租", nameEn: "Rent", icon: "Home", color: "#E17055", kind: "expense", sort: 70, system: false,
			keywords: []string{"房租", "租金", "租房", "月租", "房东", "房贷"},
		},
		{
			nameZh: "水电", nameEn: "Utilities", icon: "Zap", color: "#3498DB", kind: "expense", sort: 80, system: false,
			keywords: []string{"水电", "电费", "水费", "燃气", "物业费", "暖气"},
		},
		{
			nameZh: "数码", nameEn: "Electronics", icon: "Tv", color: "#9B59B6", kind: "expense", sort: 90, system: false,
			keywords: []string{"数码", "手机", "电脑", "平板", "耳机", "笔记本", "显示器"},
		},
		{
			nameZh: "学习", nameEn: "Education", icon: "BookOpen", color: "#1ABC9C", kind: "expense", sort: 100, system: false,
			keywords: []string{"学习", "培训", "课程", "书", "教材", "学费", "考试", "网课"},
		},
		{
			nameZh: "通信", nameEn: "Phone & internet", icon: "Wifi", color: "#2980B9", kind: "expense", sort: 110, system: false,
			keywords: []string{"话费", "流量", "宽带", "套餐", "网费", "通讯", "手机费"},
		},
		{
			nameZh: "医疗", nameEn: "Healthcare", icon: "Stethoscope", color: "#E74C3C", kind: "expense", sort: 120, system: false,
			keywords: []string{"医疗", "医院", "药店", "挂号", "体检", "药费", "牙科"},
		},
		{
			nameZh: "美容", nameEn: "Personal care", icon: "Heart", color: "#E91E63", kind: "expense", sort: 130, system: false,
			keywords: []string{"美容", "美发", "护肤", "美甲", "理发", "面膜"},
		},
		{
			nameZh: "保险", nameEn: "Insurance", icon: "PiggyBank", color: "#34495E", kind: "expense", sort: 140, system: false,
			keywords: []string{"保险", "保费", "车险", "医疗险", "人寿"},
		},
		{
			nameZh: "社交", nameEn: "Gifts & social", icon: "Gift", color: "#16A085", kind: "expense", sort: 150, system: false,
			keywords: []string{"人情", "礼金", "红包", "请客", "聚会", "应酬"},
		},
		{
			nameZh: "旅游住宿", nameEn: "Travel & stay", icon: "Plane", color: "#D35400", kind: "expense", sort: 160, system: false,
			keywords: []string{"旅游", "酒店", "民宿", "住宿", "机票", "差旅", "客栈"},
		},
	}

	for _, s := range defaults {
		cat := models.Category{
			Name: pickCategoryDisplayName(locale, s.nameZh, s.nameEn),
			Icon:      s.icon,
			Color:     s.color,
			Type:      s.kind,
			IsSystem:  s.system,
			LedgerID:  ledgerID,
			SortOrder: s.sort,
		}
		if err := tx.Create(&cat).Error; err != nil {
			continue
		}
		for _, k := range s.keywords {
			kw := strings.ToLower(strings.TrimSpace(k))
			if kw == "" {
				continue
			}
			tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.CategoryKeyword{
				CategoryID: cat.ID,
				LedgerID:   ledgerID,
				Keyword:    kw,
			})
		}
	}
}
