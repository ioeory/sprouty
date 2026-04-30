package push

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sprouts-self/backend/internal/service"
)

// DigestMetrics is the service-level headline digest; kept as alias for callers in this package.
type DigestMetrics = service.DigestMetrics

// ComputeDigestMetrics delegates to service.ComputeDigestMetrics (family cluster + tag exclusion + daily allowance).
func ComputeDigestMetrics(db *gorm.DB, userID, ledgerID uuid.UUID, now time.Time, loc *time.Location) (*DigestMetrics, error) {
	return service.ComputeDigestMetrics(db, userID, ledgerID, now, loc)
}
