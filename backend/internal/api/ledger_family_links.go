package api

import (
	"net/http"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// expandUserAccessibleFamilyCluster returns the family ledger plus any linked
// personal ledgers the user may access (typically their own). Used for
// dashboard aggregation when viewing a family ledger.
func expandUserAccessibleFamilyCluster(userID, familyID uuid.UUID) []uuid.UUID {
	var fam models.Ledger
	if err := service.DB.First(&fam, "id = ?", familyID).Error; err != nil || fam.Type != "family" {
		return []uuid.UUID{familyID}
	}
	out := []uuid.UUID{familyID}
	var links []models.LedgerFamilyLink
	service.DB.Where("family_ledger_id = ?", familyID).Find(&links)
	for _, lk := range links {
		if userCanAccessLedger(userID, lk.PersonalLedgerID) {
			out = append(out, lk.PersonalLedgerID)
		}
	}
	return out
}

// GetLinkedPersonalLedgers GET /api/ledgers/:id/linked-personal
// Family ledger only: lists linked personal sub-ledgers and candidates the current user may add.
func GetLinkedPersonalLedgers(c *gin.Context) {
	uid, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	familyID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}
	if !userCanAccessLedger(uid, familyID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	var fam models.Ledger
	if err := service.DB.First(&fam, "id = ?", familyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}
	if fam.Type != "family" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅家庭账本可关联个人子账本"})
		return
	}

	type linkedOut struct {
		LinkID     uuid.UUID `json:"link_id"`
		LedgerID   uuid.UUID `json:"ledger_id"`
		Name       string    `json:"name"`
		OwnerID    uuid.UUID `json:"owner_id"`
		OwnerLabel string    `json:"owner_label"`
		CanUnlink  bool      `json:"can_unlink"`
	}

	var links []models.LedgerFamilyLink
	service.DB.Where("family_ledger_id = ?", familyID).Order("created_at ASC").Find(&links)

	linked := make([]linkedOut, 0, len(links))
	for _, lk := range links {
		var pl models.Ledger
		if err := service.DB.First(&pl, "id = ?", lk.PersonalLedgerID).Error; err != nil {
			continue
		}
		var owner models.User
		_ = service.DB.Select("id", "username", "nickname").First(&owner, "id = ?", pl.OwnerID).Error
		label := owner.Nickname
		if label == "" {
			label = owner.Username
		}
		if label == "" {
			label = pl.OwnerID.String()[:8]
		}
		can := pl.OwnerID == uid || fam.OwnerID == uid
		linked = append(linked, linkedOut{
			LinkID:     lk.ID,
			LedgerID:   pl.ID,
			Name:       pl.Name,
			OwnerID:    pl.OwnerID,
			OwnerLabel: label,
			CanUnlink:  can,
		})
	}

	// Personal ledgers owned by current user, not linked anywhere yet
	var owned []models.Ledger
	service.DB.Where("owner_id = ? AND type = ?", uid, "personal").Order("name ASC").Find(&owned)

	var used []uuid.UUID
	service.DB.Model(&models.LedgerFamilyLink{}).Pluck("personal_ledger_id", &used)
	usedSet := map[uuid.UUID]struct{}{}
	for _, id := range used {
		usedSet[id] = struct{}{}
	}

	candidates := make([]gin.H, 0)
	for _, pl := range owned {
		if _, ok := usedSet[pl.ID]; ok {
			continue
		}
		candidates = append(candidates, gin.H{
			"id":   pl.ID,
			"name": pl.Name,
		})
	}

	c.JSON(http.StatusOK, gin.H{"linked": linked, "candidates": candidates})
}

// LinkPersonalLedger POST /api/ledgers/:id/linked-personal
// Body: { "personal_ledger_id": "<uuid>" }. Caller must own the personal ledger and be a member of the family ledger.
func LinkPersonalLedger(c *gin.Context) {
	uid, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	familyID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}
	var req struct {
		PersonalLedgerID uuid.UUID `json:"personal_ledger_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !userCanAccessLedger(uid, familyID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to family ledger"})
		return
	}
	var fam models.Ledger
	if err := service.DB.First(&fam, "id = ?", familyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}
	if fam.Type != "family" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅家庭账本可关联个人子账本"})
		return
	}

	var pers models.Ledger
	if err := service.DB.First(&pers, "id = ?", req.PersonalLedgerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "personal ledger not found"})
		return
	}
	if pers.Type != "personal" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "只能关联个人类型的账本"})
		return
	}
	if pers.OwnerID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能关联您自己拥有的个人账本"})
		return
	}
	if !userCanAccessLedger(uid, pers.ID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to personal ledger"})
		return
	}

	var existing models.LedgerFamilyLink
	if err := service.DB.Where("personal_ledger_id = ?", pers.ID).First(&existing).Error; err == nil {
		if existing.FamilyLedgerID == familyID {
			c.JSON(http.StatusOK, gin.H{"message": "already linked", "link_id": existing.ID})
			return
		}
		c.JSON(http.StatusConflict, gin.H{"error": "该个人账本已关联到其他家庭账本，请先解除关联"})
		return
	}

	link := models.LedgerFamilyLink{
		FamilyLedgerID:   familyID,
		PersonalLedgerID: pers.ID,
		LinkedByUserID:   uid,
	}
	if err := service.DB.Create(&link).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "关联失败"})
		return
	}
	WriteAuditLog(c, &uid, "ledger.family_link_create", "ledger", strPtr(familyID.String()), map[string]interface{}{
		"personal_ledger_id": pers.ID.String(),
	})
	c.JSON(http.StatusCreated, gin.H{"link_id": link.ID})
}

// UnlinkPersonalLedger DELETE /api/ledgers/:id/linked-personal/:personalLedgerId
// Personal owner or family owner may remove the link.
func UnlinkPersonalLedger(c *gin.Context) {
	uid, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	familyID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}
	personalID, err := uuid.Parse(c.Param("personalLedgerId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid personal ledger id"})
		return
	}
	if !userCanAccessLedger(uid, familyID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access"})
		return
	}
	var fam models.Ledger
	if err := service.DB.First(&fam, "id = ?", familyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}
	if fam.Type != "family" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅家庭账本可管理个人子账本"})
		return
	}

	var pers models.Ledger
	if err := service.DB.First(&pers, "id = ?", personalID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "personal ledger not found"})
		return
	}
	if pers.OwnerID != uid && fam.OwnerID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "仅个人账本所有者或家庭账本所有者可解除关联"})
		return
	}

	res := service.DB.Where("family_ledger_id = ? AND personal_ledger_id = ?", familyID, personalID).Delete(&models.LedgerFamilyLink{})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "解除关联失败"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到关联记录"})
		return
	}
	WriteAuditLog(c, &uid, "ledger.family_link_delete", "ledger", strPtr(familyID.String()), map[string]interface{}{
		"personal_ledger_id": personalID.String(),
	})
	c.Status(http.StatusNoContent)
}
