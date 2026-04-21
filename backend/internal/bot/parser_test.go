package bot

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestParseMessage covers the verification matrix in the plan:
// basic / date / type / note / ledger switch / priority (priority is resolved in
// the category-lookup layer, tested via a separate category-resolution test).
func TestParseMessage(t *testing.T) {
	// Fixed "now" so date assertions stay stable.
	// 2026-04-21 is a Tuesday.
	now := time.Date(2026, 4, 21, 14, 30, 0, 0, time.Local)

	ledgers := map[string]string{
		"生意": "biz-ledger-id",
	}

	cases := []struct {
		name         string
		input        string
		wantAmount   float64
		wantType     string
		wantCat      string // category hint
		wantNote     string
		wantLedger   string // "" = default
		wantDate     time.Time
		dateResolved bool
	}{
		{
			name:       "basic amount + category",
			input:      "50 饭",
			wantAmount: 50,
			wantType:   "expense",
			wantCat:    "饭",
			wantNote:   "饭",
			wantDate:   now,
		},
		{
			name:       "category + amount joined",
			input:      "午餐50",
			wantAmount: 50,
			wantType:   "expense",
			wantCat:    "午餐",
			wantNote:   "午餐",
			wantDate:   now,
		},
		{
			name:         "yesterday + category",
			input:        "昨天 打车 38",
			wantAmount:   38,
			wantType:     "expense",
			wantCat:      "打车",
			wantNote:     "打车",
			dateResolved: true,
			wantDate:     startOfDay(now).AddDate(0, 0, -1),
		},
		{
			name:       "income marker",
			input:      "收入 工资 8000",
			wantAmount: 8000,
			wantType:   "income",
			wantCat:    "工资",
			wantNote:   "工资",
			wantDate:   now,
		},
		{
			name:       "parenthetical note",
			input:      "午饭 20 (同事代付)",
			wantAmount: 20,
			wantType:   "expense",
			wantCat:    "午饭",
			wantNote:   "同事代付",
			wantDate:   now,
		},
		{
			name:       "fullwidth parenthesis",
			input:      "午饭 20 （同事代付）",
			wantAmount: 20,
			wantCat:    "午饭",
			wantNote:   "同事代付",
			wantDate:   now,
		},
		{
			name:       "ledger switch",
			input:      "生意 午饭 20",
			wantAmount: 20,
			wantCat:    "午饭",
			wantNote:   "午饭",
			wantLedger: "biz-ledger-id",
			wantDate:   now,
		},
		{
			name:         "explicit full date this year, past",
			input:        "3月15号 买鞋 300",
			wantAmount:   300,
			wantCat:      "买鞋",
			wantNote:     "买鞋",
			dateResolved: true,
			wantDate:     time.Date(2026, 3, 15, 0, 0, 0, 0, now.Location()),
		},
		{
			name:         "explicit full date this year, future -> rolls back",
			input:        "8月23号 买鞋 300",
			wantAmount:   300,
			wantCat:      "买鞋",
			wantNote:     "买鞋",
			dateResolved: true,
			wantDate:     time.Date(2025, 8, 23, 0, 0, 0, 0, now.Location()),
		},
		{
			name:         "day only before today this month",
			input:        "15号 午饭 20",
			wantAmount:   20,
			wantCat:      "午饭",
			wantNote:     "午饭",
			dateResolved: true,
			wantDate:     time.Date(2026, 4, 15, 0, 0, 0, 0, now.Location()),
		},
		{
			name:         "day only after today this month -> last month",
			input:        "28号 午饭 20",
			wantAmount:   20,
			wantCat:      "午饭",
			wantNote:     "午饭",
			dateResolved: true,
			wantDate:     time.Date(2026, 3, 28, 0, 0, 0, 0, now.Location()),
		},
		{
			name:       "currency symbols",
			input:      "¥12.5 咖啡",
			wantAmount: 12.5,
			wantCat:    "咖啡",
			wantNote:   "咖啡",
			wantDate:   now,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseMessage(tc.input, now, ledgers)
			if got.Amount != tc.wantAmount {
				t.Errorf("amount: got %v, want %v", got.Amount, tc.wantAmount)
			}
			if tc.wantType != "" && got.Type != tc.wantType {
				t.Errorf("type: got %q, want %q", got.Type, tc.wantType)
			}
			if got.CategoryHint != tc.wantCat {
				t.Errorf("category hint: got %q, want %q", got.CategoryHint, tc.wantCat)
			}
			if got.Note != tc.wantNote {
				t.Errorf("note: got %q, want %q", got.Note, tc.wantNote)
			}
			if got.LedgerHint != tc.wantLedger {
				t.Errorf("ledger hint: got %q, want %q", got.LedgerHint, tc.wantLedger)
			}
			if tc.dateResolved && !got.DateResolved {
				t.Errorf("expected DateResolved=true, got false")
			}
			if !tc.dateResolved && got.DateResolved {
				t.Errorf("expected DateResolved=false, got true")
			}
			if !got.Date.Equal(tc.wantDate) {
				t.Errorf("date: got %v, want %v", got.Date, tc.wantDate)
			}
		})
	}
}

