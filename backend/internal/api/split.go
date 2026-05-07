package api

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Split feature: a "split" lets a user take a single expense in a *family*
// ledger and distribute it across the personal sub-ledgers linked to that
// family. The resulting child transactions live as first-class rows in their
// target personal ledgers; the optional source row in the family ledger is
// removed (convert) or never created (direct create).
//
// Because dashboard / budget aggregation already merges family + linked
// personal ledgers via expandFamilyLinkedCluster, no aggregation query needs
// to know about splits — the children naturally land in the cluster sum.

// splitAllocationReq is one row in the allocations editor.
type splitAllocationReq struct {
	TargetLedgerID uuid.UUID    `json:"target_ledger_id" binding:"required"`
	Amount         float64      `json:"amount" binding:"required"`
	CategoryID     *uuid.UUID   `json:"category_id"`
	ProjectID      *uuid.UUID   `json:"project_id"`
	ClearProject   bool         `json:"clear_project"`
	Note           *string      `json:"note"`
	Tags           *string      `json:"tags"`
	TagIDs         *[]uuid.UUID `json:"tag_ids"`
	Date           *time.Time   `json:"date"`
}

// CreateSplit handles POST /transactions/split — create a split group plus N
// child transactions in the target personal sub-ledgers of the source family
// ledger. The source ledger does NOT receive a transaction row.
func CreateSplit(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var req struct {
		SourceLedgerID uuid.UUID            `json:"source_ledger_id" binding:"required"`
		Type           string               `json:"type"`
		CategoryID     uuid.UUID            `json:"category_id" binding:"required"`
		ProjectID      *uuid.UUID           `json:"project_id"`
		Note           string               `json:"note"`
		Tags           string               `json:"tags"`
		TagIDs         []uuid.UUID          `json:"tag_ids"`
		Date           time.Time            `json:"date"`
		Allocations    []splitAllocationReq `json:"allocations" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Type == "" {
		req.Type = "expense"
	}
	if req.Type != "expense" && req.Type != "income" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "split only supports expense or income"})
		return
	}
	if req.Date.IsZero() {
		req.Date = time.Now()
	}

	group, children, err := execSplit(service.DB, userID, execSplitParams{
		SourceLedgerID: req.SourceLedgerID,
		Type:           req.Type,
		CategoryID:     req.CategoryID,
		ProjectID:      req.ProjectID,
		Note:           req.Note,
		Tags:           req.Tags,
		TagIDs:         req.TagIDs,
		Date:           req.Date,
		Allocations:    req.Allocations,
	})
	if err != nil {
		respondSplitError(c, err)
		return
	}

	c.JSON(http.StatusCreated, splitGroupJSON(group, children))
}

// ConvertTransactionToSplit handles POST /transactions/:id/convert-to-split.
// The source transaction must live in a family ledger; on success it is
// deleted and replaced by a split group with N child transactions.
func ConvertTransactionToSplit(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	txID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction id"})
		return
	}

	var src models.Transaction
	if err := service.DB.First(&src, "id = ?", txID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}
	if src.SplitGroupID != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "transaction already belongs to a split group"})
		return
	}
	if src.InstallmentGroupID != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "installment transactions cannot be split"})
		return
	}

	var req struct {
		Allocations []splitAllocationReq `json:"allocations" binding:"required,min=1"`
		Note        *string              `json:"note"`
		Tags        *string              `json:"tags"`
		TagIDs      *[]uuid.UUID         `json:"tag_ids"`
		Date        *time.Time           `json:"date"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	note := src.Note
	if req.Note != nil {
		note = *req.Note
	}
	tags := src.Tags
	if req.Tags != nil {
		tags = *req.Tags
	}
	date := src.Date
	if req.Date != nil {
		date = *req.Date
	}

	// Inherit existing tag links if caller didn't override.
	tagIDs := []uuid.UUID{}
	if req.TagIDs != nil {
		tagIDs = *req.TagIDs
	} else {
		var rows []models.TransactionTag
		service.DB.Where("transaction_id = ?", src.ID).Find(&rows)
		for _, r := range rows {
			tagIDs = append(tagIDs, r.TagID)
		}
	}

	var (
		group    models.SplitGroup
		children []models.Transaction
	)
	err = service.DB.Transaction(func(tx *gorm.DB) error {
		// Delete the original tag links + transaction row inside the same tx
		// so a failure rolls back atomically.
		if err := tx.Where("transaction_id = ?", src.ID).Delete(&models.TransactionTag{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&src).Error; err != nil {
			return err
		}
		g, kids, err := execSplit(tx, userID, execSplitParams{
			SourceLedgerID: src.LedgerID,
			Type:           src.Type,
			CategoryID:     src.CategoryID,
			ProjectID:      src.ProjectID,
			Note:           note,
			Tags:           tags,
			TagIDs:         tagIDs,
			Date:           date,
			Allocations:    req.Allocations,
		})
		if err != nil {
			return err
		}
		group = g
		children = kids
		return nil
	})
	if err != nil {
		respondSplitError(c, err)
		return
	}

	c.JSON(http.StatusCreated, splitGroupJSON(group, children))
}

// GetSplitGroup handles GET /split-groups/:id.
func GetSplitGroup(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	gid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid split group id"})
		return
	}
	var g models.SplitGroup
	if err := service.DB.First(&g, "id = ?", gid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "split group not found"})
		return
	}
	if !userCanAccessLedger(userID, g.SourceLedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	var children []models.Transaction
	service.DB.Where("split_group_id = ?", g.ID).Order("date ASC, created_at ASC").Find(&children)
	c.JSON(http.StatusOK, splitGroupJSON(g, children))
}

