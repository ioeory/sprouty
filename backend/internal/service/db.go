package service

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
	"sprouts-self/backend/internal/models"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// prepareCategoryBilingualNames adds name_zh/name_en and copies legacy `name`
// into both before that column is dropped.
func prepareCategoryBilingualNames(db *gorm.DB) {
	var tbl int64
	db.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'categories'`).Scan(&tbl)
	if tbl == 0 {
		return
	}
	if err := db.Exec(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_zh varchar(128) NOT NULL DEFAULT ''`).Error; err != nil {
		log.Printf("prepareCategoryBilingualNames add name_zh: %v", err)
	}
	if err := db.Exec(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_en varchar(128) NOT NULL DEFAULT ''`).Error; err != nil {
		log.Printf("prepareCategoryBilingualNames add name_en: %v", err)
	}
	var hasLegacy bool
	db.Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'name')`).Scan(&hasLegacy)
	if !hasLegacy {
		return
	}
	if err := db.Exec(`UPDATE categories SET name_zh = BTRIM(name::text), name_en = BTRIM(name::text) WHERE name IS NOT NULL AND LENGTH(BTRIM(name::text)) > 0`).Error; err != nil {
		log.Printf("prepareCategoryBilingualNames copy name -> zh/en: %v", err)
	}
}

func dropLegacyCategoryNameColumn() {
	var tbl int64
	DB.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'categories'`).Scan(&tbl)
	if tbl == 0 {
		return
	}
	var hasLegacy bool
	DB.Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'name')`).Scan(&hasLegacy)
	if !hasLegacy {
		return
	}
	if err := DB.Migrator().DropColumn(&models.Category{}, "name"); err != nil {
		log.Printf("drop legacy categories.name (migrator): %v", err)
		_ = DB.Exec(`ALTER TABLE categories DROP COLUMN IF EXISTS name`).Error
	}
}

// BackfillEnglishCategoryNames sets name_en from seed catalog where name_zh matches,
// only for rows that still have no English label (does not overwrite user edits).
func BackfillEnglishCategoryNames() {
	for _, s := range ledgerCategorySeeds {
		if err := DB.Model(&models.Category{}).
			Where("deleted_at IS NULL AND type = ? AND sort_order = ? AND is_system = ? AND name_zh = ? AND BTRIM(COALESCE(name_en, '')) = ''",
				s.kind, s.sort, s.system, s.nameZh).
			Update("name_en", s.nameEn).Error; err != nil {
			log.Printf("BackfillEnglishCategoryNames %s: %v", s.nameZh, err)
		}
	}
}

// prepareCategoryKeywordMigration adds keyword_zh / keyword_en on upgrades and
// copies legacy `keyword` into both sides before the column is dropped.
func prepareCategoryKeywordMigration(db *gorm.DB) {
	var tbl int64
	db.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'category_keywords'`).Scan(&tbl)
	if tbl == 0 {
		return
	}
	if err := db.Exec(`ALTER TABLE category_keywords ADD COLUMN IF NOT EXISTS keyword_zh varchar(64) NOT NULL DEFAULT ''`).Error; err != nil {
		log.Printf("prepareCategoryKeywordMigration add keyword_zh: %v", err)
	}
	if err := db.Exec(`ALTER TABLE category_keywords ADD COLUMN IF NOT EXISTS keyword_en varchar(64) NOT NULL DEFAULT ''`).Error; err != nil {
		log.Printf("prepareCategoryKeywordMigration add keyword_en: %v", err)
	}
	var hasLegacy bool
	db.Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'category_keywords' AND column_name = 'keyword')`).Scan(&hasLegacy)
	if !hasLegacy {
		return
	}
	if err := db.Exec(`UPDATE category_keywords SET keyword_zh = LOWER(TRIM(keyword::text)), keyword_en = LOWER(TRIM(keyword::text)) WHERE keyword IS NOT NULL AND LENGTH(BTRIM(keyword::text)) > 0`).Error; err != nil {
		log.Printf("prepareCategoryKeywordMigration copy keyword -> zh/en: %v", err)
	}
}

