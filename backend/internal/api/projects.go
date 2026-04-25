package api

import (
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// projectBudgetInfo describes the currently effective budget for a project.
type projectBudgetInfo struct {
	Mode      string    `json:"mode"`                 // "none" | "total" | "monthly"
	Amount    float64   `json:"amount"`               // 0 when mode=none
	YearMonth string    `json:"year_month,omitempty"` // only when mode=monthly
	LedgerID  uuid.UUID `json:"ledger_id,omitempty"`  // spending counted toward this budget cap
}

type projectSummaryOut struct {
	ID          uuid.UUID          `json:"id"`
	Name        string             `json:"name"`
	Icon        string             `json:"icon"`
	Color       string             `json:"color"`
	Status      string             `json:"status"`
	Note        string             `json:"note"`
	LedgerID    uuid.UUID          `json:"ledger_id"`
	StartDate   *time.Time         `json:"start_date"`
	EndDate     *time.Time         `json:"end_date"`
	CreatedAt   time.Time          `json:"created_at"`
	Budget      projectBudgetInfo  `json:"budget"`
	Spent       float64            `json:"spent"`      // spent within the budget window
	SpentTotal  float64            `json:"spent_total"` // lifetime spent on this project
	Remaining   float64            `json:"remaining"`
	UsagePct    float64            `json:"usage_pct"`
}

// currentYearMonth returns the current YYYY-MM string in the server's location.
func currentYearMonth() string {
	return time.Now().Format("2006-01")
}

func sumProjectExpenseInLedger(projectID, ledgerID uuid.UUID, from, to *time.Time) float64 {
	q := service.DB.Model(&models.Transaction{}).
		Where("project_id = ? AND ledger_id = ? AND type = ?", projectID, ledgerID, "expense")
	if from != nil {
		q = q.Where("date >= ?", *from)
	}
	if to != nil {
		q = q.Where("date <= ?", *to)
	}
	var s float64
	q.Select("COALESCE(SUM(amount),0)").Scan(&s)
	return s
}

// resolveBudgetLedgerID picks which ledger_id is stored on the budget row:
// explicit request wins; else keep existing row's ledger; else project's ledger.
func resolveBudgetLedgerID(p *models.Project, requested uuid.UUID, existing *models.Budget) uuid.UUID {
	if requested != uuid.Nil {
		return requested
	}
	if existing != nil && existing.LedgerID != uuid.Nil {
		return existing.LedgerID
	}
	return p.LedgerID
}

// buildProjectSummary computes the effective budget + spent numbers for a project.
func buildProjectSummary(p *models.Project) projectSummaryOut {
	out := projectSummaryOut{
		ID:        p.ID,
		Name:      p.Name,
		Icon:      p.Icon,
		Color:     p.Color,
		Status:    p.Status,
		Note:      p.Note,
		LedgerID:  p.LedgerID,
		StartDate: p.StartDate,
		EndDate:   p.EndDate,
		CreatedAt: p.CreatedAt,
		Budget:    projectBudgetInfo{Mode: "none"},
	}

	service.DB.Model(&models.Transaction{}).
		Where("project_id = ? AND type = 'expense'", p.ID).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&out.SpentTotal)

	switch p.BudgetMode {
	case "total":
		var b models.Budget
		if err := service.DB.
			Where("project_id = ? AND scope = 'project_total'", p.ID).
			First(&b).Error; err == nil {
			out.Budget = projectBudgetInfo{Mode: "total", Amount: b.Amount, LedgerID: b.LedgerID}
			out.Spent = sumProjectExpenseInLedger(p.ID, b.LedgerID, nil, nil)
		}
	case "monthly":
		ym := currentYearMonth()
		var b models.Budget
		if err := service.DB.
			Where("project_id = ? AND scope = 'project_monthly' AND year_month = ?", p.ID, ym).
			First(&b).Error; err == nil {
			out.Budget = projectBudgetInfo{Mode: "monthly", Amount: b.Amount, YearMonth: ym, LedgerID: b.LedgerID}
			firstOf, lastOf := monthRange(time.Now())
			out.Spent = sumProjectExpenseInLedger(p.ID, b.LedgerID, &firstOf, &lastOf)
		} else {
			out.Budget = projectBudgetInfo{Mode: "monthly", Amount: 0, YearMonth: ym, LedgerID: p.LedgerID}
			firstOf, lastOf := monthRange(time.Now())
			out.Spent = sumProjectExpenseInLedger(p.ID, p.LedgerID, &firstOf, &lastOf)
		}
	default:
		out.Spent = out.SpentTotal
	}

	if out.Budget.Amount > 0 {
		out.Remaining = out.Budget.Amount - out.Spent
		out.UsagePct = out.Spent / out.Budget.Amount * 100
	}
	return out
}

func monthRange(t time.Time) (time.Time, time.Time) {
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
	last := first.AddDate(0, 1, 0).Add(-time.Second)
	return first, last
}

