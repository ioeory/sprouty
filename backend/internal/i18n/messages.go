package i18n

// Msg is a user-visible API or UI-facing string in zh and en.
type Msg struct {
	ZH string
	EN string
}

// Messages maps stable codes to localized text.
var Messages = map[string]Msg{
	"auth.registration_closed":     {ZH: "公开注册已关闭，请联系管理员", EN: "Public registration is closed. Contact an administrator."},
	"auth.invalid_credentials":   {ZH: "用户名或密码错误", EN: "Invalid username or password."},
	"auth.oidc_only":             {ZH: "此账号仅支持 OIDC 登录", EN: "This account can only sign in with OIDC."},
	"auth.account_disabled":      {ZH: "账号已被禁用，请联系管理员", EN: "This account is disabled. Contact an administrator."},
	"ledger.type_invalid":        {ZH: "账本类型必须是 personal 或 family", EN: "Ledger type must be personal or family."},
	"ledger.demote_requires_unlink_children": {ZH: "请先解除本家庭账本下所有关联的个人子账本，再改为个人账本。", EN: "Unlink all personal sub-ledgers from this family book before changing type to personal."},
	"ledger.promote_requires_unlink_parent":  {ZH: "请先解除本账本作为子账本与家庭账本的关联，再改为家庭账本。", EN: "Unlink this ledger from its parent family book before changing type to family."},
	"ledger.create_failed":       {ZH: "创建账本失败", EN: "Failed to create ledger."},
	"common.bad_request":         {ZH: "请求无效", EN: "Bad request."},
	"common.internal_error":      {ZH: "服务器错误", EN: "Internal server error."},
	"user.locale_invalid":        {ZH: "语言必须是 zh-CN 或 en", EN: "Locale must be zh-CN or en."},
	"user.locale_updated":        {ZH: "语言偏好已更新", EN: "Locale preference updated."},

	"oidc.not_configured":           {ZH: "OIDC 未配置", EN: "OIDC is not configured."},
	"oidc.provider_init_failed":     {ZH: "无法连接 OIDC 提供商", EN: "Could not initialize OIDC provider."},
	"oidc.missing_state_cookie":     {ZH: "缺少 state Cookie", EN: "Missing state cookie."},
	"oidc.state_mismatch":           {ZH: "state 不匹配", EN: "State mismatch."},
	"oidc.missing_code":             {ZH: "缺少授权码", EN: "Missing authorization code."},
	"oidc.token_exchange_failed":    {ZH: "令牌交换失败", EN: "Token exchange failed."},
	"oidc.id_token_missing":         {ZH: "响应中缺少 id_token", EN: "id_token missing in response."},
	"oidc.id_token_invalid":         {ZH: "id_token 无效", EN: "Invalid id_token."},
	"oidc.claims_invalid":           {ZH: "无法解析身份声明", EN: "Could not parse identity claims."},
	"oidc.exchange_store_failed":    {ZH: "保存登录会话失败", EN: "Failed to persist login session."},
	"oidc.exchange_invalid":         {ZH: "无效或已过期的登录凭证", EN: "Invalid or expired login credential."},
	"oidc.exchange_expired":         {ZH: "登录凭证已过期", EN: "Login credential has expired."},
	"oidc.user_missing":             {ZH: "用户不存在", EN: "User not found."},
	"oidc.token_sign_failed":        {ZH: "签发令牌失败", EN: "Could not issue token."},
}

// T returns the message for locale (zh or en). Unknown codes return code.
func T(locale, code string) string {
	m, ok := Messages[code]
	if !ok {
		return code
	}
	if locale == "en" {
		return m.EN
	}
	return m.ZH
}