// ensureCommonLeafKeywordCai inserts keyword_zh「菜」on the default dining category
// (system expense, sort_order=10) when the ledger has no such keyword yet.
// Telegram users often type a single 菜; L4 resolves it against longer keywords like 蔬菜.
func ensureCommonLeafKeywordCai() {
	const leaf = "菜"
	var ledgerIDs []uuid.UUID
	if err := DB.Model(&models.Ledger{}).Pluck("id", &ledgerIDs).Error; err != nil {
		log.Printf("ensureCommonLeafKeywordCai: %v", err)
		return
	}
	for _, lid := range ledgerIDs {
		var n int64
		DB.Model(&models.CategoryKeyword{}).
			Where("ledger_id = ? AND deleted_at IS NULL AND keyword_zh = ?", lid, leaf).
			Count(&n)
		if n > 0 {
			continue
		}
		var cat models.Category
		err := DB.Where("ledger_id = ? AND type = ? AND is_system = ? AND sort_order = ? AND deleted_at IS NULL",
			lid, "expense", true, 10).First(&cat).Error
		if err != nil {
			continue
		}
		kw := models.CategoryKeyword{
			CategoryID: cat.ID,
			LedgerID:   lid,
			KeywordZh:  leaf,
			KeywordEn:  "",
		}
		if err := DB.Create(&kw).Error; err != nil {
			log.Printf("ensureCommonLeafKeywordCai ledger %s: %v", lid, err)
		}
	}
}

func dropLegacyCategoryKeywordColumn() {
	var tbl int64
	DB.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'category_keywords'`).Scan(&tbl)
	if tbl == 0 {
		return
	}
	var hasLegacy bool
	DB.Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'category_keywords' AND column_name = 'keyword')`).Scan(&hasLegacy)
	if !hasLegacy {
		return
	}
	if err := DB.Migrator().DropColumn(&models.CategoryKeyword{}, "keyword"); err != nil {
		log.Printf("drop legacy category_keywords.keyword (migrator): %v", err)
		_ = DB.Exec(`ALTER TABLE category_keywords DROP COLUMN IF EXISTS keyword`).Error
	}
}

// gormSlowThreshold returns how long a query must run before GORM logs it as slow.
// Default 500ms; remote Postgres (Docker → cloud) often exceeds 200ms for trivial updates.
func gormSlowThreshold() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GORM_SLOW_THRESHOLD_MS"))
	if raw == "" {
		return 500 * time.Millisecond
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms < 0 {
		return 500 * time.Millisecond
	}
	return time.Duration(ms) * time.Millisecond
}

func configureSQLPool(gdb *gorm.DB) {
	sqlDB, err := gdb.DB()
	if err != nil {
		log.Printf("configureSQLPool: %v", err)
		return
	}
	maxOpen := 25
	if v := strings.TrimSpace(os.Getenv("DB_MAX_OPEN_CONNS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxOpen = n
		}
	}
	maxIdle := 5
	if v := strings.TrimSpace(os.Getenv("DB_MAX_IDLE_CONNS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			maxIdle = n
		}
	}
	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(time.Hour)
}

func InitDB() {
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=Asia/Shanghai",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"),
		os.Getenv("DB_PORT"),
	)

	gormLogger := logger.New(log.New(os.Stdout, "\r\n", log.LstdFlags), logger.Config{
		SlowThreshold:             gormSlowThreshold(),
		LogLevel:                  logger.Warn,
		IgnoreRecordNotFoundError: true,
		Colorful:                  false,
	})

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormLogger,
	})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	configureSQLPool(db)

	// Legacy categories.name -> name_zh/name_en; legacy category_keywords.keyword -> zh/en.
	prepareCategoryBilingualNames(db)
	prepareCategoryKeywordMigration(db)

	// Auto Migration
	err = db.AutoMigrate(
		&models.User{},
		&models.Ledger{},
		&models.LedgerUser{},
		&models.Category{},
		&models.CategoryKeyword{},
		&models.LedgerKeyword{},
		&models.Project{},
		&models.Transaction{},
		&models.Budget{},
		&models.UserConnection{},
		&models.BindingSession{},
		&models.LedgerInvite{},
		&models.LedgerFamilyLink{},
		&models.Tag{},
		&models.TransactionTag{},
		&models.SystemSettings{},
		&models.AuditLog{},
		&models.OIDCExchange{},
		&models.PushNotificationSetting{},
	)
	if err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	DB = db
	ensureLedgerUsersMemberRole()
	dropLegacyCategoryNameColumn()
	dropLegacyCategoryKeywordColumn()
	ensurePasswordNullable()
	ensureUUIDColumns()
	backfillBudgetScope()
	ensureKeywordIndexes()
	ensureOIDCUserIndexes()
	backfillCategoryDefaults()
	backfillOptionalExpenseCategories()
	BackfillEnglishCategoryNames()
	ensureCommonLeafKeywordCai()
	ensureSystemSettingsRow()
	ensureRegistrationOpenWhenNoUsers()
	backfillSingleUserAdmin()
	ensureAtLeastOneAdmin()
	ensurePushSubscriptionMultiRow()
	fmt.Println("Database connection established and migrated.")
}