// ListProjects GET /api/projects?ledger_id=&status=
func ListProjects(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	ledgerIDStr := c.Query("ledger_id")
	if ledgerIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ledger_id is required"})
		return
	}
	ledgerID, err := uuid.Parse(ledgerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
		return
	}
	if !userCanAccessLedger(userID, ledgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	q := service.DB.Where("ledger_id = ?", ledgerID)
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	var projects []models.Project
	q.Order("created_at DESC").Find(&projects)

	out := make([]projectSummaryOut, 0, len(projects))
	for i := range projects {
		out = append(out, buildProjectSummary(&projects[i]))
	}
	c.JSON(http.StatusOK, out)
}

type projectUpsertReq struct {
	Name             string     `json:"name" binding:"required"`
	LedgerID         uuid.UUID  `json:"ledger_id" binding:"required"`
	Icon             string     `json:"icon"`
	Color            string     `json:"color"`
	Note             string     `json:"note"`
	Status           string     `json:"status"`
	StartDate        *time.Time `json:"start_date"`
	EndDate          *time.Time `json:"end_date"`
	BudgetMode       string     `json:"budget_mode"` // none|total|monthly
	BudgetAmount     float64    `json:"budget_amount"`
	YearMonth        string     `json:"year_month"`
	BudgetLedgerID   *uuid.UUID `json:"budget_ledger_id"` // optional; which ledger counts toward project budget
}

// CreateProject POST /api/projects
func CreateProject(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var req projectUpsertReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !userCanAccessLedger(userID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}
	if req.BudgetLedgerID != nil && *req.BudgetLedgerID != uuid.Nil {
		if !userCanAccessLedger(userID, *req.BudgetLedgerID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "no access to budget ledger"})
			return
		}
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if req.BudgetMode == "" {
		req.BudgetMode = "none"
	}

	budgetReqLeg := uuid.Nil
	if req.BudgetLedgerID != nil {
		budgetReqLeg = *req.BudgetLedgerID
	}

	p := models.Project{
		Name:       req.Name,
		LedgerID:   req.LedgerID,
		Icon:       req.Icon,
		Color:      req.Color,
		Note:       req.Note,
		Status:     req.Status,
		BudgetMode: req.BudgetMode,
		StartDate:  req.StartDate,
		EndDate:    req.EndDate,
	}

	err = service.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&p).Error; err != nil {
			return err
		}
		return upsertProjectBudgetTx(tx, &p, req.BudgetMode, req.BudgetAmount, req.YearMonth, budgetReqLeg)
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create project: " + err.Error()})
		return
	}
	c.JSON(http.StatusCreated, buildProjectSummary(&p))
}

