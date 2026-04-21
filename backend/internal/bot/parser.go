package bot

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ParseResult is the output of the quick-record parser pipeline. Pure-data,
// no DB access - the caller (telegram.go) uses these fields to resolve the
// ledger / category and write the transaction.
type ParseResult struct {
	Amount       float64   // required; 0 means no amount found
	Type         string    // "expense" or "income"
	Note         string    // parenthetical content concatenated
	Date         time.Time // resolved transaction date
	DateResolved bool      // true if user specified a date explicitly
	LedgerHint   string    // ledger keyword match (empty = use default)
	CategoryHint string    // remaining text after all other extractions
	TagHints     []string  // names of tags requested via l:xxx / 标签:xxx
}

// -------- regex pool (package-level, compiled once) --------

var (
	// Catches both ASCII (...) and full-width （...）. Non-greedy inner group.
	parenRe = regexp.MustCompile(`[（(]([^）)]*)[)）]`)

	// Last numeric run wins. Optional currency sigils on either side.
	amountRe = regexp.MustCompile(`[¥￥$]?(\d+(?:\.\d+)?)[元¥￥]?`)

	// Date helpers. Order matters: more specific patterns first.
	dateYestRe      = regexp.MustCompile(`昨天`)
	dateBeforeYeRe  = regexp.MustCompile(`前天`)
	dateTodayRe     = regexp.MustCompile(`今天`)
	// Intentionally omits '.' as a separator to avoid eating decimal amounts
	// like "12.5". Users who want a short-hand date can use 8-23 / 8/23 / 8月23.
	dateFullRe      = regexp.MustCompile(`(\d{1,2})[月\-/](\d{1,2})[号日]?`)
	dateDayOnlyRe   = regexp.MustCompile(`(\d{1,2})[号日]`)                   // 23号 / 23日
	incomeMarkerRe  = regexp.MustCompile(`(?i)(^|\s|，|,)(收到|收入|退款|\+)(\s|，|,|$)`)
	expenseMarkerRe = regexp.MustCompile(`(^|\s)-(\s|$)`) // leading minus

	// Tag shortcut: `l:xxx`, `L:xxx`, `标签:xxx`, and their full-width colon
	// variants. Tag name runs until whitespace / comma / end-of-string.
	// Examples:
	//   "午餐 50 l:报销"          -> TagHints=["报销"]
	//   "滴滴 30 L:出行,L:报销"    -> TagHints=["出行", "报销"]
	//   "标签：公账 午餐 50"       -> TagHints=["公账"]
	tagMarkerRe = regexp.MustCompile(`(?i)(?:^|\s|[,，、])(?:l|标签)[:：]([^\s,，、]+)`)
)