// ensurePushSubscriptionMultiRow drops the legacy unique index on user_id so each user
// can have multiple push subscriptions. GORM may have created different names across versions.
func ensurePushSubscriptionMultiRow() {
	for _, stmt := range []string{
		`DROP INDEX IF EXISTS idx_push_notification_settings_user_id`,
		`ALTER TABLE push_notification_settings DROP CONSTRAINT IF EXISTS uni_push_notification_settings_user_id`,
		`ALTER TABLE push_notification_settings DROP CONSTRAINT IF EXISTS push_notification_settings_user_id_key`,
	} {
		if err := DB.Exec(stmt).Error; err != nil {
			log.Printf("ensurePushSubscriptionMultiRow: %v", err)
		}
	}
}

// ensureLedgerUsersMemberRole adds member_role for per-ledger access display (editor | viewer).
func ensureLedgerUsersMemberRole() {
	var tbl int64
	DB.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ledger_users'`).Scan(&tbl)
	if tbl == 0 {
		return
	}
	if err := DB.Exec(`ALTER TABLE ledger_users ADD COLUMN IF NOT EXISTS member_role varchar(16) NOT NULL DEFAULT 'editor'`).Error; err != nil {
		log.Printf("ensureLedgerUsersMemberRole: %v", err)
	}
}

// ensurePasswordNullable allows NULL password for OIDC-only users (legacy NOT NULL column).
func ensurePasswordNullable() {
	if err := DB.Exec(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`).Error; err != nil {
		// already nullable or table missing — ignore
		log.Printf("ensurePasswordNullable (may be no-op): %v", err)
	}
}

func ensureSystemSettingsRow() {
	var n int64
	DB.Model(&models.SystemSettings{}).Where("id = ?", 1).Count(&n)
	if n > 0 {
		return
	}
	var cnt int64
	DB.Model(&models.User{}).Count(&cnt)
	regOpen := true
	if cnt > 0 {
		// Legacy DB already had users before system_settings existed — lock public signup.
		regOpen = false
	}
	DB.Create(&models.SystemSettings{ID: 1, RegistrationOpen: regOpen})
}

// ensureRegistrationOpenWhenNoUsers forces public signup on when there are zero
// users, so a brand-new volume / first boot can always create the bootstrap admin.
// Also repairs bad state (e.g. registration_open=false with no users).
func ensureRegistrationOpenWhenNoUsers() {
	var cnt int64
	if err := DB.Model(&models.User{}).Count(&cnt).Error; err != nil {
		log.Printf("ensureRegistrationOpenWhenNoUsers count: %v", err)
		return
	}
	if cnt > 0 {
		return
	}
	if err := DB.Model(&models.SystemSettings{}).Where("id = ?", 1).Update("registration_open", true).Error; err != nil {
		log.Printf("ensureRegistrationOpenWhenNoUsers update: %v", err)
	}
}

// backfillSingleUserAdmin promotes the sole legacy user to admin (solo installs).
func backfillSingleUserAdmin() {
	var cnt int64
	DB.Model(&models.User{}).Count(&cnt)
	if cnt != 1 {
		return
	}
	var u models.User
	if err := DB.First(&u).Error; err != nil {
		return
	}
	if u.Role == "" || u.Role == "user" {
		DB.Model(&u).Update("role", "admin")
	}
}

// ensureAtLeastOneAdmin promotes a user when the DB has accounts but none with
// role admin (legacy installs before admin roles). Prefer BOOTSTRAP_ADMIN_USERNAME
// when set; otherwise the oldest user by created_at.
func ensureAtLeastOneAdmin() {
	var adminCount int64
	if err := DB.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount).Error; err != nil {
		log.Printf("ensureAtLeastOneAdmin count: %v", err)
		return
	}
	if adminCount > 0 {
		return
	}
	bootstrap := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_USERNAME"))
	var u models.User
	if bootstrap != "" {
		if err := DB.Where("username = ?", bootstrap).First(&u).Error; err == nil {
			if err := DB.Model(&u).Update("role", "admin").Error; err != nil {
				log.Printf("ensureAtLeastOneAdmin bootstrap update: %v", err)
				return
			}
			log.Printf("ensureAtLeastOneAdmin: promoted %q (BOOTSTRAP_ADMIN_USERNAME)", u.Username)
			return
		}
		log.Printf("ensureAtLeastOneAdmin: BOOTSTRAP_ADMIN_USERNAME=%q not found, using oldest user", bootstrap)
	}
	if err := DB.Order("created_at ASC").First(&u).Error; err != nil {
		return
	}
	if err := DB.Model(&u).Update("role", "admin").Error; err != nil {
		log.Printf("ensureAtLeastOneAdmin oldest update: %v", err)
		return
	}
	log.Printf("ensureAtLeastOneAdmin: promoted oldest user %q to admin", u.Username)
}

func ensureOIDCUserIndexes() {
	stmt := `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oidc_issuer_subject
	 ON users (oidc_issuer, oidc_subject)
	 WHERE oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL AND deleted_at IS NULL`
	if err := DB.Exec(stmt).Error; err != nil {
		log.Printf("ensureOIDCUserIndexes: %v", err)
	}
}

// ensureUUIDColumns rewrites legacy text foreign-key columns to proper uuid
// so that joins (text = uuid) stop failing under Postgres. Idempotent: it
// queries information_schema and only ALTERs columns that are still text.
func ensureUUIDColumns() {
	targets := []struct {
		table  string
		column string
	}{
		{"ledgers", "owner_id"},
		{"categories", "ledger_id"},
		{"projects", "ledger_id"},
		{"transactions", "category_id"},
		{"transactions", "ledger_id"},
		{"transactions", "user_id"},
		{"transactions", "project_id"},
		{"budgets", "ledger_id"},
		{"budgets", "category_id"},
		{"budgets", "project_id"},
		{"category_keywords", "category_id"},
		{"category_keywords", "ledger_id"},
		{"ledger_keywords", "ledger_id"},
		{"ledger_keywords", "user_id"},
		{"tags", "ledger_id"},
		{"transaction_tags", "transaction_id"},
		{"transaction_tags", "tag_id"},
	}
	for _, t := range targets {
		var dataType string
		row := DB.Raw(
			`SELECT data_type FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
			t.table, t.column,
		).Row()
		if err := row.Scan(&dataType); err != nil {
			continue // column doesn't exist yet or table missing; skip
		}
		if dataType == "uuid" {
			continue
		}
		// Convert text -> uuid, treating blank strings as NULL to avoid cast errors.
		stmt := fmt.Sprintf(
			`ALTER TABLE %s ALTER COLUMN %s TYPE uuid USING NULLIF(%s, '')::uuid`,
			t.table, t.column, t.column,
		)
		if err := DB.Exec(stmt).Error; err != nil {
			log.Printf("migrate %s.%s -> uuid failed: %v", t.table, t.column, err)
		} else {
			log.Printf("migrated %s.%s from %s to uuid", t.table, t.column, dataType)
		}
	}
}

