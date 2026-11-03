"""Every enum value stored in a VARCHAR column has to fit it.

SQLite ignores VARCHAR lengths, so a value that's too long passes every SQLite test and
only fails on Postgres (and in production). This checks the lengths directly instead.
"""

from enum import StrEnum

import pytest
from sqlalchemy import String

from app.models import (
    AuditEvent,
    DateProposal,
    DateStatus,
    Notification,
    NotificationKind,
    Report,
    ReportReason,
    ReportStatus,
    Swipe,
    SwipeAction,
    VerificationRequest,
    VerificationStatus,
)
from app.services.audit import AuditAction


@pytest.mark.parametrize(
    ("column", "values"),
    [
        (Notification.kind, NotificationKind),
        (Report.reason, ReportReason),
        (Report.status, ReportStatus),
        (DateProposal.status, DateStatus),
        (Swipe.action, SwipeAction),
        (VerificationRequest.status, VerificationStatus),
        (AuditEvent.action, AuditAction),
    ],
)
def test_enum_values_fit_their_columns(column, values: type[StrEnum]) -> None:
    column_type = column.property.columns[0].type
    assert isinstance(column_type, String)
    too_long = [v.value for v in values if len(v.value) > column_type.length]
    assert not too_long, f"{column}: {too_long} longer than {column_type.length}"
