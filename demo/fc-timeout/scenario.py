"""Fixed parameters of the fictional fibre channel outage scenario.

Defines the three sites (application in Mumbai, database and operating system in
Munich), the observation window, and the four intermittent incidents. Every log
generator and the scene-data builder derive their timing from this module, so it
is the single source of truth for what actually happened and when.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

SEED = 20260915
WINDOW_START = datetime(2026, 9, 15, 8, 0, 0, tzinfo=UTC)
WINDOW_END = datetime(2026, 9, 15, 8, 45, 0, tzinfo=UTC)

# Linux SCSI command timeout: in-flight I/O on the dead path waits this long before the
# kernel aborts it and dm-multipath retries it on the surviving path.
SCSI_COMMAND_TIMEOUT = timedelta(seconds=30)
# Retried I/O completes on the surviving path shortly after the failover.
FAILOVER_COMPLETION = timedelta(milliseconds=40)


@dataclass(frozen=True)
class Site:
    """One log source: a system, the team that owns it, and its local time zone.

    Attributes:
        key: Short identifier used in configuration (app, db, os).
        file: Log filename written by the generator.
        city: City where the system runs.
        offset: Fixed UTC offset of the local wall clock used in the log.
        team: Owning team.
        system: Human-readable system description.
    """

    key: str
    file: str
    city: str
    offset: timedelta
    team: str
    system: str


@dataclass(frozen=True)
class Incident:
    """One fibre channel link flap on HBA port host8.

    Attributes:
        number: One-based incident number.
        loop_down: Instant the FC link drops (the root cause).
        link_down_seconds: Seconds until the link comes back up.
    """

    number: int
    loop_down: datetime
    link_down_seconds: float

    @property
    def io_timeout(self) -> datetime:
        """Return the instant the kernel aborts stalled I/O and fails the path.

        Returns:
            The loop-down instant plus the SCSI command timeout.
        """
        return self.loop_down + SCSI_COMMAND_TIMEOUT

    @property
    def io_resume(self) -> datetime:
        """Return the instant stalled I/O completes on the surviving path.

        Returns:
            The I/O timeout instant plus the failover completion delay.
        """
        return self.io_timeout + FAILOVER_COMPLETION

    @property
    def loop_up(self) -> datetime:
        """Return the instant the FC link comes back up.

        Returns:
            The loop-down instant plus the link-down duration.
        """
        return self.loop_down + timedelta(seconds=self.link_down_seconds)


APP = Site("app", "app-mumbai.log", "Mumbai", timedelta(hours=5, minutes=30), "Application team", "orders-api (Spring Boot 2.7)")
DB = Site("db", "db-munich.log", "Munich", timedelta(hours=2), "Database team", "SQL Server 2022 on mucsql01")
OS = Site("os", "os-munich.log", "Munich", timedelta(hours=2), "OS team", "RHEL 9 host mucsql01")
SITES = (APP, DB, OS)

INCIDENTS = (
    Incident(1, datetime(2026, 9, 15, 8, 7, 12, 418306, tzinfo=UTC), 52.6),
    Incident(2, datetime(2026, 9, 15, 8, 19, 41, 733019, tzinfo=UTC), 41.2),
    Incident(3, datetime(2026, 9, 15, 8, 31, 5, 206774, tzinfo=UTC), 67.9),
    Incident(4, datetime(2026, 9, 15, 8, 38, 50, 951432, tzinfo=UTC), 38.4),
)


def offset_text(offset: timedelta) -> str:
    """Format a UTC offset as a signed ±HH:MM string.

    Args:
        offset: Offset to format.

    Returns:
        The offset, for example "+05:30".
    """
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    hours, mins = divmod(abs(minutes), 60)
    return f"{sign}{hours:02d}:{mins:02d}"
