package api

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Ledger Handlers
func GetLedgers(c *gin.Context) {
	userID := c.MustGet("user_id").(string)
	uid, _ := uuid.Parse(userID)
	var user models.User
	service.DB.Preload("Ledgers").First(&user, "id = ?", userID)

	// Collect this user's private ledger-keywords once, group by ledger_id.
	var kws []models.LedgerKeyword
	service.DB.Where("user_id = ?", uid).Order("keyword ASC").Find(&kws)
	kwByLedger := map[uuid.UUID][]gin.H{}
	for _, k := range kws {
		kwByLedger[k.LedgerID] = append(kwByLedger[k.LedgerID], gin.H{"id": k.ID, "keyword": k.Keyword})
	}

	familyIDs := make([]uuid.UUID, 0)
	for _, l := range user.Ledgers {
		if l.Type == "family" {
			familyIDs = append(familyIDs, l.ID)
		}
	}
	linkedByFamily := map[uuid.UUID][]gin.H{}
	linkCountByFamily := map[uuid.UUID]int{}
	parentFamilyOfPersonal := map[uuid.UUID]uuid.UUID{}
	if len(familyIDs) > 0 {
		var links []models.LedgerFamilyLink
		service.DB.Where("family_ledger_id IN ?", familyIDs).Find(&links)
		if len(links) > 0 {
			personalIDs := make([]uuid.UUID, 0, len(links))
			for _, lk := range links {
				personalIDs = append(personalIDs, lk.PersonalLedgerID)
				parentFamilyOfPersonal[lk.PersonalLedgerID] = lk.FamilyLedgerID
				linkCountByFamily[lk.FamilyLedgerID]++
			}
			var pls []models.Ledger
			service.DB.Select("id", "name").Where("id IN ?", personalIDs).Find(&pls)
			nameBy := map[uuid.UUID]string{}
			for _, pl := range pls {
				nameBy[pl.ID] = pl.Name
			}
			for _, lk := range links {
				// Only expose sub-ledgers the current user may access; otherwise the SPA
				// merges cluster IDs for /tags and /categories and gets 403 on others' books.
				if !userCanAccessLedger(uid, lk.PersonalLedgerID) {
					continue
				}
				nm := nameBy[lk.PersonalLedgerID]
				if nm == "" {
					nm = "个人账本"
				}
				linkedByFamily[lk.FamilyLedgerID] = append(linkedByFamily[lk.FamilyLedgerID], gin.H{
					"id":   lk.PersonalLedgerID,
					"name": nm,
				})
			}
		}
	}

	out := make([]gin.H, 0, len(user.Ledgers))
	for _, l := range user.Ledgers {
		kw := kwByLedger[l.ID]
		if kw == nil {
			kw = []gin.H{}
		}
		var memberCount int64
		service.DB.Model(&models.LedgerUser{}).Where("ledger_id = ?", l.ID).Count(&memberCount)
		h := gin.H{
			"id":           l.ID,
			"name":         l.Name,
			"owner_id":     l.OwnerID,
			"type":         l.Type,
			"member_count": memberCount,
			"created_at":   l.CreatedAt,
			"updated_at":   l.UpdatedAt,
			"keywords":     kw,
		}
		if l.Type == "family" {
			if ch, ok := linkedByFamily[l.ID]; ok {
				h["linked_personal"] = ch
			} else {
				h["linked_personal"] = []gin.H{}
			}
			h["linked_personal_count"] = linkCountByFamily[l.ID]
		}
		if famID, ok := parentFamilyOfPersonal[l.ID]; ok {
			h["parent_family_id"] = famID
		}
		out = append(out, h)
	}
	c.JSON(http.StatusOK, out)
}

