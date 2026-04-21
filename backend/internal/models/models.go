package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Base model with UUID
type Base struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// BeforeCreate auto-generates a UUID only when the caller hasn't already
// assigned one. The previous unconditional override silently clobbered IDs
// passed through associations (e.g. ledger_users many2many joins), producing
// orphan users and FK violations on the join table. Treat zero UUID as the
// trigger to generate, otherwise preserve whatever the caller set.
func (base *Base) BeforeCreate(tx *gorm.DB) (err error) {
	if base.ID == uuid.Nil {
		base.ID = uuid.New()
	}
	return
}

// User model
type User struct {
	Base
	Username string   `gorm:"uniqueIndex;not null" json:"username"`
	Password string   `gorm:"not null" json:"-"`
	Email    *string  `gorm:"uniqueIndex" json:"email"`
	Nickname string   `json:"nickname"`
	Avatar   string   `json:"avatar"`
	Ledgers  []Ledger `gorm:"many2many:ledger_users;" json:"ledgers"`
}

// Ledger (Shared or Personal Account Book)
type Ledger struct {
	Base
	Name    string    `gorm:"not null" json:"name"`
	OwnerID uuid.UUID `gorm:"type:uuid" json:"owner_id"`
	Type    string    `json:"type"` // "personal", "family"
	Members []User    `gorm:"many2many:ledger_users;" json:"members"`
}

// Category
type Category struct {
	Base
	Name      string    `gorm:"not null" json:"name"`
	Icon      string    `json:"icon"`
	Color     string    `json:"color"`
	Type      string    `json:"type"` // "expense", "income"
	LedgerID  uuid.UUID `gorm:"type:uuid;index" json:"ledger_id"`
	IsSystem  bool      `gorm:"default:false" json:"is_system"`
	SortOrder int       `gorm:"default:100;index" json:"sort_order"` // lower = higher priority when resolving quick-record hints
}

// CategoryKeyword powers quick-record fuzzy matching. Storing LedgerID here (in
// addition to CategoryID) lets us JOIN against `transactions` without a 3-way
// hop and enforce the "unique keyword per ledger" rule cheaply.
type CategoryKeyword struct {
	Base
	CategoryID uuid.UUID `gorm:"type:uuid;index;not null" json:"category_id"`
	LedgerID   uuid.UUID `gorm:"type:uuid;index;not null" json:"ledger_id"`
	Keyword    string    `gorm:"type:varchar(64);index;not null" json:"keyword"` // normalized to lower + trim
}

// LedgerKeyword lets a user route quick-record messages to a specific ledger
// by including a keyword in the message (e.g. "生意 午饭 20").
// Scoped per-user so shared ledgers don't fight over keyword conflicts.
type LedgerKeyword struct {
	Base
	LedgerID uuid.UUID `gorm:"type:uuid;index;not null" json:"ledger_id"`
	UserID   uuid.UUID `gorm:"type:uuid;index;not null" json:"user_id"`
	Keyword  string    `gorm:"type:varchar(64);index;not null" json:"keyword"`
}

// Project (Integration for specific events like "Trip to Japan")
type Project struct {
	Base
	Name       string     `gorm:"not null" json:"name"`
	LedgerID   uuid.UUID  `gorm:"type:uuid;index" json:"ledger_id"`
	Note       string     `json:"note"`
	Icon       string     `json:"icon"`
	Color      string     `json:"color"`
	Status     string     `gorm:"default:active" json:"status"`    // "active" | "archived"
	BudgetMode string     `gorm:"default:none" json:"budget_mode"` // "none" | "total" | "monthly"
	StartDate  *time.Time `json:"start_date"`
	EndDate    *time.Time `json:"end_date"`
}

// Transaction
type Transaction struct {
	Base
	Amount     float64    `gorm:"type:decimal(12,2);not null" json:"amount"`
	Type       string     `json:"type"` // "expense", "income", "transfer"
	CategoryID uuid.UUID  `gorm:"type:uuid;index" json:"category_id"`
	LedgerID   uuid.UUID  `gorm:"type:uuid;index" json:"ledger_id"`
	UserID     uuid.UUID  `gorm:"type:uuid;index" json:"user_id"`
	ProjectID  *uuid.UUID `gorm:"type:uuid;index" json:"project_id"`
	Note       string     `json:"note"`
	Tags       string     `json:"tags"` // Comma separated tags
	Date       time.Time  `gorm:"index" json:"date"`
}

// Budget
// Scope values:
//   "ledger_total"    - account-book monthly total budget (CategoryID & ProjectID null)
//   "category"        - monthly per-category budget (CategoryID set)
//   "project_total"   - one-shot project budget (ProjectID set, YearMonth = "")
//   "project_monthly" - monthly project budget (ProjectID set, YearMonth set)
type Budget struct {
	Base
	LedgerID   uuid.UUID  `gorm:"type:uuid;index" json:"ledger_id"`
	CategoryID *uuid.UUID `gorm:"type:uuid;index" json:"category_id"`
	ProjectID  *uuid.UUID `gorm:"type:uuid;index" json:"project_id"`
	Amount     float64    `gorm:"type:decimal(12,2);not null" json:"amount"`
	YearMonth  string     `gorm:"index" json:"year_month"` // e.g., "2024-04"; empty for one-shot totals
	Scope      string     `gorm:"index;default:ledger_total" json:"scope"`
}

// LedgerUser join table for explicit queries
type LedgerUser struct {
	UserID   uuid.UUID `gorm:"type:uuid;primaryKey"`
	LedgerID uuid.UUID `gorm:"type:uuid;primaryKey"`
}

// Tag represents a user-defined label that can be attached to any number of
// transactions. Scoped per-ledger so household members share the same palette.
//
// ExcludeFromStats drives the dashboard's "ignore these amounts" behaviour:
// when true, transactions carrying this tag are dropped from pie charts /
// summary cards by default. Users can still toggle "包含已排除" to see the
// full picture or tweak the exclusion list ad-hoc via query params.
type Tag struct {
	Base
	LedgerID         uuid.UUID `gorm:"type:uuid;index;not null" json:"ledger_id"`
	Name             string    `gorm:"type:varchar(64);not null" json:"name"`
	Color            string    `gorm:"type:varchar(16)" json:"color"`
	ExcludeFromStats bool      `gorm:"default:false;index" json:"exclude_from_stats"`
}

// TransactionTag is the many-to-many bridge between Transaction and Tag.
// Keeping an explicit model (instead of relying on gorm's inferred join)
// so we can filter on it directly in dashboard queries.
type TransactionTag struct {
	TransactionID uuid.UUID `gorm:"type:uuid;primaryKey"`
	TagID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	CreatedAt     time.Time
}