// TestParseMessageTagHints verifies the l:xxx / 标签:xxx tag extraction.
// Dedicated table because tag hints are order-sensitive and frequently
// appear alongside other tokens (date / amount / ledger) that must still
// parse correctly.
func TestParseMessageTagHints(t *testing.T) {
	now := time.Date(2026, 4, 21, 14, 30, 0, 0, time.Local)
	ledgers := map[string]string{"生意": "biz-ledger-id"}

	cases := []struct {
		name       string
		input      string
		wantAmount float64
		wantCat    string
		wantTags   []string
	}{
		{
			name:       "single ascii l: at end",
			input:      "午饭 20 l:报销",
			wantAmount: 20,
			wantCat:    "午饭",
			wantTags:   []string{"报销"},
		},
		{
			name:       "multiple tags with mixed case",
			input:      "打车 30 L:出行 l:报销",
			wantAmount: 30,
			wantCat:    "打车",
			wantTags:   []string{"出行", "报销"},
		},
		{
			name:       "fullwidth colon + chinese marker",
			input:      "标签：公账 午饭 50",
			wantAmount: 50,
			wantCat:    "午饭",
			wantTags:   []string{"公账"},
		},
		{
			name:       "tag at start",
			input:      "l:报销 午饭 50",
			wantAmount: 50,
			wantCat:    "午饭",
			wantTags:   []string{"报销"},
		},
		{
			name:       "duplicates collapsed case-insensitively",
			input:      "午饭 20 l:报销 L:报销",
			wantAmount: 20,
			wantCat:    "午饭",
			wantTags:   []string{"报销"},
		},
		{
			name:       "tags do not eat ledger keyword",
			input:      "生意 午饭 20 l:报销",
			wantAmount: 20,
			wantCat:    "午饭",
			wantTags:   []string{"报销"},
		},
		{
			name:       "no tags when not using marker",
			input:      "午饭 l 20",
			wantAmount: 20,
			wantCat:    "午饭 l",
			wantTags:   nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseMessage(tc.input, now, ledgers)
			if got.Amount != tc.wantAmount {
				t.Errorf("amount: got %v, want %v", got.Amount, tc.wantAmount)
			}
			// CategoryHint can be whitespace-normalized; compare trimmed.
			if strings.TrimSpace(got.CategoryHint) != tc.wantCat {
				t.Errorf("category hint: got %q, want %q", got.CategoryHint, tc.wantCat)
			}
			if !reflect.DeepEqual(got.TagHints, tc.wantTags) {
				t.Errorf("tag hints: got %v, want %v", got.TagHints, tc.wantTags)
			}
		})
	}
}