func CreateLedger(c *gin.Context) {
	userID := c.MustGet("user_id").(string)
	userUUID, _ := uuid.Parse(userID)

	var req struct {
		Name string `json:"name" binding:"required"`
		Type string `json:"type"` // "personal", "family"
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	lt := req.Type
	if lt == "" {
		lt = "personal"
	}
	if lt != "personal" && lt != "family" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be personal or family"})
		return
	}

	ledger := models.Ledger{
		Name:    req.Name,
		Type:    lt,
		OwnerID: userUUID,
	}

	if err := service.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}
		if err := tx.Exec(
			`INSERT INTO ledger_users (ledger_id, user_id)
			 VALUES (?, ?)
			 ON CONFLICT DO NOTHING`,
			ledger.ID, userUUID,
		).Error; err != nil {
			return err
		}
		initDefaultCategoriesForLedger(tx, ledger.ID)
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create ledger: " + err.Error()})
		return
	}

	uid := userUUID
	WriteAuditLog(c, &uid, "ledger.create", "ledger", strPtr(ledger.ID.String()), map[string]interface{}{
		"name": ledger.Name, "type": ledger.Type,
	})

	c.JSON(http.StatusCreated, ledger)
}

// UpdateLedger renames a ledger (owner only).
func UpdateLedger(c *gin.Context) {
	userID := c.MustGet("user_id").(string)
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user"})
		return
	}
	ledgerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var ledger models.Ledger
	if err := service.DB.First(&ledger, "id = ?", ledgerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}
	if ledger.OwnerID != userUUID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the owner can rename"})
		return
	}
	old := ledger.Name
	if err := service.DB.Model(&ledger).Update("name", req.Name).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	service.DB.First(&ledger, "id = ?", ledgerID)
	WriteAuditLog(c, &userUUID, "ledger.update", "ledger", strPtr(ledgerID.String()), map[string]interface{}{
		"from": old, "to": req.Name,
	})
	c.JSON(http.StatusOK, gin.H{
		"id":         ledger.ID,
		"name":       ledger.Name,
		"owner_id":   ledger.OwnerID,
		"type":       ledger.Type,
		"updated_at": ledger.UpdatedAt,
	})
}

