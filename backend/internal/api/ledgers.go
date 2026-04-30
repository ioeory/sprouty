package api

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const inviteCharset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func randomInviteCode(n int) string {
	b := make([]byte, n)
	for i := 0; i < n; i++ {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(inviteCharset))))
		if err != nil {
			return fmt.Sprintf("%d", time.Now().UnixNano())[:n]
		}
		b[i] = inviteCharset[idx.Int64()]
	}
	return string(b)
}

// CreateLedgerInvite issues a one-time invitation code for joining the ledger.
// Only existing members can generate invites.
func CreateLedgerInvite(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	ledgerIDStr := c.Param("id")
	ledgerID, err := uuid.Parse(ledgerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}

	if !userCanAccessLedger(userID, ledgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}
	if respondLedgerViewerForbidden(c, userID, ledgerID) {
		return
	}

	invite := models.LedgerInvite{
		LedgerID:  ledgerID,
		Code:      randomInviteCode(8),
		InviterID: userID,
		ExpiresAt: time.Now().Add(24 * time.Hour).Unix(),
	}
	if err := service.DB.Create(&invite).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create invite"})
		return
	}

	WriteAuditLog(c, &userID, "ledger.invite_created", "ledger", strPtr(ledgerID.String()), nil)

	c.JSON(http.StatusOK, gin.H{
		"code":       invite.Code,
		"expires_in": 24 * 60 * 60,
	})
}

// JoinLedger uses an invitation code to add the current user to a ledger.
func JoinLedger(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var invite models.LedgerInvite
	if err := service.DB.Where("code = ? AND expires_at > ?", req.Code, time.Now().Unix()).First(&invite).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invitation invalid or expired"})
		return
	}

	if userCanAccessLedger(userID, invite.LedgerID) {
		c.JSON(http.StatusOK, gin.H{"message": "already a member", "ledger_id": invite.LedgerID})
		return
	}

	if err := service.DB.Exec(
		"INSERT INTO ledger_users (user_id, ledger_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
		userID, invite.LedgerID,
	).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to join ledger"})
		return
	}

	// Delete the invite (one-time use)
	service.DB.Delete(&invite)

	var ledger models.Ledger
	service.DB.First(&ledger, "id = ?", invite.LedgerID)

	WriteAuditLog(c, &userID, "ledger.join", "ledger", strPtr(invite.LedgerID.String()), map[string]interface{}{
		"code_used": true,
	})

	c.JSON(http.StatusOK, gin.H{
		"message":   "joined successfully",
		"ledger_id": invite.LedgerID,
		"ledger":    ledger,
	})
}

// GetLedgerMembers returns users who share a ledger.
func GetLedgerMembers(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	ledgerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}
	if !userCanAccessLedger(userID, ledgerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no access to this ledger"})
		return
	}

	var ledger models.Ledger
	if err := service.DB.Preload("Members").First(&ledger, "id = ?", ledgerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}

	type roleRow struct {
		UserID     uuid.UUID `gorm:"column:user_id"`
		MemberRole string    `gorm:"column:member_role"`
	}
	var roleRows []roleRow
	_ = service.DB.Table("ledger_users").
		Select("user_id, COALESCE(NULLIF(TRIM(member_role), ''), 'editor') as member_role").
		Where("ledger_id = ?", ledgerID).
		Scan(&roleRows).Error
	roleOf := make(map[uuid.UUID]string, len(roleRows))
	for _, r := range roleRows {
		roleOf[r.UserID] = r.MemberRole
	}

	type memberDTO struct {
		ID         uuid.UUID `json:"id"`
		Username   string    `json:"username"`
		Nickname   string    `json:"nickname"`
		Email      *string   `json:"email"`
		IsOwner    bool      `json:"is_owner"`
		MemberRole string    `json:"member_role"`
	}
	members := make([]memberDTO, 0, len(ledger.Members))
	for _, m := range ledger.Members {
		mr := roleOf[m.ID]
		if mr == "" {
			mr = "editor"
		}
		if m.ID == ledger.OwnerID {
			mr = "owner"
		}
		members = append(members, memberDTO{
			ID:         m.ID,
			Username:   m.Username,
			Nickname:   m.Nickname,
			Email:      m.Email,
			IsOwner:    m.ID == ledger.OwnerID,
			MemberRole: mr,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"ledger":   ledger,
		"members":  members,
		"is_owner": ledger.OwnerID == userID,
	})
}

// PutLedgerMemberRole sets member_role (editor | viewer) for a non-owner member. Owner only.
func PutLedgerMemberRole(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	ledgerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}
	memberID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	var req struct {
		MemberRole string `json:"member_role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	role := strings.ToLower(strings.TrimSpace(req.MemberRole))
	if role != "editor" && role != "viewer" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "member_role must be editor or viewer"})
		return
	}

	var ledger models.Ledger
	if err := service.DB.First(&ledger, "id = ?", ledgerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}
	if ledger.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the owner can change member roles"})
		return
	}
	if memberID == ledger.OwnerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change owner role"})
		return
	}
	var n int64
	service.DB.Table("ledger_users").Where("user_id = ? AND ledger_id = ?", memberID, ledgerID).Count(&n)
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user is not a member of this ledger"})
		return
	}

	if err := service.DB.Exec(
		"UPDATE ledger_users SET member_role = ? WHERE user_id = ? AND ledger_id = ?",
		role, memberID, ledgerID,
	).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update role"})
		return
	}

	WriteAuditLog(c, &userID, "ledger.member_role", "ledger", strPtr(ledgerID.String()), map[string]interface{}{
		"target_user_id": memberID.String(),
		"member_role":    role,
	})

	c.JSON(http.StatusOK, gin.H{"ok": true, "member_role": role})
}

// RemoveLedgerMember kicks a member from a ledger (owner-only; cannot remove owner).
func RemoveLedgerMember(c *gin.Context) {
	userID, err := currentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}

	ledgerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ledger id"})
		return
	}
	memberID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var ledger models.Ledger
	if err := service.DB.First(&ledger, "id = ?", ledgerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger not found"})
		return
	}
	if ledger.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the owner can remove members"})
		return
	}
	if memberID == ledger.OwnerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove ledger owner"})
		return
	}

	if err := service.DB.Exec(
		"DELETE FROM ledger_users WHERE user_id = ? AND ledger_id = ?",
		memberID, ledgerID,
	).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove member"})
		return
	}

	WriteAuditLog(c, &userID, "ledger.member_removed", "ledger", strPtr(ledgerID.String()), map[string]interface{}{
		"removed_user_id": memberID.String(),
	})

	c.Status(http.StatusNoContent)
}
