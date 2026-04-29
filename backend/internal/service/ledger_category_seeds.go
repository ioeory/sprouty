package service

import (
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sprouts-self/backend/internal/models"
)

// ledgerCatSeed is the single source for default ledger categories + bilingual
// quick-entry keywords (Telegram / one-line logging). English UI ledgers still
// get Chinese hints plus English aliases so both languages resolve.
type ledgerCatSeed struct {
	nameZh, nameEn string
	icon, color    string
	kind           string
	sort           int
	system         bool
	keywordsZh     []string
	keywordsEn     []string
}

// PickCategoryDisplayName mirrors the former api.pickCategoryDisplayName.
func PickCategoryDisplayName(locale, zh, en string) string {
	if locale == "en" && strings.TrimSpace(en) != "" {
		return en
	}
	return zh
}

func mergeDedupeKeywords(zh, en []string) []string {
	seen := make(map[string]struct{}, len(zh)+len(en))
	out := make([]string, 0, len(zh)+len(en))
	for _, part := range [][]string{zh, en} {
		for _, w := range part {
			k := strings.ToLower(strings.TrimSpace(w))
			if k == "" {
				continue
			}
			if _, ok := seen[k]; ok {
				continue
			}
			seen[k] = struct{}{}
			out = append(out, k)
		}
	}
	return out
}

