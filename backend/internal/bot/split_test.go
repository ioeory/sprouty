package bot

import (
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"sprouts-self/backend/internal/models"
)

func TestMatchSplitTrigger(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"分账100 水果 TEST", "100 水果 TEST"},
		{"分账　100 水果", "100 水果"},
		{"split 100 fruit", "100 fruit"},
		{"SPLIT100 fruit", "100 fruit"},
		{"aa 100 fruit", "100 fruit"},
		{"AA100 fruit", "100 fruit"},
		{"100 分账 水果 TEST 0507", "100 水果 TEST 0507"},
		{"100分账 水果 TEST", "100 水果 TEST"},
		{"¥100 分账 水果", "100 水果"},
		{"100 aa fruit 0507", "100 fruit 0507"},
	}
	for _, tc := range cases {
		got, ok := matchSplitTrigger(tc.input)
		if !ok {
			t.Fatalf("matchSplitTrigger(%q) did not match", tc.input)
		}
		if got != tc.want {
			t.Fatalf("matchSplitTrigger(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestParseSplitArgsAllocations(t *testing.T) {
	a1 := models.Ledger{Base: models.Base{ID: uuid.New()}, Name: "A1"}
	a2 := models.Ledger{Base: models.Base{ID: uuid.New()}, Name: "A2"}
	subs := map[string]models.Ledger{
		"a1": a1,
		"a2": a2,
	}

	got, msg := parseSplitArgs("100 水果 TEST 40A1(40-A1) 60@A2(60-A2) l:报销", subs)
	if msg != "" {
		t.Fatalf("parseSplitArgs returned error: %s", msg)
	}
	if !got.haveTotal || got.total != 100 {
		t.Fatalf("total = %v/%v, want 100/true", got.total, got.haveTotal)
	}
	if got.freeText != "水果 TEST l:报销" {
		t.Fatalf("freeText = %q", got.freeText)
	}
	if len(got.allocs) != 2 {
		t.Fatalf("alloc len = %d", len(got.allocs))
	}
	if got.allocs[0].ledger.ID != a1.ID || got.allocs[0].amount != 40 || got.allocs[0].note != "40-A1" {
		t.Fatalf("first alloc = %+v", got.allocs[0])
	}
	if got.allocs[1].ledger.ID != a2.ID || got.allocs[1].amount != 60 || got.allocs[1].note != "60-A2" {
		t.Fatalf("second alloc = %+v", got.allocs[1])
	}
}

func TestParseSplitArgsLegacyAllocation(t *testing.T) {
	a1 := models.Ledger{Base: models.Base{ID: uuid.New()}, Name: "A1"}
	got, msg := parseSplitArgs("100 水果 @A1=40", map[string]models.Ledger{"a1": a1})
	if msg != "" {
		t.Fatalf("parseSplitArgs returned error: %s", msg)
	}
	if len(got.allocs) != 1 || got.allocs[0].amount != 40 || !got.allocs[0].hasAmt {
		t.Fatalf("legacy alloc = %+v", got.allocs)
	}
}

func TestParseSplitArgsGludedAmountAndKeyword(t *testing.T) {
	got, msg := parseSplitArgs("1020住宿", map[string]models.Ledger{})
	if msg != "" {
		t.Fatalf("parseSplitArgs returned error: %s", msg)
	}
	if !got.haveTotal || got.total != 1020 {
		t.Fatalf("total = %v/%v", got.total, got.haveTotal)
	}
	if got.freeText != "住宿" {
		t.Fatalf("freeText = %q", got.freeText)
	}
}

func TestSplitFreeTextParseKeepsCategoryKeywordInNote(t *testing.T) {
	pr := ParseMessage("水果 TEST l:报销 100", timeNowForSplitTest(), nil)
	if pr.CategoryHint != "水果 TEST" {
		t.Fatalf("CategoryHint = %q", pr.CategoryHint)
	}
	if pr.Note != "水果 TEST" {
		t.Fatalf("Note = %q, want category keyword preserved in note", pr.Note)
	}
	if len(pr.TagHints) != 1 || pr.TagHints[0] != "报销" {
		t.Fatalf("TagHints = %+v", pr.TagHints)
	}
}

func TestSplitFreeTextParseCompactDate(t *testing.T) {
	pr := ParseMessage("水果 TEST 0507 100", timeNowForSplitTest(), nil)
	if pr.CategoryHint != "水果 TEST" {
		t.Fatalf("CategoryHint = %q", pr.CategoryHint)
	}
	if pr.Note != "水果 TEST" {
		t.Fatalf("Note = %q", pr.Note)
	}
	if !pr.DateResolved {
		t.Fatalf("DateResolved = false")
	}
	want := time.Date(2026, 5, 7, 0, 0, 0, 0, time.Local)
	if !pr.Date.Equal(want) {
		t.Fatalf("Date = %v, want %v", pr.Date, want)
	}
}

func TestAmountFirstSplitTriggerFeedsCompactDate(t *testing.T) {
	args, ok := matchSplitTrigger("100 分账 水果 TEST 0507")
	if !ok {
		t.Fatalf("amount-first trigger did not match")
	}
	parsed, msg := parseSplitArgs(args, map[string]models.Ledger{})
	if msg != "" {
		t.Fatalf("parseSplitArgs returned error: %s", msg)
	}
	if !parsed.haveTotal || parsed.total != 100 {
		t.Fatalf("total = %v/%v", parsed.total, parsed.haveTotal)
	}
	pr := ParseMessage(parsed.freeText+" 100", timeNowForSplitTest(), nil)
	if pr.CategoryHint != "水果 TEST" {
		t.Fatalf("CategoryHint = %q", pr.CategoryHint)
	}
	want := time.Date(2026, 5, 7, 0, 0, 0, 0, time.Local)
	if !pr.DateResolved || !pr.Date.Equal(want) {
		t.Fatalf("Date = %v resolved=%v, want %v", pr.Date, pr.DateResolved, want)
	}
}

func TestEnglishSplitTriggersFeedCompactDate(t *testing.T) {
	cases := []struct {
		input      string
		wantArgs   string
		wantAmount float64
		wantCat    string
		wantDate   time.Time
	}{
		{
			input:      "100 split coffee 0507",
			wantArgs:   "100 coffee 0507",
			wantAmount: 100,
			wantCat:    "coffee",
			wantDate:   time.Date(2026, 5, 7, 0, 0, 0, 0, time.Local),
		},
		{
			input:      "split 200 dinner 20260507",
			wantArgs:   "200 dinner 20260507",
			wantAmount: 200,
			wantCat:    "dinner",
			wantDate:   time.Date(2026, 5, 7, 0, 0, 0, 0, time.Local),
		},
	}

	for _, tc := range cases {
		args, ok := matchSplitTrigger(tc.input)
		if !ok {
			t.Fatalf("%q did not match split trigger", tc.input)
		}
		if args != tc.wantArgs {
			t.Fatalf("%q args = %q, want %q", tc.input, args, tc.wantArgs)
		}
		parsed, msg := parseSplitArgs(args, map[string]models.Ledger{})
		if msg != "" {
			t.Fatalf("parseSplitArgs(%q) error = %s", args, msg)
		}
		if !parsed.haveTotal || parsed.total != tc.wantAmount {
			t.Fatalf("%q total = %v/%v", tc.input, parsed.total, parsed.haveTotal)
		}
		pr := ParseMessage(parsed.freeText+" "+strconv.FormatFloat(parsed.total, 'f', -1, 64), timeNowForSplitTest(), nil)
		if pr.CategoryHint != tc.wantCat {
			t.Fatalf("%q category = %q, want %q", tc.input, pr.CategoryHint, tc.wantCat)
		}
		if !pr.DateResolved || !pr.Date.Equal(tc.wantDate) {
			t.Fatalf("%q date = %v resolved=%v, want %v", tc.input, pr.Date, pr.DateResolved, tc.wantDate)
		}
	}
}

func timeNowForSplitTest() time.Time {
	return time.Date(2026, 5, 8, 12, 0, 0, 0, time.Local)
}
