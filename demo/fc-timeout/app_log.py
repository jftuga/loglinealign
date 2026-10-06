"""Generator for the Mumbai application log (Spring Boot 2.7 default pattern).

Simulates HTTP traffic through a 10-connection HikariCP pool to the Munich database.
While an incident stalls database I/O, queries hit the 10 s query timeout and waiting
requests hit the 5 s pool timeout, so the application sees only timeouts, never the
underlying fibre channel fault. Pool and SLO monitors add periodic health lines.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from random import Random

from log_record import LogRecord, format_local
from scenario import WINDOW_END, WINDOW_START, Incident, Site

PID = 2231
POOL_SIZE = 10
POOL_TIMEOUT = 5.0
QUERY_TIMEOUT = 10.0
ARRIVALS_PER_SECOND = 1.6
POOL_MONITOR_INTERVAL = 30.0
SLO_INTERVAL = 15.0
SLO_LOOKBACK = 60.0
SLO_BREACH_RATIO = 0.05
SLO_RECOVERED_RATIO = 0.01

REQUEST_LOGGER = "c.e.orders.web.RequestLoggingFilter"
SQL_LOGGER = "o.h.engine.jdbc.spi.SqlExceptionHelper"
SERVLET_LOGGER = "o.a.c.c.C.[.[.[/].[dispatcherServlet]"
POOL_LOGGER = "c.e.orders.metrics.PoolMonitor"
SLO_LOGGER = "c.e.orders.alerting.SloMonitor"
VALIDATION_LOGGER = "c.e.orders.web.OrderController"

POOL_TIMEOUT_TRACE = (
    "java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available, request timed out after 5000ms.",
    "\tat com.zaxxer.hikari.pool.HikariPool.createTimeoutException(HikariPool.java:696)",
    "\tat com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:197)",
    "\tat com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:162)",
    "\tat com.zaxxer.hikari.HikariDataSource.getConnection(HikariDataSource.java:128)",
    "\tat org.hibernate.engine.jdbc.connections.internal.DatasourceConnectionProviderImpl.getConnection(DatasourceConnectionProviderImpl.java:122)",
    "\tat org.hibernate.internal.NonContextualJdbcConnectionAccess.obtainConnection(NonContextualJdbcConnectionAccess.java:38)",
    "\tat org.hibernate.resource.jdbc.internal.LogicalConnectionManagedImpl.acquireConnectionIfNeeded(LogicalConnectionManagedImpl.java:108)",
    "\t... 87 common frames omitted",
)
POOL_TIMEOUT_HEAD = (
    "Servlet.service() for servlet [dispatcherServlet] in context with path [] threw exception "
    "[Request processing failed; nested exception is org.springframework.transaction.CannotCreateTransactionException: "
    "Could not open JPA EntityManager for transaction; nested exception is "
    "org.hibernate.exception.JDBCConnectionException: Unable to acquire JDBC Connection] with root cause"
)


@dataclass(frozen=True)
class Endpoint:
    """One API endpoint with its traffic share and typical database time.

    Attributes:
        method: HTTP method.
        path: Path template; "{id}" and "{page}" are filled per request.
        status: Success status code.
        weight: Relative share of traffic.
        db_seconds: Median database round trip in seconds, including WAN latency.
    """

    method: str
    path: str
    status: int
    weight: float
    db_seconds: float


ENDPOINTS = (
    Endpoint("GET", "/api/v1/orders/{id}", 200, 0.42, 0.14),
    Endpoint("POST", "/api/v1/orders", 201, 0.22, 0.31),
    Endpoint("PUT", "/api/v1/orders/{id}/status", 200, 0.14, 0.24),
    Endpoint("GET", "/api/v1/catalog/items?page={page}", 200, 0.22, 0.19),
)


@dataclass
class Request:
    """One simulated HTTP request.

    Attributes:
        arrival: Arrival time in seconds after the window start.
        start: Time the request obtained a pooled connection.
        end: Completion time.
        outcome: "ok", "invalid" (rejected before the database), "query" (query timeout), or "pool" (pool timeout).
        status: HTTP status sent to the client.
        method: HTTP method.
        path: Concrete request path.
        thread: Tomcat worker thread name.
    """

    arrival: float
    start: float
    end: float
    outcome: str
    status: int
    method: str
    path: str
    thread: str

    @property
    def uses_connection(self) -> bool:
        """Report whether the request held a pooled connection.

        Returns:
            True for requests that reached the database.
        """
        return self.outcome in ("ok", "query")


class AppLog:
    """Builds the application log records for the observation window."""

    def __init__(self, site: Site, incidents: tuple[Incident, ...], rng: Random) -> None:
        """Initialize the generator.

        Args:
            site: Application site, providing the local offset.
            incidents: Incidents whose I/O stalls the database.
            rng: Seeded random generator shared by the scenario.
        """
        self._site = site
        self._rng = rng
        self._stalls = [(self._seconds(i.loop_down), self._seconds(i.io_resume)) for i in incidents]
        self._length = (WINDOW_END - WINDOW_START).total_seconds()

    def records(self) -> list[LogRecord]:
        """Return every application log record.

        Returns:
            Request, error, pool-monitor, and SLO-monitor records.
        """
        requests = self._simulate()
        records: list[LogRecord] = []
        for request in requests:
            records.extend(self._request_records(request))
        records.extend(self._pool_monitor_records(requests))
        records.extend(self._slo_records(requests))
        return records

    @staticmethod
    def _seconds(instant: datetime) -> float:
        """Convert an instant to seconds after the window start.

        Args:
            instant: A timezone-aware datetime.

        Returns:
            Elapsed seconds.
        """
        return (instant - WINDOW_START).total_seconds()

    def _simulate(self) -> list[Request]:
        """Run arrivals through the connection pool, applying I/O stalls.

        Returns:
            All requests in arrival order.
        """
        rng = self._rng
        free_at = [0.0] * POOL_SIZE
        requests: list[Request] = []
        arrival = rng.expovariate(ARRIVALS_PER_SECOND)
        weights = [endpoint.weight for endpoint in ENDPOINTS]
        while arrival < self._length - 15:
            endpoint = rng.choices(ENDPOINTS, weights)[0]
            method, path = endpoint.method, self._path(endpoint)
            thread = f"http-nio-8080-exec-{rng.randint(1, 200)}"
            if endpoint.method == "POST" and rng.random() < 0.02:
                end = arrival + rng.uniform(0.004, 0.02)
                requests.append(Request(arrival, arrival, end, "invalid", 400, method, path, thread))
            else:
                requests.append(self._pooled_request(arrival, endpoint, method, path, thread, free_at))
            arrival += rng.expovariate(ARRIVALS_PER_SECOND)
        return requests

    def _pooled_request(self, arrival: float, endpoint: Endpoint, method: str, path: str, thread: str, free_at: list[float]) -> Request:
        """Simulate one request that needs a database connection.

        Args:
            arrival: Arrival time in seconds.
            endpoint: Endpoint being called.
            method: HTTP method.
            path: Concrete path.
            thread: Worker thread name.
            free_at: Per-connection times when each pooled connection becomes free; updated in place.

        Returns:
            The simulated request.
        """
        rng = self._rng
        slot = min(range(POOL_SIZE), key=free_at.__getitem__)
        if free_at[slot] - arrival > POOL_TIMEOUT:
            end = arrival + POOL_TIMEOUT + rng.uniform(0.001, 0.006)
            return Request(arrival, end, end, "pool", 500, method, path, thread)
        start = max(arrival, free_at[slot]) + rng.uniform(0.0005, 0.003)
        service = endpoint.db_seconds * rng.lognormvariate(0, 0.35)
        finish = start + service
        for stall_start, stall_end in self._stalls:
            if start < stall_end and finish > stall_start:
                finish = stall_end + service * rng.uniform(0.3, 1.0)
        if finish - start > QUERY_TIMEOUT:
            end = start + QUERY_TIMEOUT + rng.uniform(0.002, 0.02)
            outcome, status = "query", 500
        else:
            end = finish + rng.uniform(0.003, 0.012)
            outcome, status = "ok", endpoint.status
            if endpoint.method == "GET" and "{id}" in endpoint.path and rng.random() < 0.03:
                status = 404
        free_at[slot] = end
        return Request(arrival, start, end, outcome, status, method, path, thread)

    def _path(self, endpoint: Endpoint) -> str:
        """Fill an endpoint's path template.

        Args:
            endpoint: Endpoint whose template to fill.

        Returns:
            A concrete request path.
        """
        return endpoint.path.replace("{id}", str(self._rng.randint(4100000, 4199999))).replace("{page}", str(self._rng.randint(1, 40)))

    def _line(self, seconds: float, level: str, thread: str, logger: str, message: str) -> LogRecord:
        """Format one entry in Spring Boot 2.7's default console pattern.

        Args:
            seconds: Entry time in seconds after the window start.
            level: Log level.
            thread: Full thread name; truncated from the left to 15 characters like logback.
            logger: Abbreviated logger name.
            message: Message text, possibly with continuation lines.

        Returns:
            The formatted record.
        """
        utc = WINDOW_START + timedelta(seconds=seconds)
        stamp = format_local(utc, self._site.offset, " ", 3)
        return LogRecord(utc, f"{stamp} {level:>5} {PID} --- [{thread[-15:]:>15}] {logger:<40} : {message}")

    def _request_records(self, request: Request) -> list[LogRecord]:
        """Build the records written when a request completes.

        Args:
            request: Completed request.

        Returns:
            Error records (if any) followed by the access record.
        """
        records: list[LogRecord] = []
        thread, end = request.thread, request.end
        if request.outcome == "invalid":
            records.append(self._line(end - 0.001, "WARN", thread, VALIDATION_LOGGER, "Validation failed for POST /api/v1/orders: quantity must be greater than 0"))
        elif request.outcome == "query":
            records.append(self._line(end - 0.002, "WARN", thread, SQL_LOGGER, "SQL Error: 0, SQLState: null"))
            records.append(self._line(end - 0.002, "ERROR", thread, SQL_LOGGER, "The query has timed out."))
        elif request.outcome == "pool":
            records.append(self._line(end - 0.001, "ERROR", thread, SERVLET_LOGGER, "\n".join((POOL_TIMEOUT_HEAD, *POOL_TIMEOUT_TRACE))))
        level = "WARN" if request.status >= 500 else "INFO"
        elapsed = round((request.end - request.arrival) * 1000)
        records.append(self._line(end, level, thread, REQUEST_LOGGER, f"{request.method} {request.path} -> {request.status} ({elapsed} ms)"))
        return records

    def _pool_monitor_records(self, requests: list[Request]) -> list[LogRecord]:
        """Build periodic connection-pool statistics records.

        Args:
            requests: All simulated requests.

        Returns:
            One record per monitor tick.
        """
        records: list[LogRecord] = []
        tick = POOL_MONITOR_INTERVAL + 0.25
        while tick < self._length:
            active = sum(1 for r in requests if r.uses_connection and r.start <= tick < r.end)
            waiting = sum(1 for r in requests if r.outcome != "invalid" and r.arrival <= tick < r.start)
            level = "WARN" if waiting else "INFO"
            message = f"HikariPool-1 stats: total={POOL_SIZE}, active={active}, idle={POOL_SIZE - active}, waiting={waiting}"
            records.append(self._line(tick, level, "scheduling-1", POOL_LOGGER, message))
            tick += POOL_MONITOR_INTERVAL
        return records

    def _slo_records(self, requests: list[Request]) -> list[LogRecord]:
        """Build SLO breach and recovery records, logged only on state changes.

        Args:
            requests: All simulated requests.

        Returns:
            Breach (paging) and recovery records.
        """
        records: list[LogRecord] = []
        breached = False
        tick = SLO_INTERVAL + 0.5
        while tick < self._length:
            recent = [r for r in requests if tick - SLO_LOOKBACK < r.end <= tick]
            failed = sum(1 for r in recent if r.status >= 500)
            ratio = failed / len(recent) if recent else 0.0
            summary = f"{failed} of {len(recent)} requests failed in the last 60 s ({ratio:.1%})"
            if not breached and ratio > SLO_BREACH_RATIO:
                records.append(self._line(tick, "ERROR", "scheduling-2", SLO_LOGGER, f"SLO breach: {summary}, paging on-call"))
                breached = True
            elif breached and ratio <= SLO_RECOVERED_RATIO:
                records.append(self._line(tick, "INFO", "scheduling-2", SLO_LOGGER, f"SLO recovered: {summary}"))
                breached = False
            tick += SLO_INTERVAL
        return records