// ParseMessage runs the full pipeline against raw input. It does NOT touch the
// database; callers resolve ledger / category lookups separately. The pipeline
// is intentionally linear — each step "eats" the tokens it recognizes so later
// steps see clean leftover text.
//
// Pipeline:
//
//	1. Strip parenthetical notes (they never participate in keyword matching)
//	2. Detect income markers ("收到 / 收入 / + / 退款")
//	3. Ledger keywords are left to the caller (they need DB lookup); we only
//	   produce a hint field with the first N words so the caller can try to
//	   match them. But here we go one further: we don't try to extract the
//	   ledger here - the caller does that and feeds back remaining text.
//	   -> Actually the cleanest split: this function handles everything that
//	      doesn't need DB. Ledger / category resolution happens after.
//	4. Extract smart date
//	5. Extract last-run amount
//	6. Whatever is left becomes CategoryHint
//
// ledgerKeywords is an optional map (keyword -> "ledger_id") the caller passes
// in so we can handle step 3 here. If empty, LedgerHint stays "".
func ParseMessage(raw string, now time.Time, ledgerKeywords map[string]string) ParseResult {
	res := ParseResult{
		Type: "expense",
		Date: now,
	}

	text := strings.TrimSpace(raw)
	if text == "" {
		return res
	}

	// --- Step 1: parenthetical notes ---
	notes := []string{}
	text = parenRe.ReplaceAllStringFunc(text, func(m string) string {
		sub := parenRe.FindStringSubmatch(m)
		if len(sub) > 1 {
			n := strings.TrimSpace(sub[1])
			if n != "" {
				notes = append(notes, n)
			}
		}
		return " " // replace with space so surrounding tokens don't merge
	})
	res.Note = strings.Join(notes, " ")

	// --- Step 2: type markers ---
	if loc := incomeMarkerRe.FindStringIndex(text); loc != nil {
		res.Type = "income"
		// Replace the matched range with a space.
		text = text[:loc[0]] + " " + text[loc[1]:]
	} else if loc := expenseMarkerRe.FindStringIndex(text); loc != nil {
		// explicit '-' marker is just the default; still strip so it doesn't leak
		text = text[:loc[0]] + " " + text[loc[1]:]
	}

	// --- Step 2.5: tag hints (l:xxx / 标签:xxx), extracted BEFORE ledger
	// keyword matching so a user-defined tag name can't be mistaken for a
	// ledger keyword. Every match is eaten; the tag name is deduplicated
	// case-insensitively.
	if matches := tagMarkerRe.FindAllStringSubmatchIndex(text, -1); len(matches) > 0 {
		seen := map[string]bool{}
		// Replace from the tail so earlier indexes stay valid.
		for i := len(matches) - 1; i >= 0; i-- {
			m := matches[i]
			name := strings.TrimSpace(text[m[2]:m[3]])
			if name != "" {
				key := strings.ToLower(name)
				if !seen[key] {
					seen[key] = true
					res.TagHints = append([]string{name}, res.TagHints...)
				}
			}
			text = text[:m[0]] + " " + text[m[1]:]
		}
	}

	// --- Step 3: ledger keyword (longest match wins, case-insensitive) ---
	if len(ledgerKeywords) > 0 {
		lowerText := strings.ToLower(text)
		bestKW := ""
		bestID := ""
		for kw, lid := range ledgerKeywords {
			k := strings.ToLower(kw)
			if k == "" {
				continue
			}
			if strings.Contains(lowerText, k) && len(k) > len(bestKW) {
				bestKW = k
				bestID = lid
			}
		}
		if bestKW != "" {
			res.LedgerHint = bestID
			// Case-insensitive removal of the match
			if idx := strings.Index(lowerText, bestKW); idx >= 0 {
				text = text[:idx] + " " + text[idx+len(bestKW):]
			}
		}
	}

	// --- Step 4: smart date ---
	text = extractDate(text, now, &res)

	// --- Step 5: amount (last numeric run wins) ---
	if loc := amountRe.FindAllStringSubmatchIndex(text, -1); len(loc) > 0 {
		last := loc[len(loc)-1]
		fullStart, fullEnd := last[0], last[1]
		numStart, numEnd := last[2], last[3]
		if v, err := strconv.ParseFloat(text[numStart:numEnd], 64); err == nil && v > 0 {
			res.Amount = v
			text = text[:fullStart] + " " + text[fullEnd:]
		}
	}

	// --- Step 6: category hint (normalize punctuation, collapse spaces) ---
	text = strings.NewReplacer("，", " ", "、", " ", ",", " ").Replace(text)
	text = strings.TrimSpace(strings.Join(strings.Fields(text), " "))
	res.CategoryHint = text

	// If the user didn't write any parenthetical note, fall back to the hint
	// so the transaction carries something human-readable.
	if res.Note == "" {
		res.Note = text
	}

	return res
}

// extractDate looks for 昨天/前天/今天/M月D/D号 patterns, mutates ResolveTime into
// res, and returns the text with the matched substring replaced by a space.
func extractDate(text string, now time.Time, res *ParseResult) string {
	replace := func(s string, loc []int) string {
		if loc == nil {
			return s
		}
		return s[:loc[0]] + " " + s[loc[1]:]
	}

	if loc := dateBeforeYeRe.FindStringIndex(text); loc != nil {
		res.Date = startOfDay(now).AddDate(0, 0, -2)
		res.DateResolved = true
		return replace(text, loc)
	}
	if loc := dateYestRe.FindStringIndex(text); loc != nil {
		res.Date = startOfDay(now).AddDate(0, 0, -1)
		res.DateResolved = true
		return replace(text, loc)
	}
	if loc := dateTodayRe.FindStringIndex(text); loc != nil {
		res.Date = now
		res.DateResolved = true
		return replace(text, loc)
	}

	if m := dateFullRe.FindStringSubmatchIndex(text); m != nil {
		month, _ := strconv.Atoi(text[m[2]:m[3]])
		day, _ := strconv.Atoi(text[m[4]:m[5]])
		if month >= 1 && month <= 12 && day >= 1 && day <= 31 {
			y := now.Year()
			candidate := time.Date(y, time.Month(month), day, 0, 0, 0, 0, now.Location())
			// If the candidate is in the future (date hasn't happened this year), roll back a year.
			if candidate.After(now) {
				candidate = candidate.AddDate(-1, 0, 0)
			}
			res.Date = candidate
			res.DateResolved = true
			return text[:m[0]] + " " + text[m[1]:]
		}
	}

	if m := dateDayOnlyRe.FindStringSubmatchIndex(text); m != nil {
		day, _ := strconv.Atoi(text[m[2]:m[3]])
		if day >= 1 && day <= 31 {
			candidate := time.Date(now.Year(), now.Month(), day, 0, 0, 0, 0, now.Location())
			// If that day hasn't arrived this month yet, treat it as last month
			if candidate.After(now) {
				candidate = candidate.AddDate(0, -1, 0)
			}
			res.Date = candidate
			res.DateResolved = true
			return text[:m[0]] + " " + text[m[1]:]
		}
	}

	return text
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}
