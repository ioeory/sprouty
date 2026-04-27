package push

import "errors"

var (
	ErrNotifierMissing     = errors.New("telegram bot not configured")
	ErrTelegramNotLinked   = errors.New("telegram account not linked")
	ErrNothingToInclude    = errors.New("enable at least one digest section")
)