// backfillBudgetScope populates budgets.scope for rows migrated from the old schema.
// Safe to run repeatedly; only touches rows where scope is empty.
func backfillBudgetScope() {
	DB.Exec(`UPDATE budgets SET scope = 'ledger_total' WHERE (scope IS NULL OR scope = '') AND category_id IS NULL AND project_id IS NULL`)
	DB.Exec(`UPDATE budgets SET scope = 'category'     WHERE (scope IS NULL OR scope = '') AND category_id IS NOT NULL`)
	DB.Exec(`UPDATE budgets SET scope = 'project_total'   WHERE (scope IS NULL OR scope = '') AND project_id IS NOT NULL AND (year_month IS NULL OR year_month = '')`)
	DB.Exec(`UPDATE budgets SET scope = 'project_monthly' WHERE (scope IS NULL OR scope = '') AND project_id IS NOT NULL AND year_month <> ''`)
	DB.Exec(`UPDATE projects SET status = 'active' WHERE status IS NULL OR status = ''`)
	DB.Exec(`UPDATE projects SET budget_mode = 'none' WHERE budget_mode IS NULL OR budget_mode = ''`)
}

// backfillCategoryDefaults is a one-time migration for users upgrading from
// the pre-keyword schema. It:
//  1. Updates sort_order on existing system categories that still carry the
//     default (100) to the canonical priorities (餐饮=10, 交通=20, …).
//  2. Seeds keyword hints for every system category missing them, scoped to
//     each ledger so cross-ledger uniqueness holds.
//
// Safe to re-run: step 1 only touches rows still at sort_order=100, step 2
// skips ledgers that already have keywords for that category.
func backfillCategoryDefaults() {
	for _, s := range ledgerCategorySeeds {
		if !s.system {
			continue
		}
		// 1. Priority: only touch rows still at the default priority so we don't
		//    clobber a user's manual tweak. Match zh or en display names.
		DB.Exec(
			`UPDATE categories SET sort_order = ? WHERE is_system = true AND (name_zh = ? OR name_en = ?) AND sort_order = 100`,
			s.sort, s.nameZh, s.nameEn,
		)

		// 2. Keywords: for each system category missing any keyword, insert the
		//    default set (merged zh + en). Gate on ledger-level existence so
		//    repeated boots don't create duplicates.
		type row struct {
			CatID    uuid.UUID
			LedgerID uuid.UUID
		}
		var todo []row
		DB.Raw(
			`SELECT c.id AS cat_id, c.ledger_id FROM categories c
			 LEFT JOIN category_keywords k ON k.category_id = c.id AND k.deleted_at IS NULL
			 WHERE c.is_system = true AND (c.name_zh = ? OR c.name_en = ?) AND c.deleted_at IS NULL
			 GROUP BY c.id, c.ledger_id
			 HAVING COUNT(k.id) = 0`,
			s.nameZh, s.nameEn,
		).Scan(&todo)

		for _, r := range todo {
			batch := categoryKeywordSeedBatch(r.CatID, r.LedgerID, s.keywordsZh, s.keywordsEn)
			if len(batch) == 0 {
				continue
			}
			if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&batch).Error; err != nil {
				log.Printf("backfill keywords insert (%s/%s): %v", s.nameZh, s.nameEn, err)
			}
		}
	}
}

