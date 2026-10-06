"""Generator for the Munich operating system log (rsyslog, local time, no offset).

The OS team's rsyslog template keeps the first 26 characters of the RFC 3339 time
(`%timegenerated:1:26:date-rfc3339%`), which drops the offset. This is the only log
that names the root cause: qla2xxx LOOP DOWN on HBA port host8, SCSI command
timeouts after 30 s, and dm-multipath failing and later reinstating path sdm.
"""

from datetime import datetime, timedelta
from random import Random

from log_record import LogRecord, format_local
from scenario import WINDOW_END, WINDOW_START, Incident, Site

HOST = "mucsql01"
HBA = "qla2xxx [0000:3b:00.1]"
SYSSTAT_INTERVAL = timedelta(minutes=10)
CRON_INTERVAL = timedelta(minutes=5)


class OsLog:
    """Builds the RHEL host log records for the observation window."""

    def __init__(self, site: Site, incidents: tuple[Incident, ...], rng: Random) -> None:
        """Initialize the generator.

        Args:
            site: Operating system site, providing the local offset.
            incidents: Incidents to report from the kernel's point of view.
            rng: Seeded random generator shared by the scenario.
        """
        self._site = site
        self._incidents = incidents
        self._rng = rng

    def records(self) -> list[LogRecord]:
        """Return every OS log record.

        Returns:
            Routine housekeeping records plus the fibre channel incident records.
        """
        records = [self._line(WINDOW_START + timedelta(seconds=3.207114), "chronyd[1033]", "Selected source 10.40.0.11 (ntp1.muc.example.net)")]
        records.extend(self._sysstat_records())
        records.extend(self._cron_records())
        records.extend(self._ssh_session_records(WINDOW_START + timedelta(minutes=13, seconds=8.5), 52114, 3127, timedelta(minutes=9, seconds=41)))
        records.extend(self._ssh_session_records(WINDOW_START + timedelta(minutes=34, seconds=47.1), 52388, 3131, timedelta(minutes=6, seconds=12)))
        for incident in self._incidents:
            records.extend(self._incident_records(incident))
        return records

    def _line(self, utc: datetime, tag: str, message: str) -> LogRecord:
        """Format one rsyslog entry.

        Args:
            utc: Entry instant.
            tag: Syslog tag, such as "kernel" or "multipathd[1187]".
            message: Message text.

        Returns:
            The formatted record.
        """
        stamp = format_local(utc, self._site.offset, "T", 6)
        return LogRecord(utc, f"{stamp} {HOST} {tag}: {message}")

    def _sysstat_records(self) -> list[LogRecord]:
        """Build sysstat timer activations every ten minutes.

        Returns:
            Start, deactivation, and finish records for each activation.
        """
        records: list[LogRecord] = []
        unit = "sysstat-collect.service"
        when = WINDOW_START + timedelta(seconds=0.411)
        while when < WINDOW_END:
            records.append(self._line(when, "systemd[1]", f"Starting {unit} - system activity accounting tool..."))
            records.append(self._line(when + timedelta(seconds=0.031), "systemd[1]", f"{unit}: Deactivated successfully."))
            records.append(self._line(when + timedelta(seconds=0.032), "systemd[1]", f"Finished {unit} - system activity accounting tool."))
            when += SYSSTAT_INTERVAL
        return records

    def _cron_records(self) -> list[LogRecord]:
        """Build the five-minute health-check cron job records.

        Returns:
            One record per cron run.
        """
        records: list[LogRecord] = []
        pid = 51022
        when = WINDOW_START + timedelta(seconds=1.08)
        while when < WINDOW_END:
            records.append(self._line(when, f"CROND[{pid}]", "(root) CMD (/usr/local/sbin/mssql-healthcheck.sh)"))
            pid += self._rng.randint(40, 160)
            when += CRON_INTERVAL
        return records

    def _ssh_session_records(self, login: datetime, port: int, session: int, length: timedelta) -> list[LogRecord]:
        """Build an administrator SSH session.

        Args:
            login: Login instant.
            port: Client source port.
            session: systemd-logind session number.
            length: Session duration.

        Returns:
            Login and logout records.
        """
        pid = 48000 + port % 1000
        key = "ED25519 SHA256:q3VbXk0rTq9mZ1yLw7pD2nHc8sFa5uJe4iGo6tRy0Ks"
        logout = login + length
        return [
            self._line(login, f"sshd[{pid}]", f"Accepted publickey for opsadmin from 10.40.12.7 port {port} ssh2: {key}"),
            self._line(login + timedelta(seconds=0.012), "systemd-logind[1011]", f"New session {session} of user opsadmin."),
            self._line(logout, "systemd-logind[1011]", f"Session {session} logged out. Waiting for processes to exit."),
            self._line(logout + timedelta(seconds=0.004), "systemd-logind[1011]", f"Removed session {session}."),
        ]

    def _incident_records(self, incident: Incident) -> list[LogRecord]:
        """Build the kernel and multipathd records for one link flap.

        Args:
            incident: Incident to report.

        Returns:
            Link-down, command-timeout, path-failure, link-up, and reinstatement records.
        """
        rng = self._rng
        down, timeout, up = incident.loop_down, incident.io_timeout, incident.loop_up
        records = [
            self._line(down, "kernel", f"{HBA}-500b:8: LOOP DOWN detected (2 7 0 0)."),
            self._line(down + timedelta(microseconds=412), "kernel", f"{HBA}-2870:8: Async-logout - hdl=5 loop-id=1 portid=0a1c00 50:06:01:6c:47:e0:1a:2b."),
        ]
        step = timedelta(microseconds=180)
        when = timeout + timedelta(microseconds=rng.randint(900, 4000))
        for _ in range(2):
            tag = rng.randint(100, 1023)
            sector = rng.randrange(0x1000000, 0x4000000) * 8
            lba = " ".join(f"{byte:02x}" for byte in sector.to_bytes(8))
            records.append(self._line(when, "kernel", f"{HBA}-801c:8: Abort command issued nexus=8:1:3 --  1 2003."))
            records.append(self._line(when + step, "kernel", f"sd 8:0:1:3: [sdm] tag#{tag} FAILED Result: hostbyte=DID_TIME_OUT driverbyte=DRIVER_OK cmd_age=30s"))
            records.append(self._line(when + 2 * step, "kernel", f"sd 8:0:1:3: [sdm] tag#{tag} CDB: Write(16) 8a 00 {lba} 00 00 00 40 00 00"))
            records.append(self._line(when + 3 * step, "kernel", f"I/O error, dev sdm, sector {sector} op 0x1:(WRITE) flags 0x8800 phys_seg 8 prio class 0"))
            when += 4 * step
        records.append(self._line(when, "kernel", "device-mapper: multipath: 253:4: Failing path 8:192."))
        records.append(self._line(when + timedelta(milliseconds=21), "multipathd[1187]", "checker failed path 8:192 in map mssql_data"))
        records.append(self._line(when + timedelta(milliseconds=21.3), "multipathd[1187]", "mssql_data: remaining active paths: 1"))
        records.append(self._line(up, "kernel", f"{HBA}-500a:8: LOOP UP detected (16 Gbps)."))
        reinstated = up + timedelta(seconds=rng.uniform(1.8, 3.4))
        records.append(self._line(reinstated, "multipathd[1187]", "8:192: reinstated"))
        records.append(self._line(reinstated + timedelta(microseconds=350), "multipathd[1187]", "mssql_data: remaining active paths: 2"))
        return records