// UpdateProject PUT /api/projects/:id
func UpdateProject(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var p models.Project
	if err := service.DB.First(&p, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !userCanAccessLedger(userID, p.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	var req struct {
		Name      *string    `json:"name"`
		Icon      *string    `json:"icon"`
		Color     *string    `json:"color"`
		Note      *string    `json:"note"`
		Status    *string    `json:"status"`
		StartDate *time.Time `json:"start_date"`
		EndDate   *time.Time `json:"end_date"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name != nil {
		p.Name = *req.Name
	}
	if req.Icon != nil {
		p.Icon = *req.Icon
	}
	if req.Color != nil {
		p.Color = *req.Color
	}
	if req.Note != nil {
		p.Note = *req.Note
	}
	if req.Status != nil {
		p.Status = *req.Status
	}
	if req.StartDate != nil {
		p.StartDate = req.StartDate
	}
	if req.EndDate != nil {
		p.EndDate = req.EndDate
	}
	if err := service.DB.Save(&p).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update"})
		return
	}
	c.JSON(http.StatusOK, buildProjectSummary(&p))
}

// DeleteProject DELETE /api/projects/:id
// Detach transactions (project_id=NULL) and delete all budgets for this project.
func DeleteProject(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var p models.Project
	if err := service.DB.First(&p, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !userCanAccessLedger(userID, p.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	err = service.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("UPDATE transactions SET project_id = NULL WHERE project_id = ?", p.ID).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", p.ID).Delete(&models.Budget{}).Error; err != nil {
			return err
		}
		return tx.Delete(&p).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.Status(http.StatusNoContent)
}

// GetProjectSummary GET /api/projects/:id/summary
func GetProjectSummary(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var p models.Project
	if err := service.DB.First(&p, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !userCanAccessLedger(userID, p.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	sum := buildProjectSummary(&p)

	// Category breakdown for this project (lifetime)
	type CatStat struct {
		Name  string  `json:"name"`
		Value float64 `json:"value"`
		Color string  `json:"color"`
	}
	catStats := []CatStat{}
	catQ := service.DB.Model(&models.Transaction{}).
		Select("categories.name as name, SUM(transactions.amount) as value, categories.color as color").
		Joins("JOIN categories ON transactions.category_id = categories.id").
		Where("transactions.project_id = ? AND transactions.type = 'expense'", p.ID)
	if sum.Budget.Mode != "none" && sum.Budget.LedgerID != uuid.Nil {
		catQ = catQ.Where("transactions.ledger_id = ?", sum.Budget.LedgerID)
	}
	catQ.Group("categories.name, categories.color").Scan(&catStats)

	c.JSON(http.StatusOK, gin.H{
		"project":        sum,
		"category_stats": catStats,
	})
}

// UpdateProjectBudget PUT /api/projects/:id/budget
// Body: { mode: "none"|"total"|"monthly", amount: number, year_month?: "YYYY-MM" }
func UpdateProjectBudget(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var p models.Project
	if err := service.DB.First(&p, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !userCanAccessLedger(userID, p.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	var req struct {
		Mode      string     `json:"mode" binding:"required"` // none | total | monthly
		Amount    float64    `json:"amount"`
		YearMonth string     `json:"year_month"`
		LedgerID  *uuid.UUID `json:"ledger_id"` // optional: ledger whose expenses count toward this budget
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	budgetReqLeg := uuid.Nil
	if req.LedgerID != nil && *req.LedgerID != uuid.Nil {
		if !userCanAccessLedger(userID, *req.LedgerID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "no access to budget ledger"})
			return
		}
		budgetReqLeg = *req.LedgerID
	}

	err = service.DB.Transaction(func(tx *gorm.DB) error {
		return upsertProjectBudgetTx(tx, &p, req.Mode, req.Amount, req.YearMonth, budgetReqLeg)
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// refresh project and return summary
	service.DB.First(&p, "id = ?", id)
	c.JSON(http.StatusOK, buildProjectSummary(&p))
}

// DeleteProjectBudget DELETE /api/projects/:id/budget
func DeleteProjectBudget(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var p models.Project
	if err := service.DB.First(&p, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !userCanAccessLedger(userID, p.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	err = service.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ?", p.ID).Delete(&models.Budget{}).Error; err != nil {
			return err
		}
		p.BudgetMode = "none"
		return tx.Save(&p).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove budget"})
		return
	}
	c.JSON(http.StatusOK, buildProjectSummary(&p))
}

// upsertProjectBudgetTx writes/updates/clears the Budget row for a project and keeps
// project.BudgetMode in sync. Caller must run inside a transaction.
// budgetLedger is optional (uuid.Nil = use existing row's ledger or project's ledger).
func upsertProjectBudgetTx(tx *gorm.DB, p *models.Project, mode string, amount float64, yearMonth string, budgetLedger uuid.UUID) error {
	switch mode {
	case "", "none":
		if err := tx.Where("project_id = ?", p.ID).Delete(&models.Budget{}).Error; err != nil {
			return err
		}
		p.BudgetMode = "none"
		return tx.Save(p).Error

	case "total":
		if amount < 0 {
			return gin.Error{Err: errInvalid("amount must be >= 0"), Type: gin.ErrorTypePublic}
		}
		if err := tx.Where("project_id = ? AND scope = 'project_monthly'", p.ID).Delete(&models.Budget{}).Error; err != nil {
			return err
		}
		var existing models.Budget
		qErr := tx.Where("project_id = ? AND scope = 'project_total'", p.ID).First(&existing).Error
		var existingPtr *models.Budget
		if qErr == nil {
			existingPtr = &existing
		}
		leg := resolveBudgetLedgerID(p, budgetLedger, existingPtr)
		if qErr == nil {
			existing.Amount = amount
			existing.YearMonth = ""
			existing.LedgerID = leg
			if err := tx.Save(&existing).Error; err != nil {
				return err
			}
		} else {
			b := models.Budget{
				LedgerID:  leg,
				ProjectID: &p.ID,
				Amount:    amount,
				Scope:     "project_total",
			}
			if err := tx.Create(&b).Error; err != nil {
				return err
			}
		}
		p.BudgetMode = "total"
		return tx.Save(p).Error

	case "monthly":
		if amount < 0 {
			return gin.Error{Err: errInvalid("amount must be >= 0"), Type: gin.ErrorTypePublic}
		}
		ym := yearMonth
		if ym == "" {
			ym = currentYearMonth()
		}
		if err := tx.Where("project_id = ? AND scope = 'project_total'", p.ID).Delete(&models.Budget{}).Error; err != nil {
			return err
		}
		var existing models.Budget
		qErr := tx.
			Where("project_id = ? AND scope = 'project_monthly' AND year_month = ?", p.ID, ym).
			First(&existing).Error
		var existingPtr *models.Budget
		if qErr == nil {
			existingPtr = &existing
		}
		leg := resolveBudgetLedgerID(p, budgetLedger, existingPtr)
		if qErr == nil {
			existing.Amount = amount
			existing.LedgerID = leg
			if err := tx.Save(&existing).Error; err != nil {
				return err
			}
		} else {
			b := models.Budget{
				LedgerID:  leg,
				ProjectID: &p.ID,
				Amount:    amount,
				YearMonth: ym,
				Scope:     "project_monthly",
			}
			if err := tx.Create(&b).Error; err != nil {
				return err
			}
		}
		p.BudgetMode = "monthly"
		return tx.Save(p).Error

	default:
		return gin.Error{Err: errInvalid("unknown budget mode: " + mode), Type: gin.ErrorTypePublic}
	}
}

type simpleErr struct{ msg string }

func (e simpleErr) Error() string { return e.msg }

func errInvalid(msg string) error { return simpleErr{msg: msg} }