// ListSplitGroups handles GET /split-groups?ledger_id=UUID — returns split
// groups whose source_ledger_id == family ledger of the requested cluster.
// When called with a personal ledger that's linked to a family, it returns the
// groups of that family (so the personal-side toggle shows the same picture).
func ListSplitGroups(c *gin.Context) {
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
	lid, err := uuid.Parse(ledgerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger_id"})
		return
	}
	if !userCanAccessLedger(userID, lid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}

	// Resolve the family ledger id for this scope.
	var led models.Ledger
	if err := service.DB.First(&led, "id = ?", lid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}
	familyID := uuid.Nil
	if led.Type == "family" {
		familyID = led.ID
	} else {
		// Personal: find the family it's linked to (if any).
		var link models.LedgerFamilyLink
		if err := service.DB.Where("personal_ledger_id = ?", led.ID).First(&link).Error; err == nil {
			familyID = link.FamilyLedgerID
		}
	}
	if familyID == uuid.Nil {
		c.JSON(http.StatusOK, []any{})
		return
	}

	var groups []models.SplitGroup
	service.DB.Where("source_ledger_id = ?", familyID).
		Order("date DESC, created_at DESC").
		Find(&groups)
	if len(groups) == 0 {
		c.JSON(http.StatusOK, []any{})
		return
	}
	groupIDs := make([]uuid.UUID, 0, len(groups))
	for _, g := range groups {
		groupIDs = append(groupIDs, g.ID)
	}
	var allChildren []models.Transaction
	service.DB.Where("split_group_id IN ?", groupIDs).
		Order("date ASC, created_at ASC").
		Find(&allChildren)
	byGroup := map[uuid.UUID][]models.Transaction{}
	for _, ch := range allChildren {
		if ch.SplitGroupID != nil {
			byGroup[*ch.SplitGroupID] = append(byGroup[*ch.SplitGroupID], ch)
		}
	}

	out := make([]gin.H, 0, len(groups))
	for _, g := range groups {
		out = append(out, splitGroupJSON(g, byGroup[g.ID]))
	}
	c.JSON(http.StatusOK, out)
}

