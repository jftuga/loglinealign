"""Generator for the Munich database log (SQL Server ERRORLOG format).

SQL Server writes local wall-clock time with centisecond precision and no offset.
During each incident it can only report, after the stalled I/O finally completes,
that requests took longer than 15 seconds (message 833); it cannot see why. Routine
log backups and an unrelated failed login supply the background noise.
"""

from datetime import datetime, timedelta
from random import Random

from log_record import LogRecord, format_local
from scenario import WINDOW_END, WINDOW_START, Incident, Site

BACKUP_INTERVAL = timedelta(minutes=5)
DATA_FILE = "/var/opt/mssql/data/orders.mdf"
LOG_FILE = "/var/opt/mssql/data/orders_log.ldf"
LONG_IO_MESSAGE = (
    "SQL Server has encountered {count} occurrence(s) of I/O requests taking longer than 15 seconds to complete "
    "on file [{file}] in database id 5. The OS file handle is 0x{handle:016X}. "
    "The offset of the latest long I/O is: 0x{offset:014x}. The duration of the long I/O is: {duration} ms."
)
BACKUP_MESSAGE = (
    "Log was backed up. Database: orders, creation date(time): 2026/03/02(21:14:07), first LSN: 1843:{first}:1, "
    "last LSN: 1843:{last}:1, number of dump devices: 1, device information: (FILE=1, TYPE=DISK: "
    "{{'/var/opt/mssql/backup/orders/orders_log_{name}.trn'}}). This is an informational message only. No user action is required."
)


class DbLog:
    """Builds the SQL Server ERRORLOG records for the observation window."""

    def __init__(self, site: Site, incidents: tuple[Incident, ...], rng: Random) -> None:
        """Initialize the generator.

        Args:
            site: Database site, providing the local offset.
            incidents: Incidents that stall database I/O.
            rng: Seeded random generator shared by the scenario.
        """
        self._site = site
        self._incidents = incidents
        self._rng = rng

    def records(self) -> list[LogRecord]:
        """Return every ERRORLOG record.

        Returns:
            Backup, long-I/O, and login-failure records.
        """
        records = self._backup_records()
        for incident in self._incidents:
            records.extend(self._long_io_records(incident))
        records.extend(self._login_failure_records())
        return records

    def _line(self, utc: datetime, source: str, message: str) -> LogRecord:
        """Format one ERRORLOG entry.

        Args:
            utc: Entry instant.
            source: Source column, such as "spid23s" or "Backup".
            message: Message text.

        Returns:
            The formatted record.
        """
        stamp = format_local(utc, self._site.offset, " ", 2)
        return LogRecord(utc, f"{stamp} {source:<12}{message}")

    def _backup_records(self) -> list[LogRecord]:
        """Build one record per scheduled transaction-log backup.

        Returns:
            Backup completion records.
        """
        records: list[LogRecord] = []
        lsn = 20912
        scheduled = WINDOW_START + BACKUP_INTERVAL
        while scheduled < WINDOW_END:
            done = scheduled + timedelta(seconds=self._rng.uniform(3.0, 9.0))
            last = lsn + self._rng.randint(400, 900)
            name = (scheduled + self._site.offset).strftime("%Y%m%d_%H%M%S")
            records.append(self._line(done, "Backup", BACKUP_MESSAGE.format(first=lsn, last=last, name=name)))
            lsn = last
            scheduled += BACKUP_INTERVAL
        return records

    def _long_io_records(self, incident: Incident) -> list[LogRecord]:
        """Build the message-833 records written after an incident's I/O stall ends.

        Args:
            incident: Incident whose stalled I/O just completed.

        Returns:
            One record each for the data file and the transaction log file.
        """
        rng = self._rng
        reported = incident.io_resume + timedelta(seconds=rng.uniform(0.6, 2.2))
        stall_ms = round((incident.io_resume - incident.loop_down).total_seconds() * 1000)
        records: list[LogRecord] = []
        for index, (file, handle) in enumerate(((LOG_FILE, 0xAB4), (DATA_FILE, 0x22C))):
            message = LONG_IO_MESSAGE.format(count=rng.randint(4, 38), file=file, handle=handle, offset=rng.randrange(0x1000000, 0x6000000) * 0x1000, duration=stall_ms - rng.randint(0, 25))
            records.append(self._line(reported + timedelta(milliseconds=20 * index), "spid23s", message))
        return records

    def _login_failure_records(self) -> list[LogRecord]:
        """Build an unrelated failed login, the kind of noise a DB team has to discount.

        Returns:
            The error header and detail records.
        """
        when = WINDOW_START + timedelta(minutes=22, seconds=31.48)
        detail = "Login failed for user 'reporting_ro'. Reason: Password did not match that for the login provided. [CLIENT: 10.40.7.21]"
        return [self._line(when, "Logon", "Error: 18456, Severity: 14, State: 8."), self._line(when, "Logon", detail)]
