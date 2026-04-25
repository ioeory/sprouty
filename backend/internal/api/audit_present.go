package api

import (
	"encoding/json"
	"fmt"
	"strings"

	"sprouts-self/backend/internal/models"
	"sprouts-self/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type auditUserRef struct {
	Username string
	Nickname string
	Role     string
}

func auditUserDisplayName(u auditUserRef) string {
	if strings.TrimSpace(u.Nickname) != "" {
		return u.Nickname
	}
	return u.Username
}

func auditUserTitle(u auditUserRef) string {
	name := auditUserDisplayName(u)
	if u.Role == "admin" {
		return fmt.Sprintf("%s（管理员）", name)
	}
	return name
}

func auditParseMetaJSON(raw string) map[string]interface{} {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil
	}
	return m
}

func auditCollectUserAndLedgerIDs(rows []models.AuditLog) (userIDs, ledgerIDs []uuid.UUID) {
	seenU := map[uuid.UUID]struct{}{}
	seenL := map[uuid.UUID]struct{}{}
	addU := func(id uuid.UUID) {
		if id == uuid.Nil {
			return
		}
		if _, ok := seenU[id]; !ok {
			seenU[id] = struct{}{}
			userIDs = append(userIDs, id)
		}
	}
	addL := func(id uuid.UUID) {
		if id == uuid.Nil {
			return
		}
		if _, ok := seenL[id]; !ok {
			seenL[id] = struct{}{}
			ledgerIDs = append(ledgerIDs, id)
		}
	}

	for _, row := range rows {
		if row.ActorUserID != nil {
			addU(*row.ActorUserID)
		}
		meta := auditParseMetaJSON(row.Metadata)
		if row.ResourceID != nil && *row.ResourceID != "" {
			if id, err := uuid.Parse(*row.ResourceID); err == nil {
				switch row.ResourceType {
				case "user":
					addU(id)
				case "ledger":
					addL(id)
				}
			}
		}
		if meta == nil {
			continue
		}
		if s, ok := meta["removed_user_id"].(string); ok {
			if id, err := uuid.Parse(s); err == nil {
				addU(id)
			}
		}
		if s, ok := meta["personal_ledger_id"].(string); ok {
			if id, err := uuid.Parse(s); err == nil {
				addL(id)
			}
		}
	}
	return userIDs, ledgerIDs
}

func auditLoadUserMap(ids []uuid.UUID) map[uuid.UUID]auditUserRef {
	out := map[uuid.UUID]auditUserRef{}
	if len(ids) == 0 {
		return out
	}
	var rows []models.User
	service.DB.Select("id", "username", "nickname", "role").Where("id IN ?", ids).Find(&rows)
	for _, u := range rows {
		out[u.ID] = auditUserRef{Username: u.Username, Nickname: u.Nickname, Role: u.Role}
	}
	return out
}

func auditLoadLedgerMap(ids []uuid.UUID) map[uuid.UUID]models.Ledger {
	out := map[uuid.UUID]models.Ledger{}
	if len(ids) == 0 {
		return out
	}
	var rows []models.Ledger
	service.DB.Select("id", "name", "type").Where("id IN ?", ids).Find(&rows)
	for _, l := range rows {
		out[l.ID] = l
	}
	return out
}

func auditLedgerTitle(m map[uuid.UUID]models.Ledger, id uuid.UUID) string {
	if l, ok := m[id]; ok {
		typeZh := "账本"
		switch l.Type {
		case "family":
			typeZh = "家庭账本"
		case "personal":
			typeZh = "个人账本"
		}
		return fmt.Sprintf("%s「%s」", typeZh, l.Name)
	}
	return fmt.Sprintf("账本（%s）", id.String()[:8])
}