// Transaction Handlers
func CreateTransaction(c *gin.Context) {
	userUUID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var req struct {
		Amount     float64     `json:"amount" binding:"required"`
		Type       string      `json:"type" binding:"required"`
		CategoryID uuid.UUID   `json:"category_id" binding:"required"`
		LedgerID   uuid.UUID   `json:"ledger_id" binding:"required"`
		Note       string      `json:"note"`
		Tags       string      `json:"tags"`
		TagIDs     []uuid.UUID `json:"tag_ids"` // many-to-many tag links (new)
		Date       time.Time   `json:"date"`
		ProjectID  *uuid.UUID  `json:"project_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !userCanAccessLedger(userUUID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	// Ensure the picked category actually belongs to this ledger
	var cat models.Category
	if err := service.DB.
		Where("id = ? AND ledger_id = ?", req.CategoryID, req.LedgerID).
		First(&cat).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category does not belong to this ledger"})
		return
	}

	// Ensure the project (if any) also belongs to this ledger
	if req.ProjectID != nil {
		var proj models.Project
		if err := service.DB.
			Where("id = ? AND ledger_id = ?", *req.ProjectID, req.LedgerID).
			First(&proj).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project does not belong to this ledger"})
			return
		}
	}

	if req.Date.IsZero() {
		req.Date = time.Now()
	}

	transaction := models.Transaction{
		Amount:     req.Amount,
		Type:       req.Type,
		CategoryID: req.CategoryID,
		LedgerID:   req.LedgerID,
		UserID:     userUUID,
		Note:       req.Note,
		Tags:       req.Tags,
		Date:       req.Date,
		ProjectID:  req.ProjectID,
	}

	if err := service.DB.Create(&transaction).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record transaction"})
		return
	}

	// Link tags if the client provided any. Failure here is non-fatal for the
	// transaction itself, but we surface it so the UI can retry.
	if len(req.TagIDs) > 0 {
		if err := ReplaceTransactionTags(nil, transaction.ID, transaction.LedgerID, req.TagIDs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "transaction_id": transaction.ID})
			return
		}
	}

	c.JSON(http.StatusCreated, withTransactionTags(transaction))
}

func GetTransactions(c *gin.Context) {
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
	parsed, err := uuid.Parse(ledgerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
		return
	}
	if !userCanAccessLedger(userID, parsed) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	ledgerIDs := []uuid.UUID{parsed}
	strict := c.Query("strict_ledger") == "1" || c.Query("strict_ledger") == "true"
	if !strict {
		var fam models.Ledger
		if err := service.DB.First(&fam, "id = ?", parsed).Error; err == nil && fam.Type == "family" {
			ledgerIDs = expandFamilyLinkedCluster(parsed)
		}
	}

	query := service.DB.Model(&models.Transaction{}).Where("ledger_id IN ?", ledgerIDs)

	if t := c.Query("type"); t != "" {
		query = query.Where("type = ?", t)
	}
	if cid := c.Query("category_id"); cid != "" {
		query = query.Where("category_id = ?", cid)
	}
	if start := c.Query("start_date"); start != "" {
		if ts, err := time.Parse("2006-01-02", start); err == nil {
			query = query.Where("date >= ?", ts)
		}
	}
	if end := c.Query("end_date"); end != "" {
		if ts, err := time.Parse("2006-01-02", end); err == nil {
			// include full end day
			query = query.Where("date <= ?", ts.Add(24*time.Hour-time.Second))
		}
	}
	if search := c.Query("q"); search != "" {
		like := "%" + search + "%"
		query = query.Where("note ILIKE ? OR tags ILIKE ?", like, like)
	}

	paginated := c.Query("limit") != "" || c.Query("offset") != ""
	var total int64
	if paginated {
		query.Count(&total)
	}

	limit := 50
	offset := 0
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
		offset = v
	}

	var transactions []models.Transaction
	q := query.Order("date desc")
	if paginated {
		q = q.Limit(limit).Offset(offset)
	}
	q.Find(&transactions)

	// Bulk-load tags for every returned transaction in one query.
	ids := make([]uuid.UUID, 0, len(transactions))
	for _, t := range transactions {
		ids = append(ids, t.ID)
	}
	tagMap := LoadTransactionTags(ids)
	items := make([]gin.H, 0, len(transactions))
	for _, t := range transactions {
		items = append(items, transactionJSON(t, tagMap[t.ID]))
	}

	if paginated {
		c.JSON(http.StatusOK, gin.H{
			"items":  items,
			"total":  total,
			"limit":  limit,
			"offset": offset,
		})
		return
	}
	c.JSON(http.StatusOK, items)
}

// transactionJSON merges a raw Transaction with its tag list for the wire format.
// Kept as a loose gin.H so we can add fields without churning a dedicated DTO.
func transactionJSON(t models.Transaction, tags []models.Tag) gin.H {
	if tags == nil {
		tags = []models.Tag{}
	}
	return gin.H{
		"id":          t.ID,
		"amount":      t.Amount,
		"type":        t.Type,
		"category_id": t.CategoryID,
		"ledger_id":   t.LedgerID,
		"user_id":     t.UserID,
		"project_id":  t.ProjectID,
		"note":        t.Note,
		"tags":        t.Tags, // legacy comma-separated string kept for backward compat
		"date":        t.Date,
		"created_at":  t.CreatedAt,
		"updated_at":  t.UpdatedAt,
		"tag_refs":    tags, // structured many-to-many list -> UI renders chips
	}
}

// withTransactionTags hydrates a single transaction (post-create/update) with
// its tag list. One-off helper; list responses use the bulk LoadTransactionTags.
func withTransactionTags(t models.Transaction) gin.H {
	var tags []models.Tag
	service.DB.Table("transaction_tags").
		Select("tags.*").
		Joins("JOIN tags ON tags.id = transaction_tags.tag_id").
		Where("transaction_tags.transaction_id = ? AND tags.deleted_at IS NULL", t.ID).
		Scan(&tags)
	return transactionJSON(t, tags)
}

// UpdateTransaction allows editing an existing transaction (owner-only)
func UpdateTransaction(c *gin.Context) {
	txID := c.Param("id")
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var tx models.Transaction
	if err := service.DB.First(&tx, "id = ?", txID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	if !userCanAccessLedger(userID, tx.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	var req struct {
		Amount       *float64     `json:"amount"`
		Type         *string      `json:"type"`
		CategoryID   *uuid.UUID   `json:"category_id"`
		ProjectID    *uuid.UUID   `json:"project_id"`
		ClearProject bool         `json:"clear_project"`
		Note         *string      `json:"note"`
		Tags         *string      `json:"tags"`
		TagIDs       *[]uuid.UUID `json:"tag_ids"` // nil = keep current, [] = clear, [...] = replace
		Date         *time.Time   `json:"date"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Amount != nil {
		tx.Amount = *req.Amount
	}
	if req.Type != nil {
		tx.Type = *req.Type
	}
	if req.CategoryID != nil {
		// ensure category belongs to the same ledger
		var cat models.Category
		if err := service.DB.
			Where("id = ? AND ledger_id = ?", *req.CategoryID, tx.LedgerID).
			First(&cat).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "category does not belong to this ledger"})
			return
		}
		tx.CategoryID = *req.CategoryID
	}
	if req.ClearProject {
		tx.ProjectID = nil
	} else if req.ProjectID != nil {
		var proj models.Project
		if err := service.DB.
			Where("id = ? AND ledger_id = ?", *req.ProjectID, tx.LedgerID).
			First(&proj).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project does not belong to this ledger"})
			return
		}
		tx.ProjectID = req.ProjectID
	}
	if req.Note != nil {
		tx.Note = *req.Note
	}
	if req.Tags != nil {
		tx.Tags = *req.Tags
	}
	if req.Date != nil {
		tx.Date = *req.Date
	}

	if err := service.DB.Save(&tx).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update"})
		return
	}

	// Replace tag links only when the client explicitly sent the field.
	if req.TagIDs != nil {
		if err := ReplaceTransactionTags(nil, tx.ID, tx.LedgerID, *req.TagIDs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, withTransactionTags(tx))
}