// ledgerCategorySeeds default rows for a new ledger (and for DB backfills).
var ledgerCategorySeeds = []ledgerCatSeed{
	{
		nameZh: "餐饮", nameEn: "Dining", icon: "Utensils", color: "#FF6B6B", kind: "expense", sort: 10, system: true,
		keywordsZh: []string{"饭", "吃", "午饭", "晚饭", "早饭", "午餐", "晚餐", "早餐", "夜宵", "咖啡", "奶茶", "外卖", "聚餐", "火锅", "水果", "零食", "菜", "蔬菜"},
		keywordsEn: []string{
			"lunch", "dinner", "breakfast", "brunch", "coffee", "cafe", "tea", "boba", "milk tea", "snack", "snacks",
			"restaurant", "takeaway", "takeout", "delivery", "food", "meal", "meals", "dining", "hotpot", "hot pot",
			"fruit", "fruits", "vegetable", "vegetables", "veggies", "greens", "cooking", "eat", "ate", "uber eats",
		},
	},
	{
		nameZh: "交通", nameEn: "Transport", icon: "Car", color: "#45B7D1", kind: "expense", sort: 20, system: true,
		keywordsZh: []string{"打车", "出租", "滴滴", "地铁", "公交", "加油", "停车", "高铁", "火车", "飞机"},
		keywordsEn: []string{
			"taxi", "cab", "uber", "metro", "subway", "bus", "gas", "fuel", "parking", "train", "flight", "plane",
			"driving", "rideshare", "ridesharing",
		},
	},
	{
		nameZh: "购物", nameEn: "Shopping", icon: "ShoppingCart", color: "#96CEB4", kind: "expense", sort: 30, system: true,
		keywordsZh: []string{"衣服", "鞋", "包", "化妆品", "电器", "家具", "百货"},
		keywordsEn: []string{
			"clothes", "clothing", "shoes", "bag", "purse", "makeup", "cosmetics", "electronics", "furniture",
			"mall", "shopping", "retail", "department",
		},
	},
	{
		nameZh: "日用", nameEn: "Groceries & daily", icon: "ShoppingBag", color: "#4ECDC4", kind: "expense", sort: 40, system: true,
		keywordsZh: []string{"纸巾", "洗衣液", "牙膏", "日用品", "超市"},
		keywordsEn: []string{
			"tissue", "tissues", "detergent", "toothpaste", "toiletries", "grocery", "groceries", "supermarket",
			"household", "sundries",
		},
	},
	{
		nameZh: "娱乐", nameEn: "Entertainment", icon: "Gamepad", color: "#FFEEAD", kind: "expense", sort: 50, system: true,
		keywordsZh: []string{"电影", "游戏", "KTV", "唱K", "演唱会", "门票", "游乐"},
		keywordsEn: []string{
			"movie", "cinema", "film", "game", "games", "ktv", "karaoke", "concert", "ticket", "tickets",
			"entertainment", "amusement", "show",
		},
	},
	{
		nameZh: "工资", nameEn: "Salary", icon: "Coins", color: "#FFAD60", kind: "income", sort: 60, system: true,
		keywordsZh: []string{"薪水", "工资", "奖金", "年终奖", "报销"},
		keywordsEn: []string{"salary", "wage", "wages", "bonus", "reimbursement", "reimburse", "payroll", "paycheck"},
	},
	{
		nameZh: "房租", nameEn: "Rent", icon: "Home", color: "#E17055", kind: "expense", sort: 70, system: false,
		keywordsZh: []string{"房租", "租金", "租房", "月租", "房东", "房贷"},
		keywordsEn: []string{"rent", "lease", "landlord", "mortgage", "housing"},
	},
	{
		nameZh: "水电", nameEn: "Utilities", icon: "Zap", color: "#3498DB", kind: "expense", sort: 80, system: false,
		keywordsZh: []string{"水电", "电费", "水费", "燃气", "物业费", "暖气"},
		keywordsEn: []string{"utility", "utilities", "electricity", "water bill", "gas bill", "property fee", "heating"},
	},
	{
		nameZh: "数码", nameEn: "Electronics", icon: "Tv", color: "#9B59B6", kind: "expense", sort: 90, system: false,
		keywordsZh: []string{"数码", "手机", "电脑", "平板", "耳机", "笔记本", "显示器"},
		keywordsEn: []string{"electronics", "phone", "computer", "laptop", "tablet", "headphones", "monitor", "gadget"},
	},
	{
		nameZh: "学习", nameEn: "Education", icon: "BookOpen", color: "#1ABC9C", kind: "expense", sort: 100, system: false,
		keywordsZh: []string{"学习", "培训", "课程", "书", "教材", "学费", "考试", "网课"},
		keywordsEn: []string{"study", "training", "course", "book", "tuition", "exam", "class", "textbook"},
	},
	{
		nameZh: "通信", nameEn: "Phone & internet", icon: "Wifi", color: "#2980B9", kind: "expense", sort: 110, system: false,
		keywordsZh: []string{"话费", "流量", "宽带", "套餐", "网费", "通讯", "手机费"},
		keywordsEn: []string{"phone bill", "data plan", "broadband", "internet", "mobile", "cell", "wifi"},
	},
	{
		nameZh: "医疗", nameEn: "Healthcare", icon: "Stethoscope", color: "#E74C3C", kind: "expense", sort: 120, system: false,
		keywordsZh: []string{"医疗", "医院", "药店", "挂号", "体检", "药费", "牙科"},
		keywordsEn: []string{"doctor", "hospital", "pharmacy", "medicine", "dental", "checkup", "clinic", "healthcare"},
	},
	{
		nameZh: "美容", nameEn: "Personal care", icon: "Heart", color: "#E91E63", kind: "expense", sort: 130, system: false,
		keywordsZh: []string{"美容", "美发", "护肤", "美甲", "理发", "面膜"},
		keywordsEn: []string{"salon", "haircut", "skincare", "nail", "beauty", "spa", "barber"},
	},
	{
		nameZh: "保险", nameEn: "Insurance", icon: "PiggyBank", color: "#34495E", kind: "expense", sort: 140, system: false,
		keywordsZh: []string{"保险", "保费", "车险", "医疗险", "人寿"},
		keywordsEn: []string{"insurance", "premium", "car insurance", "health insurance", "life insurance"},
	},
	{
		nameZh: "社交", nameEn: "Gifts & social", icon: "Gift", color: "#16A085", kind: "expense", sort: 150, system: false,
		keywordsZh: []string{"人情", "礼金", "红包", "请客", "聚会", "应酬"},
		keywordsEn: []string{"gift", "party", "dinner party", "networking", "gathering", "social"},
	},
	{
		nameZh: "旅游住宿", nameEn: "Travel & stay", icon: "Plane", color: "#D35400", kind: "expense", sort: 160, system: false,
		keywordsZh: []string{"旅游", "酒店", "民宿", "住宿", "机票", "差旅", "客栈"},
		keywordsEn: []string{"travel", "hotel", "hostel", "airbnb", "flight", "trip", "accommodation", "lodging"},
	},
}

// SeedDefaultLedgerCategories creates default categories and merged keywords for a ledger.
func SeedDefaultLedgerCategories(tx *gorm.DB, ledgerID uuid.UUID, locale string) {
	for _, s := range ledgerCategorySeeds {
		cat := models.Category{
			Name:      PickCategoryDisplayName(locale, s.nameZh, s.nameEn),
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
		for _, kw := range mergeDedupeKeywords(s.keywordsZh, s.keywordsEn) {
			tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.CategoryKeyword{
				CategoryID: cat.ID,
				LedgerID:   ledgerID,
				Keyword:    kw,
			})
		}
	}
}