func auditFormatLogItem(row models.AuditLog, users map[uuid.UUID]auditUserRef, ledgers map[uuid.UUID]models.Ledger) gin.H {
	meta := auditParseMetaJSON(row.Metadata)

	actorLabel := "系统"
	var actorRef *auditUserRef
	if row.ActorUserID != nil {
		if u, ok := users[*row.ActorUserID]; ok {
			actorLabel = auditUserTitle(u)
			actorRef = &u
		} else {
			actorLabel = fmt.Sprintf("用户（%s）", row.ActorUserID.String()[:8])
		}
	}

	resourceLabel := "—"
	if row.ResourceType == "settings" || row.ResourceType == "" {
		resourceLabel = "系统设置"
	}
	if row.ResourceID != nil && *row.ResourceID != "" {
		if id, err := uuid.Parse(*row.ResourceID); err == nil {
			switch row.ResourceType {
			case "user":
				if u, ok := users[id]; ok {
					resourceLabel = fmt.Sprintf("用户「%s」", auditUserDisplayName(u))
				} else {
					resourceLabel = fmt.Sprintf("用户（%s）", id.String()[:8])
				}
			case "ledger":
				resourceLabel = auditLedgerTitle(ledgers, id)
			default:
				resourceLabel = fmt.Sprintf("%s / %s", row.ResourceType, id.String()[:8])
			}
		} else {
			resourceLabel = fmt.Sprintf("%s / %s", row.ResourceType, *row.ResourceID)
		}
	} else if row.ResourceType != "" && row.ResourceType != "settings" {
		resourceLabel = row.ResourceType
	}

	summary := auditBuildSummary(row.Action, actorLabel, actorRef, resourceLabel, row, meta, users, ledgers)

	h := gin.H{
		"id":             row.ID.String(),
		"created_at":     row.CreatedAt,
		"action":         row.Action,
		"resource_type":  row.ResourceType,
		"ip":             row.IP,
		"user_agent":     row.UserAgent,
		"metadata":       row.Metadata,
		"actor_label":    actorLabel,
		"resource_label": resourceLabel,
		"summary":        summary,
	}
	if row.ActorUserID != nil {
		h["actor_user_id"] = row.ActorUserID.String()
	} else {
		h["actor_user_id"] = nil
	}
	if row.ResourceID != nil {
		h["resource_id"] = *row.ResourceID
	} else {
		h["resource_id"] = nil
	}
	return h
}

func metaString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

func metaBoolString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case bool:
		if t {
			return "开启"
		}
		return "关闭"
	case float64:
		if t != 0 {
			return "开启"
		}
		return "关闭"
	default:
		return fmt.Sprint(t)
	}
}