// DeleteTransaction removes a transaction (owner-only)
func DeleteTransaction(c *gin.Context) {
	txID := c.Param("id")
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var tx models.Transaction
	if err := service.DB.First(&tx, "id = ?", txID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	if !userCanAccessLedger(userID, tx.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	// Remove tag junction rows first so we don't leave dangling links.
	service.DB.Where("transaction_id = ?", tx.ID).Delete(&models.TransactionTag{})
	if err := service.DB.Delete(&tx).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.Status(http.StatusNoContent)
}

// userCanAccessLedger checks if the user is a member of the given ledger
func userCanAccessLedger(userID uuid.UUID, ledgerID uuid.UUID) bool {
	var count int64
	service.DB.Table("ledger_users").
		Where("user_id = ? AND ledger_id = ?", userID, ledgerID).
		Count(&count)
	return count > 0
}

// Category Handlers
func GetCategories(c *gin.Context) {
	ledgerID := c.Query("ledger_id")
	if ledgerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ledger_id is required"})
		return
	}

	var categories []models.Category
	service.DB.
		Where("ledger_id = ?", ledgerID).
		Order("sort_order ASC, is_system DESC, created_at ASC").
		Find(&categories)

	// Load keywords in one query so we don't N+1
	lid, _ := uuid.Parse(ledgerID)
	var kws []models.CategoryKeyword
	service.DB.Where("ledger_id = ?", lid).Order("keyword ASC").Find(&kws)
	kwByCat := map[uuid.UUID][]gin.H{}
	for _, k := range kws {
		kwByCat[k.CategoryID] = append(kwByCat[k.CategoryID], gin.H{"id": k.ID, "keyword": k.Keyword})
	}

	// Build response with keywords embedded
	out := make([]gin.H, 0, len(categories))
	for _, cat := range categories {
		kw := kwByCat[cat.ID]
		if kw == nil {
			kw = []gin.H{}
		}
		out = append(out, gin.H{
			"id":         cat.ID,
			"name":       cat.Name,
			"icon":       cat.Icon,
			"color":      cat.Color,
			"type":       cat.Type,
			"ledger_id":  cat.LedgerID,
			"is_system":  cat.IsSystem,
			"sort_order": cat.SortOrder,
			"keywords":   kw,
		})
	}
	c.JSON(http.StatusOK, out)
}

// userLedgerIDs returns all ledger UUIDs the given user is a member of.
func userLedgerIDs(userID uuid.UUID) []uuid.UUID {
	var ids []uuid.UUID
	service.DB.Table("ledger_users").
		Where("user_id = ?", userID).
		Pluck("ledger_id", &ids)
	return ids
}

// Statistics Handlers
// GetDashboardSummary supports the following query params:
//
//	ledger_id=UUID              - single-ledger view (default)
//	scope=all                   - aggregate across all ledgers the user is a member of
//	group_by=category|project|ledger - slicing dimension for the pie chart (default: category)
//	period=month|year|all       - time window (default: month)
//	year_month=YYYY-MM          - specific month, overrides default current month
//	year=YYYY                   - specific year, overrides default current year
//
// When ledger_id is a family ledger, expenses aggregate across that ledger plus every
// linked personal (merged household flow). Monthly ledger_total budget uses only the
// family ledger's own budget row. Response fields includes_linked_personal /
// linked_personal_in_cluster describe the expense cluster.
//
// Response includes category_stats, project_stats and ledger_stats so the frontend
// can switch dimension without a refetch.
func GetDashboardSummary(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	groupBy := c.DefaultQuery("group_by", "category")
	switch groupBy {
	case "category", "project", "ledger":
	default:
		groupBy = "category"
	}

	period := c.DefaultQuery("period", "month")
	switch period {
	case "month", "year", "all":
	default:
		period = "month"
	}

	// Resolve the active time window
	now := time.Now()
	loc := now.Location()

	// Month window (always computed so we can return daily avg / remaining days
	// when period=month; for year/all we still report the current month label).
	ymParam := c.Query("year_month")
	targetYear := now.Year()
	targetMonth := now.Month()
	if ymParam != "" {
		if t, err := time.ParseInLocation("2006-01", ymParam, loc); err == nil {
			targetYear = t.Year()
			targetMonth = t.Month()
		}
	}
	if y := c.Query("year"); y != "" {
		if yy, err := strconv.Atoi(y); err == nil && yy > 1970 && yy < 3000 {
			targetYear = yy
		}
	}

	firstOfMonth := time.Date(targetYear, targetMonth, 1, 0, 0, 0, 0, loc)
	lastOfMonth := firstOfMonth.AddDate(0, 1, 0).Add(-time.Second)
	firstOfYear := time.Date(targetYear, 1, 1, 0, 0, 0, 0, loc)
	lastOfYear := time.Date(targetYear, 12, 31, 23, 59, 59, 0, loc)
	currentMonth := firstOfMonth.Format("2006-01")

	// Determine which ledgers to include (expense aggregation vs budget rows).
	var ledgerIDs []uuid.UUID
	var budgetLedgerIDs []uuid.UUID
	includesLinkedPersonal := false
	linkedPersonalInCluster := 0
	scope := c.Query("scope")
	if scope == "all" {
		ledgerIDs = userLedgerIDs(userID)
		budgetLedgerIDs = ledgerIDs
	} else {
		ledgerIDStr := c.Query("ledger_id")
		if ledgerIDStr == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ledger_id is required"})
			return
		}
		lid, err := uuid.Parse(ledgerIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
			return
		}
		if !userCanAccessLedger(userID, lid) {
			c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
			return
		}
		ledgerIDs = []uuid.UUID{lid}
		budgetLedgerIDs = ledgerIDs
		if len(ledgerIDs) == 1 {
			var fam models.Ledger
			if err := service.DB.First(&fam, "id = ?", ledgerIDs[0]).Error; err == nil && fam.Type == "family" {
				familyLID := ledgerIDs[0]
				ledgerIDs = expandFamilyLinkedCluster(familyLID)
				if len(ledgerIDs) > 1 {
					// Expenses/charts use family + all linked personals; monthly「账本总预算」只算家庭账本本身。
					budgetLedgerIDs = []uuid.UUID{familyLID}
					includesLinkedPersonal = true
					linkedPersonalInCluster = len(ledgerIDs) - 1
				}
			}
		}
	}

	// --- Tag-based exclusion ---
	//
	// Semantics:
	//   * By default every tag with exclude_from_stats=true removes its
	//     transactions from the aggregation (so "报销"/"转账" etc. don't skew
	//     the pie chart).
	//   * Clients can also request additional ad-hoc exclusions via
	//     ?exclude_tag_ids=uuid1,uuid2 (union with the defaults).
	//   * ?bypass_tag_filter=true disables both for the one-click
	//     "包含已排除" toggle.
	bypassTags := c.Query("bypass_tag_filter") == "true"
	manualExcludeTagIDs := parseUUIDList(c.Query("exclude_tag_ids"))
	var excludedTagIDs []uuid.UUID
	var excludedTagsForResp []models.Tag
	if !bypassTags && len(ledgerIDs) > 0 {
		var defaultTags []models.Tag
		service.DB.Where("ledger_id IN ? AND exclude_from_stats = TRUE", ledgerIDs).Find(&defaultTags)
		seen := map[uuid.UUID]bool{}
		for _, t := range defaultTags {
			if !seen[t.ID] {
				seen[t.ID] = true
				excludedTagIDs = append(excludedTagIDs, t.ID)
				excludedTagsForResp = append(excludedTagsForResp, t)
			}
		}
		if len(manualExcludeTagIDs) > 0 {
			var manual []models.Tag
			service.DB.Where("id IN ? AND ledger_id IN ?", manualExcludeTagIDs, ledgerIDs).Find(&manual)
			for _, t := range manual {
				if !seen[t.ID] {
					seen[t.ID] = true
					excludedTagIDs = append(excludedTagIDs, t.ID)
					excludedTagsForResp = append(excludedTagsForResp, t)
				}
			}
		}
	}
	if excludedTagsForResp == nil {
		excludedTagsForResp = []models.Tag{}
	}

	// applyTagExclusion adds a NOT EXISTS subquery filtering out transactions
	// that carry any of the excluded tags. No-op when the list is empty.
	applyTagExclusion := func(tx *gorm.DB, txAlias string) *gorm.DB {
		if len(excludedTagIDs) == 0 {
			return tx
		}
		col := "id"
		if txAlias != "" {
			col = txAlias + ".id"
		}
		return tx.Where("NOT EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = "+
			col+" AND tt.tag_id IN ?)", excludedTagIDs)
	}

	emptyResponse := gin.H{
		"total_budget":                 0,
		"total_expense":                0,
		"remaining_budget":             0,
		"days_left":                    1,
		"daily_avg_limit":              0,
		"current_month":                currentMonth,
		"year":                         targetYear,
		"scope":                        scope,
		"group_by":                     groupBy,
		"period":                       period,
		"category_stats":               []any{},
		"project_stats":                []any{},
		"ledger_stats":                 []any{},
		"ledger_count":                 0,
		"excluded_tags":                excludedTagsForResp,
		"bypass_tag_filter":            bypassTags,
		"includes_linked_personal":     false,
		"linked_personal_in_cluster":   0,
	}

	if len(ledgerIDs) == 0 {
		c.JSON(http.StatusOK, emptyResponse)
		return
	}

	// Budget: always shows the current month's planned amount (yearly/all views
	// don't change how budgets are set - they're month-scoped by design).
	var totalBudget float64
	service.DB.Model(&models.Budget{}).
		Where("ledger_id IN ? AND scope = 'ledger_total' AND year_month = ?", budgetLedgerIDs, now.Format("2006-01")).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&totalBudget)

	// Apply the period window to expense aggregation
	applyWindow := func(tx *gorm.DB, dateCol string) *gorm.DB {
		switch period {
		case "year":
			return tx.Where(dateCol+" >= ? AND "+dateCol+" <= ?", firstOfYear, lastOfYear)
		case "all":
			return tx
		default:
			return tx.Where(dateCol+" >= ? AND "+dateCol+" <= ?", firstOfMonth, lastOfMonth)
		}
	}

	// Sum expenses over the active window (for the headline number)
	var totalExpense float64
	{
		q := service.DB.Model(&models.Transaction{}).
			Where("ledger_id IN ? AND type = 'expense'", ledgerIDs)
		q = applyWindow(q, "date")
		q = applyTagExclusion(q, "")
		q.Select("COALESCE(SUM(amount), 0)").Scan(&totalExpense)
	}

	// Days-left / daily-avg only meaningful for current-month view
	daysInMonth := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, loc).Day()
	daysLeft := daysInMonth - now.Day() + 1
	if daysLeft <= 0 {
		daysLeft = 1
	}
	remainingCurrentMonth := totalBudget
	if period == "month" && targetYear == now.Year() && targetMonth == now.Month() {
		remainingCurrentMonth = totalBudget - totalExpense
	} else {
		// For year/all or non-current-month, recompute using the *current* month's expense
		var curMonthExpense float64
		q := service.DB.Model(&models.Transaction{}).
			Where("ledger_id IN ? AND type = 'expense' AND date >= ? AND date <= ?",
				ledgerIDs,
				time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc),
				time.Date(now.Year(), now.Month()+1, 0, 23, 59, 59, 0, loc))
		q = applyTagExclusion(q, "")
		q.Select("COALESCE(SUM(amount), 0)").Scan(&curMonthExpense)
		remainingCurrentMonth = totalBudget - curMonthExpense
	}
	dailyAvg := 0.0
	if daysLeft > 0 && totalBudget > 0 {
		dailyAvg = remainingCurrentMonth / float64(daysLeft)
	}

	// --- Pie slices (all three dimensions computed in parallel) ---
	type PieStat struct {
		Name  string  `json:"name"`
		Value float64 `json:"value"`
		Color string  `json:"color"`
	}

	// By category
	catStats := []PieStat{}
	{
		q := service.DB.Model(&models.Transaction{}).
			Select("categories.name as name, SUM(transactions.amount) as value, MAX(categories.color) as color").
			Joins("JOIN categories ON transactions.category_id = categories.id").
			Where("transactions.ledger_id IN ? AND transactions.type = 'expense'", ledgerIDs)
		q = applyWindow(q, "transactions.date")
		q = applyTagExclusion(q, "transactions")
		if err := q.Group("categories.name").Order("value DESC").Scan(&catStats).Error; err != nil {
			log.Printf("Error fetching category stats: %v", err)
		}
	}

	// By project
	projectStats := []PieStat{}
	{
		q := service.DB.Model(&models.Transaction{}).
			Select("COALESCE(projects.name, '未分类') as name, SUM(transactions.amount) as value, COALESCE(MAX(projects.color), '#a1a1aa') as color").
			Joins("LEFT JOIN projects ON transactions.project_id = projects.id").
			Where("transactions.ledger_id IN ? AND transactions.type = 'expense'", ledgerIDs)
		q = applyWindow(q, "transactions.date")
		q = applyTagExclusion(q, "transactions")
		if err := q.Group("projects.name").Order("value DESC").Scan(&projectStats).Error; err != nil {
			log.Printf("Error fetching project stats: %v", err)
		}
	}

	// By ledger - slice colors generated from a stable palette
	ledgerStats := []PieStat{}
	{
		type rawRow struct {
			Name  string
			Value float64
		}
		var rows []rawRow
		q := service.DB.Model(&models.Transaction{}).
			Select("ledgers.name as name, SUM(transactions.amount) as value").
			Joins("JOIN ledgers ON transactions.ledger_id = ledgers.id").
			Where("transactions.ledger_id IN ? AND transactions.type = 'expense'", ledgerIDs)
		q = applyWindow(q, "transactions.date")
		q = applyTagExclusion(q, "transactions")
		if err := q.Group("ledgers.name").Order("value DESC").Scan(&rows).Error; err != nil {
			log.Printf("Error fetching ledger stats: %v", err)
		}
		for i, r := range rows {
			ledgerStats = append(ledgerStats, PieStat{
				Name:  r.Name,
				Value: r.Value,
				Color: ledgerPalette[i%len(ledgerPalette)],
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"total_budget":                 totalBudget,
		"total_expense":                totalExpense,
		"remaining_budget":             remainingCurrentMonth,
		"days_left":                    daysLeft,
		"daily_avg_limit":              dailyAvg,
		"current_month":                currentMonth,
		"year":                         targetYear,
		"scope":                        scope,
		"group_by":                     groupBy,
		"period":                       period,
		"category_stats":               catStats,
		"project_stats":                projectStats,
		"ledger_stats":                 ledgerStats,
		"ledger_count":                 len(ledgerIDs),
		"excluded_tags":                excludedTagsForResp,
		"bypass_tag_filter":            bypassTags,
		"includes_linked_personal":     includesLinkedPersonal,
		"linked_personal_in_cluster":   linkedPersonalInCluster,
	})
}

// parseUUIDList splits a comma-separated query param into valid UUIDs,
// silently dropping malformed entries (the dashboard should never 400 on a
// typo coming from a URL the user can freely edit).
func parseUUIDList(raw string) []uuid.UUID {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]uuid.UUID, 0, len(parts))
	for _, p := range parts {
		if id, err := uuid.Parse(strings.TrimSpace(p)); err == nil {
			out = append(out, id)
		}
	}
	return out
}

