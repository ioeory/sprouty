package api

import (
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
)

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

// Register handler
func Register(c *gin.Context) {
	var req RegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if user exists
	var existingUser models.User
	if err := service.DB.Where("username = ?", req.Username).First(&existingUser).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "User already exists"})
		return
	}

	// Hash password
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)

	// Handle optional email
	var emailPtr *string
	if req.Email != "" {
		emailPtr = &req.Email
	}

	// Construct the objects first
	user := models.User{
		Username: req.Username,
		Password: string(hashedPassword),
		Email:    emailPtr,
		Nickname: req.Nickname,
	}

	// 1. Create personal ledger
	// Since we haven't created the user yet, we generate the ID now to ensure consistency
	if user.ID == uuid.Nil {
		user.ID = uuid.New()
	}

	personalLedger := models.Ledger{
		Name:    "我的账本",
		OwnerID: user.ID,
		Type:    "personal",
	}

	// Use Transaction for complete lifecycle
	err := service.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Save user and let GORM handle dependencies? 
		// Actually, let's create the objects explicitly but in correct order
		if err := tx.Create(&user).Error; err != nil {
			return err
		}

		if err := tx.Create(&personalLedger).Error; err != nil {
			return err
		}

		// 3. Link them in the join table
		// Manually inserting into the join table to be absolutely certain and avoid GORM magic issues
		if err := tx.Exec("INSERT INTO ledger_users (user_id, ledger_id) VALUES (?, ?)", user.ID, personalLedger.ID).Error; err != nil {
			return err
		}

		// 4. Categories
		initDefaultCategoriesForLedger(tx, personalLedger.ID)

		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Registration failure: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "User registered successfully", "user_id": user.ID})
}

func Login(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := service.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"exp":     time.Now().Add(time.Hour * 72).Unix(),
	})

	tokenString, err := token.SignedString([]byte(os.Getenv("JWT_SECRET")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"nickname": user.Nickname,
		},
	})
}

// initDefaultCategoriesForLedger seeds six common categories along with a
// curated keyword set used by the bot / quick-record parser.
// SortOrder controls resolution priority when multiple categories match the
// same hint (lower = earlier).
func initDefaultCategoriesForLedger(tx *gorm.DB, ledgerID uuid.UUID) {
	type seed struct {
		name     string
		icon     string
		color    string
		kind     string
		sort     int
		keywords []string
	}
	defaults := []seed{
		{
			name: "餐饮", icon: "Utensils", color: "#FF6B6B", kind: "expense", sort: 10,
			keywords: []string{"饭", "吃", "午饭", "晚饭", "早饭", "午餐", "晚餐", "早餐", "夜宵", "咖啡", "奶茶", "外卖", "聚餐", "火锅", "水果", "零食"},
		},
		{
			name: "交通", icon: "Car", color: "#45B7D1", kind: "expense", sort: 20,
			keywords: []string{"打车", "出租", "滴滴", "地铁", "公交", "加油", "停车", "高铁", "火车", "飞机"},
		},
		{
			name: "购物", icon: "ShoppingCart", color: "#96CEB4", kind: "expense", sort: 30,
			keywords: []string{"衣服", "鞋", "包", "化妆品", "电器", "数码", "家具"},
		},
		{
			name: "日用", icon: "ShoppingBag", color: "#4ECDC4", kind: "expense", sort: 40,
			keywords: []string{"纸巾", "洗衣液", "牙膏", "日用品", "超市"},
		},
		{
			name: "娱乐", icon: "Gamepad", color: "#FFEEAD", kind: "expense", sort: 50,
			keywords: []string{"电影", "游戏", "KTV", "唱K", "演唱会", "旅游", "门票"},
		},
		{
			name: "工资", icon: "Coins", color: "#FFAD60", kind: "income", sort: 60,
			keywords: []string{"薪水", "工资", "奖金", "年终奖", "报销"},
		},
	}

	for _, s := range defaults {
		cat := models.Category{
			Name:      s.name,
			Icon:      s.icon,
			Color:     s.color,
			Type:      s.kind,
			IsSystem:  true,
			LedgerID:  ledgerID,
			SortOrder: s.sort,
		}
		if err := tx.Create(&cat).Error; err != nil {
			continue
		}
		for _, k := range s.keywords {
			tx.Create(&models.CategoryKeyword{
				CategoryID: cat.ID,
				LedgerID:   ledgerID,
				Keyword:    strings.ToLower(strings.TrimSpace(k)),
			})
		}
	}
}