func auditBuildSummary(
	action, actorLabel string,
	actorRef *auditUserRef,
	resourceLabel string,
	row models.AuditLog,
	meta map[string]interface{},
	users map[uuid.UUID]auditUserRef,
	ledgers map[uuid.UUID]models.Ledger,
) string {
	// --- Auth ---
	switch action {
	case "auth.login":
		return fmt.Sprintf("%s 使用账号密码登录成功。", actorLabel)
	case "auth.oidc_login":
		iss := metaString(meta, "issuer")
		if iss != "" {
			return fmt.Sprintf("%s 通过 OIDC 登录成功（%s）。", actorLabel, iss)
		}
		return fmt.Sprintf("%s 通过 OIDC 登录成功。", actorLabel)
	case "auth.login_failed":
		reason := metaString(meta, "reason")
		switch reason {
		case "user_not_found":
			u := metaString(meta, "username")
			return fmt.Sprintf("登录失败：用户名「%s」不存在。", u)
		case "bad_password":
			return fmt.Sprintf("%s 登录失败：密码错误。", actorLabel)
		case "inactive_user":
			return fmt.Sprintf("%s 登录失败：账号已被禁用。", actorLabel)
		case "oidc_only_user":
			return fmt.Sprintf("%s 登录失败：该账号仅支持 OIDC 登录。", actorLabel)
		default:
			if reason != "" {
				return fmt.Sprintf("%s 登录失败（%s）。", actorLabel, reason)
			}
			return fmt.Sprintf("%s 登录失败。", actorLabel)
		}
	case "auth.register":
		roleZh := "普通用户"
		if metaString(meta, "role") == "admin" {
			roleZh = "管理员（首个注册用户）"
		}
		u := metaString(meta, "username")
		if u == "" && actorRef != nil {
			u = actorRef.Username
		}
		return fmt.Sprintf("%s 完成自助注册（用户名 %s，角色：%s）。", actorLabel, u, roleZh)
	case "auth.register_oidc":
		roleZh := "普通用户"
		if metaString(meta, "role") == "admin" {
			roleZh = "管理员（首个注册用户）"
		}
		u := metaString(meta, "username")
		return fmt.Sprintf("%s 通过 OIDC 完成注册（用户名 %s，角色：%s）。", actorLabel, u, roleZh)
	case "auth.register_denied":
		u := metaString(meta, "username")
		return fmt.Sprintf("注册被拒绝：公开注册已关闭，尝试用户名「%s」。", u)
	}

	// --- Admin ---
	switch action {
	case "admin.settings_update":
		if m, ok := meta["registration_open"].(map[string]interface{}); ok {
			from := metaBoolString(m, "from")
			to := metaBoolString(m, "to")
			if from != "" && to != "" {
				return fmt.Sprintf("%s 修改系统设置：「公开注册」由 %s 调整为 %s。", actorLabel, from, to)
			}
		}
		return fmt.Sprintf("%s 修改了系统设置。", actorLabel)
	case "admin.user_create":
		u := metaString(meta, "username")
		role := metaString(meta, "role")
		if role == "admin" {
			role = "管理员"
		} else {
			role = "普通用户"
		}
		return fmt.Sprintf("%s 在后台创建新用户「%s」（角色：%s）。", actorLabel, u, role)
	case "admin.user_reset_password":
		return fmt.Sprintf("%s 重置了 %s 的登录密码。", actorLabel, resourceLabel)
	case "admin.user_status":
		verb := "更新"
		if b, ok := meta["to"].(bool); ok {
			if b {
				verb = "启用"
			} else {
				verb = "禁用"
			}
		} else {
			to := metaString(meta, "to")
			if to == "true" || to == "1" {
				verb = "启用"
			} else if to == "false" || to == "0" {
				verb = "禁用"
			}
		}
		return fmt.Sprintf("%s %s了 %s。", actorLabel, verb, resourceLabel)
	}

	// --- Ledger ---
	switch action {
	case "ledger.create":
		n := metaString(meta, "name")
		lt := metaString(meta, "type")
		if lt == "family" {
			lt = "家庭账本"
		} else {
			lt = "个人账本"
		}
		return fmt.Sprintf("%s 新建%s「%s」。", actorLabel, lt, n)
	case "ledger.update":
		from := metaString(meta, "from")
		to := metaString(meta, "to")
		return fmt.Sprintf("%s 将 %s 名称由「%s」改为「%s」。", actorLabel, resourceLabel, from, to)
	case "ledger.invite_created":
		return fmt.Sprintf("%s 为 %s 生成成员邀请（24 小时内有效）。", actorLabel, resourceLabel)
	case "ledger.join":
		return fmt.Sprintf("%s 使用邀请码加入了 %s。", actorLabel, resourceLabel)
	case "ledger.member_removed":
		rid := metaString(meta, "removed_user_id")
		target := "某成员"
		if id, err := uuid.Parse(rid); err == nil {
			if u, ok := users[id]; ok {
				target = fmt.Sprintf("成员「%s」", auditUserDisplayName(u))
			} else {
				target = fmt.Sprintf("成员（%s）", id.String()[:8])
			}
		}
		return fmt.Sprintf("%s 将 %s 从 %s 中移除。", actorLabel, target, resourceLabel)
	case "ledger.family_link_create":
		if row.ResourceID == nil {
			return fmt.Sprintf("%s 关联了个人子账本到家庭账本。", actorLabel)
		}
		famID, err1 := uuid.Parse(*row.ResourceID)
		plStr := metaString(meta, "personal_ledger_id")
		pid, err2 := uuid.Parse(plStr)
		if err1 != nil || err2 != nil {
			return fmt.Sprintf("%s 关联个人子账本到家庭账本。", actorLabel)
		}
		sub := auditLedgerTitle(ledgers, pid)
		fam := auditLedgerTitle(ledgers, famID)
		return fmt.Sprintf("%s 将 %s 关联到 %s（家庭流水将合并统计）。", actorLabel, sub, fam)
	case "ledger.family_link_delete":
		if row.ResourceID == nil {
			return fmt.Sprintf("%s 解除了个人子账本与家庭账本的关联。", actorLabel)
		}
		famID, err1 := uuid.Parse(*row.ResourceID)
		plStr := metaString(meta, "personal_ledger_id")
		pid, err2 := uuid.Parse(plStr)
		if err1 != nil || err2 != nil {
			return fmt.Sprintf("%s 解除了个人子账本与家庭账本的关联。", actorLabel)
		}
		sub := auditLedgerTitle(ledgers, pid)
		fam := auditLedgerTitle(ledgers, famID)
		return fmt.Sprintf("%s 解除了 %s 与 %s 的关联。", actorLabel, sub, fam)
	}

	return fmt.Sprintf("%s 执行操作「%s」，对象：%s。", actorLabel, action, resourceLabel)
}

// FormatAuditLogItems enriches raw audit rows with Chinese labels and a one-line summary.
func FormatAuditLogItems(rows []models.AuditLog) []gin.H {
	userIDs, ledgerIDs := auditCollectUserAndLedgerIDs(rows)
	users := auditLoadUserMap(userIDs)
	ledgers := auditLoadLedgerMap(ledgerIDs)
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, auditFormatLogItem(row, users, ledgers))
	}
	return out
}