// ledgerPalette is a light-friendly color set used when slicing by ledger.
var ledgerPalette = []string{
	"#6366f1", // indigo
	"#10b981", // emerald
	"#f59e0b", // amber
	"#ef4444", // red
	"#8b5cf6", // violet
	"#06b6d4", // cyan
	"#ec4899", // pink
	"#84cc16", // lime
	"#f97316", // orange
	"#14b8a6", // teal
}

// SetBudget writes a ledger-total or category monthly budget.
// Project budgets should go through PUT /api/projects/:id/budget.
func SetBudget(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	var req struct {
		LedgerID   uuid.UUID  `json:"ledger_id" binding:"required"`
		Amount     float64    `json:"amount" binding:"required"`
		YearMonth  string     `json:"year_month" binding:"required"` // "YYYY-MM"
		CategoryID *uuid.UUID `json:"category_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !userCanAccessLedger(userID, req.LedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	scope := "ledger_total"
	query := service.DB.Where(
		"ledger_id = ? AND year_month = ? AND scope = 'ledger_total'",
		req.LedgerID, req.YearMonth,
	)
	if req.CategoryID != nil {
		scope = "category"
		query = service.DB.Where(
			"ledger_id = ? AND year_month = ? AND scope = 'category' AND category_id = ?",
			req.LedgerID, req.YearMonth, *req.CategoryID,
		)
	}

	var budget models.Budget
	result := query.First(&budget)

	if result.Error == nil {
		budget.Amount = req.Amount
		service.DB.Save(&budget)
	} else {
		budget = models.Budget{
			LedgerID:   req.LedgerID,
			Amount:     req.Amount,
			YearMonth:  req.YearMonth,
			CategoryID: req.CategoryID,
			Scope:      scope,
		}
		service.DB.Create(&budget)
	}

	c.JSON(http.StatusOK, budget)
}

// currentUserID extracts the authenticated user's UUID from gin.Context
func currentUserID(c *gin.Context) (uuid.UUID, error) {
	raw, ok := c.Get("user_id")
	if !ok {
		return uuid.Nil, fmt.Errorf("user_id missing from context")
	}
	switch v := raw.(type) {
	case string:
		return uuid.Parse(v)
	case uuid.UUID:
		return v, nil
	default:
		return uuid.Nil, fmt.Errorf("unsupported user_id type %T", v)
	}
}

// GetBindingCode generates a temporary PIN for bot linking
func GetBindingCode(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	code := fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
	expiresAt := time.Now().Add(5 * time.Minute).Unix()

	session := models.BindingSession{
		UserID:    userID,
		Code:      code,
		ExpiresAt: expiresAt,
	}

	if err := service.DB.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate PIN"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":         code,
		"expires_in":   300,
		"bot_username": os.Getenv("TELEGRAM_BOT_USERNAME"),
	})
}

// GetBotStatus checks if the current user has any active bot connections
func GetBotStatus(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var connections []models.UserConnection
	if err := service.DB.Where("user_id = ?", userID).Find(&connections).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"connected": len(connections) > 0,
		"platforms": connections,
	})
}
