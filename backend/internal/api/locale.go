package api

import (
	"strings"

	"sprouts-self/backend/internal/i18n"

	"github.com/gin-gonic/gin"
)

const ctxLocaleKey = "locale"

// LocaleMiddleware parses Accept-Language and X-App-Locale into c locale: "zh" or "en".
func LocaleMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(ctxLocaleKey, resolveLocale(c.GetHeader("X-App-Locale"), c.GetHeader("Accept-Language")))
		c.Next()
	}
}

func resolveLocale(appLocale, accept string) string {
	if s := strings.TrimSpace(strings.ToLower(appLocale)); s != "" {
		if strings.HasPrefix(s, "en") {
			return "en"
		}
		return "zh"
	}
	// BCP-47-ish: first language tag wins
	for _, part := range strings.Split(accept, ",") {
		tag := strings.TrimSpace(strings.Split(part, ";")[0])
		tag = strings.ToLower(tag)
		if strings.HasPrefix(tag, "en") {
			return "en"
		}
		if strings.HasPrefix(tag, "zh") {
			return "zh"
		}
	}
	return "zh"
}

// Locale returns "zh" or "en" from Gin context.
func Locale(c *gin.Context) string {
	if v, ok := c.Get(ctxLocaleKey); ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return "zh"
}

// ErrorJSON builds a JSON error body with localized message and stable code.
func ErrorJSON(c *gin.Context, code string) gin.H {
	return gin.H{
		"error": i18n.T(Locale(c), code),
		"code":  code,
	}
}