// DeleteSplitGroup handles DELETE /split-groups/:id — cascade-deletes the
// group plus every child transaction (and their tag links).
func DeleteSplitGroup(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	gid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid split group id"})
		return
	}
	var g models.SplitGroup
	if err := service.DB.First(&g, "id = ?", gid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "split group not found"})
		return
	}
	if !userCanAccessLedger(userID, g.SourceLedgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	if !service.UserCanWriteLedger(service.DB, userID, g.SourceLedgerID) {
		c.JSON(http.StatusForbidden, ErrorJSON(c, "ledger.viewer_read_only"))
		return
	}

	err = service.DB.Transaction(func(tx *gorm.DB) error {
		var childIDs []uuid.UUID
		tx.Model(&models.Transaction{}).Where("split_group_id = ?", g.ID).Pluck("id", &childIDs)
		if len(childIDs) > 0 {
			if err := tx.Where("transaction_id IN ?", childIDs).Delete(&models.TransactionTag{}).Error; err != nil {
				return err
			}
			if err := tx.Where("split_group_id = ?", g.ID).Delete(&models.Transaction{}).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&g).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete split group"})
		return
	}
	c.Status(http.StatusNoContent)
}

// --- internals ---------------------------------------------------------------

type execSplitParams struct {
	SourceLedgerID uuid.UUID
	Type           string
	CategoryID     uuid.UUID
	ProjectID      *uuid.UUID
	Note           string
	Tags           string
	TagIDs         []uuid.UUID
	Date           time.Time
	Allocations    []splitAllocationReq
}

// splitErr lets execSplit signal a 4xx vs 5xx without leaking gin.Context.
type splitErr struct {
	status int
	msg    string
}

func (e *splitErr) Error() string { return e.msg }

func badSplit(msg string) error  { return &splitErr{status: http.StatusBadRequest, msg: msg} }
func denySplit(msg string) error { return &splitErr{status: http.StatusForbidden, msg: msg} }

func respondSplitError(c *gin.Context, err error) {
	var se *splitErr
	if errors.As(err, &se) {
		c.JSON(se.status, gin.H{"error": se.msg})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// execSplit validates and creates the SplitGroup + N child transactions.
// db should usually be a transaction (so tag links roll back together).
func execSplit(db *gorm.DB, userID uuid.UUID, p execSplitParams) (models.SplitGroup, []models.Transaction, error) {
	// 1) Source ledger must be a family ledger the user can write to.
	var src models.Ledger
	if err := db.First(&src, "id = ?", p.SourceLedgerID).Error; err != nil {
		return models.SplitGroup{}, nil, badSplit("source ledger not found")
	}
	if src.Type != "family" {
		return models.SplitGroup{}, nil, badSplit("split is only supported on family ledgers")
	}
	if !userCanAccessLedger(userID, src.ID) {
		return models.SplitGroup{}, nil, denySplit("no access to source ledger")
	}
	if !service.UserCanWriteLedger(db, userID, src.ID) {
		return models.SplitGroup{}, nil, denySplit("read-only member cannot split")
	}

	// 2) Build the set of valid target personal sub-ledgers.
	var links []models.LedgerFamilyLink
	db.Where("family_ledger_id = ?", src.ID).Find(&links)
	allowed := map[uuid.UUID]bool{}
	for _, lk := range links {
		allowed[lk.PersonalLedgerID] = true
	}
	if len(allowed) == 0 {
		return models.SplitGroup{}, nil, badSplit("the family ledger has no linked personal sub-ledgers; cannot split")
	}

	// 3) Validate every allocation.
	if len(p.Allocations) == 0 {
		return models.SplitGroup{}, nil, badSplit("allocations is required")
	}
	totalCents := int64(0)
	seenTargets := map[uuid.UUID]bool{}
	for i, a := range p.Allocations {
		if !allowed[a.TargetLedgerID] {
			return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: target ledger is not a linked personal sub-ledger of the source family", i+1))
		}
		if seenTargets[a.TargetLedgerID] {
			return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: duplicate target ledger", i+1))
		}
		seenTargets[a.TargetLedgerID] = true
		if a.Amount <= 0 {
			return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: amount must be > 0", i+1))
		}
		totalCents += int64(math.Round(a.Amount * 100))
	}
	if totalCents <= 0 {
		return models.SplitGroup{}, nil, badSplit("total amount must be positive")
	}

	// 4) Validate parent-level category/project belong to the source ledger.
	var parentCat models.Category
	if err := db.Where("id = ? AND ledger_id = ?", p.CategoryID, src.ID).First(&parentCat).Error; err != nil {
		return models.SplitGroup{}, nil, badSplit("default category does not belong to the source ledger")
	}
	if p.ProjectID != nil {
		var proj models.Project
		if err := db.Where("id = ? AND ledger_id = ?", *p.ProjectID, src.ID).First(&proj).Error; err != nil {
			return models.SplitGroup{}, nil, badSplit("default project does not belong to the source ledger")
		}
	}

	// 5) Create the SplitGroup row.
	totalAmount := float64(totalCents) / 100
	group := models.SplitGroup{
		SourceLedgerID:  src.ID,
		TotalAmount:     totalAmount,
		Type:            p.Type,
		CategoryID:      p.CategoryID,
		ProjectID:       p.ProjectID,
		Note:            p.Note,
		Tags:            p.Tags,
		Date:            p.Date,
		CreatedByUserID: userID,
	}
	if err := db.Create(&group).Error; err != nil {
		return models.SplitGroup{}, nil, err
	}

	// 6) Create one child transaction per allocation in its target ledger.
	// Pre-load parent tags (if any) for name-based mapping into target ledgers.
	var parentTags []models.Tag
	if len(p.TagIDs) > 0 {
		if err := db.Where("id IN ?", p.TagIDs).Find(&parentTags).Error; err != nil {
			return models.SplitGroup{}, nil, err
		}
	}

	children := make([]models.Transaction, 0, len(p.Allocations))
	for i, a := range p.Allocations {
		// Resolve category for this child:
		//   - explicit per-allocation override wins
		//   - else try the parent category id directly (works when target == source, which we forbid, but be defensive)
		//   - else map parent category by name+type to a category that lives in the target ledger
		var catID uuid.UUID
		if a.CategoryID != nil {
			catID = *a.CategoryID
			var cat models.Category
			if err := db.Where("id = ? AND ledger_id = ?", catID, a.TargetLedgerID).First(&cat).Error; err != nil {
				return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: category does not belong to target ledger", i+1))
			}
		} else {
			var mapped models.Category
			q := db.Where("ledger_id = ? AND type = ?", a.TargetLedgerID, parentCat.Type)
			if parentCat.NameZh != "" && parentCat.NameEn != "" {
				q = q.Where("name_zh = ? OR name_en = ?", parentCat.NameZh, parentCat.NameEn)
			} else if parentCat.NameZh != "" {
				q = q.Where("name_zh = ?", parentCat.NameZh)
			} else if parentCat.NameEn != "" {
				q = q.Where("name_en = ?", parentCat.NameEn)
			} else {
				return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: cannot map source category (no name)", i+1))
			}
			if err := q.Order("is_system DESC, sort_order ASC").First(&mapped).Error; err != nil {
				name := parentCat.NameZh
				if name == "" {
					name = parentCat.NameEn
				}
				return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: target ledger has no matching category for %q", i+1, name))
			}
			catID = mapped.ID
		}

		// Project handling: parent project lives in the source (family) ledger
		// so it cannot be reused on a child in a personal sub-ledger. Only
		// honor an explicit per-allocation project_id.
		var projID *uuid.UUID
		if !a.ClearProject && a.ProjectID != nil {
			projID = a.ProjectID
			var proj models.Project
			if err := db.Where("id = ? AND ledger_id = ?", *projID, a.TargetLedgerID).First(&proj).Error; err != nil {
				return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: project does not belong to target ledger", i+1))
			}
		}

		note := p.Note
		if a.Note != nil {
			note = *a.Note
		}
		tags := p.Tags
		if a.Tags != nil {
			tags = *a.Tags
		}
		date := p.Date
		if a.Date != nil {
			date = *a.Date
		}

		groupID := group.ID
		child := models.Transaction{
			Amount:       a.Amount,
			Type:         p.Type,
			CategoryID:   catID,
			LedgerID:     a.TargetLedgerID,
			UserID:       userID,
			ProjectID:    projID,
			SplitGroupID: &groupID,
			Note:         note,
			Tags:         tags,
			Date:         date,
		}
		if err := db.Create(&child).Error; err != nil {
			return models.SplitGroup{}, nil, err
		}

		// Resolve tag ids to apply on the child:
		//   - per-allocation override (must already belong to target ledger)
		//   - else map parent tags by name into target ledger (silently skip unmatched)
		var tagIDs []uuid.UUID
		if a.TagIDs != nil {
			tagIDs = *a.TagIDs
			if len(tagIDs) > 0 {
				if err := ReplaceTransactionTags(db, child.ID, child.LedgerID, tagIDs); err != nil {
					return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: %s", i+1, err.Error()))
				}
			}
		} else if len(parentTags) > 0 {
			names := make([]string, 0, len(parentTags))
			for _, t := range parentTags {
				if t.Name != "" {
					names = append(names, t.Name)
				}
			}
			if len(names) > 0 {
				var matched []models.Tag
				if err := db.Where("ledger_id = ? AND name IN ?", a.TargetLedgerID, names).Find(&matched).Error; err != nil {
					return models.SplitGroup{}, nil, err
				}
				if len(matched) > 0 {
					ids := make([]uuid.UUID, 0, len(matched))
					for _, t := range matched {
						ids = append(ids, t.ID)
					}
					if err := ReplaceTransactionTags(db, child.ID, child.LedgerID, ids); err != nil {
						return models.SplitGroup{}, nil, badSplit(fmt.Sprintf("allocation %d: %s", i+1, err.Error()))
					}
				}
			}
		}
		children = append(children, child)
	}

	return group, children, nil
}

// recalcSplitGroupTotal updates SplitGroup.total_amount = SUM(children.amount).
// Called after a child transaction is updated or deleted.
func recalcSplitGroupTotal(db *gorm.DB, groupID uuid.UUID) {
	var sum float64
	db.Model(&models.Transaction{}).
		Where("split_group_id = ?", groupID).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&sum)
	db.Model(&models.SplitGroup{}).Where("id = ?", groupID).Update("total_amount", sum)
}

// splitGroupJSON shapes a SplitGroup + its children for the wire format.
func splitGroupJSON(g models.SplitGroup, children []models.Transaction) gin.H {
	ids := make([]uuid.UUID, 0, len(children))
	for _, ch := range children {
		ids = append(ids, ch.ID)
	}
	tagMap := LoadTransactionTags(ids)
	items := make([]gin.H, 0, len(children))
	for _, ch := range children {
		items = append(items, transactionJSON(ch, tagMap[ch.ID]))
	}
	return gin.H{
		"id":                 g.ID,
		"source_ledger_id":   g.SourceLedgerID,
		"total_amount":       g.TotalAmount,
		"type":               g.Type,
		"category_id":        g.CategoryID,
		"project_id":         g.ProjectID,
		"note":               g.Note,
		"tags":               g.Tags,
		"date":               g.Date,
		"created_by_user_id": g.CreatedByUserID,
		"created_at":         g.CreatedAt,
		"updated_at":         g.UpdatedAt,
		"children":           items,
		"child_count":        len(items),
	}
}

// SplitAllocationInput is the public shape used by callers outside this
// package (e.g. the Telegram bot) to invoke RunSplit without depending on
// gin / HTTP request binding.
type SplitAllocationInput struct {
	TargetLedgerID uuid.UUID
	Amount         float64
}

// SplitInput is the public input to RunSplit.
type SplitInput struct {
	SourceLedgerID uuid.UUID
	UserID         uuid.UUID
	Type           string // "expense" (default) or "income"
	CategoryID     uuid.UUID
	Note           string
	Date           time.Time
	Allocations    []SplitAllocationInput
}

// RunSplit is a thin wrapper around the package-internal execSplit so that
// other packages (currently the bot) can create split groups using the same
// validation rules as the HTTP endpoint. The error returned may be a
// *splitErr internally; callers can use IsSplitBadRequest to map it.
func RunSplit(db *gorm.DB, in SplitInput) (models.SplitGroup, []models.Transaction, error) {
	t := in.Type
	if t == "" {
		t = "expense"
	}
	date := in.Date
	if date.IsZero() {
		date = time.Now()
	}
	allocs := make([]splitAllocationReq, 0, len(in.Allocations))
	for _, a := range in.Allocations {
		allocs = append(allocs, splitAllocationReq{
			TargetLedgerID: a.TargetLedgerID,
			Amount:         a.Amount,
		})
	}
	return execSplit(db, in.UserID, execSplitParams{
		SourceLedgerID: in.SourceLedgerID,
		Type:           t,
		CategoryID:     in.CategoryID,
		Note:           in.Note,
		Date:           date,
		Allocations:    allocs,
	})
}

// IsSplitBadRequest reports whether err originated as a user-facing
// validation error (so the caller can return the message verbatim instead of
// "internal error").
func IsSplitBadRequest(err error) bool {
	var se *splitErr
	if errors.As(err, &se) {
		return se.status == http.StatusBadRequest || se.status == http.StatusForbidden
	}
	return false
}
