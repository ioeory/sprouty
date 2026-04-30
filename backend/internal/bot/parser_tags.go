package bot

import "strings"

// StripTagHints removes `l:xxx` / `标签:xxx` markers (same rules as ParseMessage)
// and returns the cleaned text plus deduplicated tag names in encounter order.
func StripTagHints(text string) (cleaned string, hints []string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", nil
	}
	if matches := tagMarkerRe.FindAllStringSubmatchIndex(text, -1); len(matches) > 0 {
		seen := map[string]bool{}
		for i := len(matches) - 1; i >= 0; i-- {
			m := matches[i]
			name := strings.TrimSpace(text[m[2]:m[3]])
			if name != "" {
				key := strings.ToLower(name)
				if !seen[key] {
					seen[key] = true
					hints = append([]string{name}, hints...)
				}
			}
			text = text[:m[0]] + " " + text[m[1]:]
		}
	}
	text = strings.NewReplacer("，", " ", "、", " ", ",", " ").Replace(text)
	cleaned = strings.TrimSpace(strings.Join(strings.Fields(text), " "))
	return cleaned, hints
}