// backfillOptionalExpenseCategories matches SeedDefaultLedgerCategories optional rows
// (is_system=false). Idempotent: skips ledgers that already have the category (zh or en name).
func backfillOptionalExpenseCategories() {
	var ledgerIDs []uuid.UUID
	if err := DB.Model(&models.Ledger{}).Pluck("id", &ledgerIDs).Error; err != nil {
		log.Printf("backfillOptionalExpenseCategories ledgers: %v", err)
		return
	}

	for _, lid := range ledgerIDs {
		for _, s := range ledgerCategorySeeds {
			if s.system {
				continue
			}
			var n int64
			DB.Model(&models.Category{}).
				Where("ledger_id = ? AND (name_zh = ? OR name_en = ?) AND deleted_at IS NULL", lid, s.nameZh, s.nameEn).
				Count(&n)
			if n > 0 {
				continue
			}
			cat := models.Category{
				NameZh:    s.nameZh,
				NameEn:    s.nameEn,
				Icon:      s.icon,
				Color:     s.color,
				Type:      "expense",
				IsSystem:  false,
				LedgerID:  lid,
				SortOrder: s.sort,
			}
			if err := DB.Create(&cat).Error; err != nil {
				log.Printf("backfillOptionalExpenseCategories create %s: %v", s.nameZh, err)
				continue
			}
			batch := categoryKeywordSeedBatch(cat.ID, lid, s.keywordsZh, s.keywordsEn)
			if len(batch) == 0 {
				continue
			}
			if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&batch).Error; err != nil {
				log.Printf("backfillOptionalExpenseCategories keywords %s: %v", s.nameZh, err)
			}
		}
	}
}

// ensureKeywordIndexes enforces uniqueness at the DB level:
//   - (ledger_id, keyword_zh) / (ledger_id, keyword_en) for category_keywords
//     (partial indexes, non-empty side only)
//   - (user_id, keyword) for ledger_keywords
//
// Using partial indexes that skip soft-deleted rows so re-creating a keyword
// after deletion still works.
func ensureKeywordIndexes() {
	statements := []string{
		`DROP INDEX IF EXISTS uq_category_keywords_ledger_keyword`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_category_keywords_ledger_zh
		 ON category_keywords (ledger_id, keyword_zh) WHERE deleted_at IS NULL AND keyword_zh <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_category_keywords_ledger_en
		 ON category_keywords (ledger_id, keyword_en) WHERE deleted_at IS NULL AND keyword_en <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_keywords_user_keyword
		 ON ledger_keywords (user_id, keyword) WHERE deleted_at IS NULL`,
		// Tag names are case-insensitive-unique within a ledger so "差旅" and
		// "差旅 " / "差旅" (after trim) don't coexist.
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_ledger_name_lower
		 ON tags (ledger_id, LOWER(name)) WHERE deleted_at IS NULL`,
	}
	for _, s := range statements {
		if err := DB.Exec(s).Error; err != nil {
			log.Printf("ensure keyword index failed: %v", err)
		}
	}
}
