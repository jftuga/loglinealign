/*
  Explainer scene: builds one DOM section per storyboard segment, then positions and
  fades everything as a pure function of time in window.seek(t). Animation timing comes
  from each segment's named beats in storyboard.toml; log text comes verbatim from
  build/scene-data.js. No timers, transitions, wall clocks, or randomness are used.
*/
"use strict";

const D = window.SCENE_DATA;
if (!D) {
  document.body.textContent = "build/scene-data.js is missing: run make scene";
  throw new Error("missing scene data");
}
window.DURATION = D.video.duration;

const FADE = 0.35;
const COLORS = { app: "#f2a93b", db: "#4cb8f0", os: "#b48cff" };
const ERR = "#ff6b6b";
const OK = "#5fd39a";
const SANS = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const MONO = 'Menlo, "DejaVu Sans Mono", Consolas, monospace';
const SOURCES = Object.fromEntries(D.sources.map((s) => [s.key, s]));
const KEYS = ["app", "db", "os"];
const SHORT = { app: "App", db: "Database", os: "OS" };
const FIRST = D.first_incident_utc_seconds;
const STEPS = Object.fromEntries(D.closeup.groups.map((g) => [g.id, D.pattern[0].steps[g.id]]));

/* ---------- helpers ---------- */

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ramp = (t, start, length = 0.6) => clamp01((t - start) / length);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function add(parent, ...children) {
  for (const child of children) parent.appendChild(child);
  return parent;
}

function place(node, left, top) {
  node.classList.add("abs");
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  return node;
}

function reveal(node, progress, dy = 24) {
  const p = easeOut(clamp01(progress));
  node.style.opacity = String(p);
  node.style.transform = `translateY(${(1 - p) * dy}px)`;
}

function beatGetter(seg) {
  return (name) => {
    const value = seg.beats[name];
    if (value === undefined) throw new Error(`segment ${seg.id} is missing beat "${name}"`);
    return value;
  };
}

function clock(daySeconds) {
  const s = Math.floor(((daySeconds % 86400) + 86400) % 86400);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function duration(seconds) {
  const minutes = Math.round(Math.abs(seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

function rel(seconds) {
  return `+${seconds.toFixed(1)} s`;
}

function sourceTag(key, text) {
  const span = h("span");
  add(span, h("span", `dot bg-${key}`), h("span", `mono c-${key}`, text ?? SOURCES[key].file));
  return span;
}

function heading(root, title, subtitle) {
  const wrap = add(h("div", "abs heading"), h("h2", null, title));
  if (subtitle) wrap.appendChild(h("p", null, subtitle));
  root.appendChild(wrap);
  return wrap;
}

/* ---------- segment: title ---------- */

function buildTitle(root, seg) {
  const b = beatGetter(seg);
  const wrap = add(root, h("div", "abs title-wrap")).lastChild;
  const kicker = h("div", "kicker", `Incident review · ${D.escalation.app.date}`);
  const line1 = h("span", null, "Three logs. Three time zones.");
  const line2 = h("span", "accent", "One root cause.");
  const title = add(h("h1"), line1, line2);
  const sub = h("div", "title-sub", "Intermittent fibre channel timeouts, correlated with loglinealign");
  const chips = h("div", "chips");
  const chipNodes = KEYS.map((key) => {
    const s = SOURCES[key];
    const chip = add(h("div", "chip"), sourceTag(key), h("small", null, `${s.team} · ${s.city} · UTC${s.offset}`));
    chips.appendChild(chip);
    return chip;
  });
  add(wrap, kicker, title, sub, chips);
  return (t) => {
    reveal(kicker, ramp(t, b("title")));
    reveal(line1, ramp(t, b("title") + 0.2));
    reveal(line2, ramp(t, b("title") + 0.7));
    reveal(sub, ramp(t, b("subtitle")));
    chipNodes.forEach((chip, i) => reveal(chip, ramp(t, b("files") + i * 0.25)));
  };
}

/* ---------- segment: setup ---------- */

function siteCard(left, city, offset) {
  const card = place(h("div", "site"), left, 150);
  const head = add(h("div", "site-head"), h("div", "site-city", city), h("div", "site-zone", `UTC${offset}`));
  const clockNode = h("div", "site-clock");
  add(card, head, clockNode);
  return { card, clockNode };
}

function node(kind, name, desc, team) {
  return add(h("div", `node ${kind}`), h("div", "node-name", name), h("div", "node-desc", desc), add(h("div", "node-team"), h("span", "badge", team)));
}

function buildSetup(root, seg) {
  const b = beatGetter(seg);
  const app = SOURCES.app;
  const db = SOURCES.db;
  const mumbai = siteCard(80, app.city, app.offset);
  const munich = siteCard(1080, db.city, db.offset);
  const appNode = node("app", "orders-api", "Spring Boot 2.7 · HikariCP pool of 10", app.team);
  const dbNode = node("db", "SQL Server 2022", "orders database · data and log on one SAN LUN", db.team);
  const osNode = node("os", "RHEL 9 · mucsql01", "qla2xxx FC HBA · dm-multipath (host7, host8)", SOURCES.os.team);
  const san = add(h("div", "san"), add(h("div", "san-paths"), h("span", null, "host7"), h("span", null, "host8")), h("div", "san-box", "FC SAN storage"));
  add(mumbai.card, appNode);
  add(munich.card, dbNode, osNode, san);
  const wan = add(h("div", "abs wan"), h("div", null, "JDBC"), h("div", "wan-line"), h("div", null, "over the WAN"));
  const gap = duration(app.offset_seconds - db.offset_seconds);
  const same = h("div", "abs same-instant");
  add(same, h("span", null, "Same instant, two wall clocks: "), h("b", "c-app", gap), h("span", null, " apart"));
  add(root, mumbai.card, munich.card, wan, same);
  return (t) => {
    const utc = FIRST - 20 + t;
    mumbai.clockNode.textContent = clock(utc + app.offset_seconds);
    munich.clockNode.textContent = clock(utc + db.offset_seconds);
    reveal(mumbai.card, ramp(t, b("mumbai")));
    reveal(appNode, ramp(t, b("mumbai") + 0.5));
    reveal(munich.card, ramp(t, b("munich")));
    reveal(dbNode, ramp(t, b("munich") + 0.5));
    reveal(wan, ramp(t, b("munich") + 0.9));
    reveal(osNode, ramp(t, b("os")));
    reveal(san, ramp(t, b("os") + 0.5));
    reveal(same, ramp(t, b("teams")));
  };
}

/* ---------- segment: escalation ---------- */

function paneRows(body, rows) {
  return rows.map((r) => {
    const row = h("div", "row");
    const msg = h("div", `msg sev-${r.severity}`);
    add(msg, h("span", "clock", `${r.clock} `), document.createTextNode(r.message));
    if (r.count > 1) msg.appendChild(h("span", "count", `×${r.count}`));
    row.appendChild(msg);
    body.appendChild(row);
    return row;
  });
}

function buildEscalation(root, seg) {
  const b = beatGetter(seg);
  const ph = D.placeholders;
  const lefts = [60, 675, 1290];
  const titles = [`${SOURCES.app.team} paged at ${ph.app_alert_hhmm}`, `${SOURCES.db.team}`, `${SOURCES.os.team}`];
  const verdicts = [
    "Sees only timeouts. Blames the database.",
    `Nothing at ${ph.app_alert_hhmm}. Slow I/O at ${ph.munich_hhmm}, cause unknown.`,
    `Fibre channel errors at ${ph.munich_hhmm}. Nobody reported ${ph.munich_hhmm}.`,
  ];
  const panes = KEYS.map((key, i) => {
    const s = SOURCES[key];
    const step = place(h("div", "step"), lefts[i], 210);
    const num = h("span", `step-num bg-${key}`, String(i + 1));
    add(step, num, h("span", null, titles[i]));
    const pane = place(h("div", "pane"), lefts[i], 280);
    const head = add(h("div", "pane-head"), sourceTag(key), h("small", null, `local time · UTC${s.offset}`));
    const body = h("div", "pane-body");
    add(pane, head, body);
    const verdict = place(h("div", `verdict c-${key}`, verdicts[i]), lefts[i], 790);
    add(root, step, pane, verdict);
    return { step, pane, body, verdict, key };
  });
  const search = D.escalation.db.search;
  const searchBox = h("div", "search");
  const typed = h("span");
  const result = h("span", "result sev-2", `${search.matches} matches`);
  add(searchBox, h("span", "dim", "$ "), typed, result);
  panes[1].body.appendChild(searchBox);
  const rows = panes.map((p) => paneRows(p.body, D.escalation[p.key].rows));
  const command = `grep "${search.query}" ${SOURCES.db.file}`;
  const starts = [b("app"), b("db"), b("os")];
  return (t) => {
    panes.forEach((p, i) => {
      reveal(p.step, ramp(t, starts[i]));
      reveal(p.pane, ramp(t, starts[i] + 0.15));
      const rowStart = i === 1 ? b("db_found") : starts[i] + 0.8;
      rows[i].forEach((row, j) => reveal(row, ramp(t, rowStart + j * 0.45, 0.4), 10));
      reveal(p.verdict, ramp(t, rowStart + rows[i].length * 0.45 + 0.3));
    });
    const chars = Math.round(command.length * ramp(t, b("db") + 0.6, 1.0));
    typed.textContent = command.slice(0, chars);
    result.style.opacity = String(ramp(t, b("db") + 1.8, 0.3));
  };
}

/* ---------- segment: timeline ---------- */

const CHART = { width: 1800, height: 450, x0: 230, x1: 1770, laneTop: 70, laneHeight: 90, laneGap: 14 };

function laneY(index) {
  return CHART.laneTop + index * (CHART.laneHeight + CHART.laneGap);
}

function tickStep(span) {
  if (span > 3 * 3600) return 1800;
  if (span > 3600) return 900;
  return 300;
}

function drawDashed(ctx, x, y0, y1, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.restore();
}

function buildTimeline(root, seg) {
  const b = beatGetter(seg);
  const merge = D.merge;
  const headA = heading(root, "Merged as written", "No offsets in any file, so the merge reads every timestamp as UTC");
  const headB = heading(root, "Merged with per-file time zones", "Each file's wall clock converted to UTC before sorting");
  const canvas = h("canvas", "abs chart");
  canvas.width = CHART.width;
  canvas.height = CHART.height;
  root.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const legend = place(h("div", "legend"), 280, 628);
  [["error", 30], ["warning", 18], ["info", 9]].forEach(([label, height]) => {
    const item = add(h("span"), h("i"), document.createTextNode(label));
    item.firstChild.style.height = `${height}px`;
    legend.appendChild(item);
  });
  const warning = place(h("div", "box warn below", merge.naive.warning), 280, 690);
  const seam = place(h("div", "box below"), 280, 800);
  merge.naive.seam.forEach((line, i) => {
    if (i === merge.naive.seam_index) {
      const munichEnd = merge.naive.seam[i - 1].split("] ")[1].slice(11, 16);
      const mumbaiStart = line.split("] ")[1].slice(11, 16);
      seam.appendChild(h("div", "seam-cut", `Munich's last entry at ${munichEnd}, then Mumbai's first at ${mumbaiStart}: the merge never interleaves them`));
    }
    const key = KEYS.find((k) => line.includes(SOURCES[k].file + "]"));
    const row = h("div", "seam-line");
    add(row, h("span", `c-${key}`, line.slice(0, line.indexOf("] ") + 1)), document.createTextNode(line.slice(line.indexOf("] ") + 1)));
    seam.appendChild(row);
  });
  const cmd = place(h("div", "box cmd below"), 280, 700);
  const parts = merge.aligned.command.split(" ");
  add(cmd, h("span", "prompt", "$ "));
  parts.forEach((part, i) => {
    const isTz = part.startsWith("--") || part.startsWith("+") || part.startsWith("-0") || (i > 0 && parts[i - 1] === "--file-timezone");
    cmd.appendChild(h("span", isTz ? "tz" : null, part + " "));
  });
  const caption = place(h("div", "caption", `${D.incidents.length} incidents, the same moments in all three logs`), 0, 900);
  add(root, legend, warning, seam, cmd, caption);

  const lanes = KEYS.map((key) => ({ key, ticks: D.lanes[key], offset: SOURCES[key].offset_seconds }));
  const walls = lanes.flatMap((l) => l.ticks.map((tk) => tk[0]));
  const utcs = lanes.flatMap((l) => l.ticks.map((tk) => tk[0] - l.offset));
  const wideMin = Math.min(...utcs) - 900;
  const wideMax = Math.max(...walls) + 900;
  const zoomMin = Math.min(...utcs) - 90;
  const zoomMax = Math.max(...utcs) + 90;
  const gapText = duration(SOURCES.app.offset_seconds - SOURCES.os.offset_seconds);

  return (t) => {
    const k = easeInOut(ramp(t, b("shift"), b("shift_end") - b("shift")));
    const z = easeInOut(ramp(t, b("shift_end"), b("zoom_end") - b("shift_end")));
    const lo = lerp(wideMin, zoomMin, z);
    const hi = lerp(wideMax, zoomMax, z);
    const X = (s) => CHART.x0 + ((s - lo) / (hi - lo)) * (CHART.x1 - CHART.x0);
    const sweep = ramp(t, b("sweep"), b("sweep_end") - b("sweep"));
    const sweepX = lerp(CHART.x0, CHART.x1, easeInOut(sweep));
    const noOffset = ramp(t, b("command"), 0.4) * (1 - ramp(t, b("zones"), 0.4));
    const zones = ramp(t, b("zones"), 0.4);

    ctx.clearRect(0, 0, CHART.width, CHART.height);
    const axisY = laneY(3) + 6;

    // axis ticks and labels
    const step = tickStep(hi - lo);
    ctx.font = `16px ${MONO}`;
    ctx.textAlign = "center";
    for (let s = Math.ceil(lo / step) * step; s <= hi; s += step) {
      const x = X(s);
      if (x < CHART.x0 - 1 || x > CHART.x1 + 1) continue;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x, CHART.laneTop - 10, 1, axisY - CHART.laneTop + 10);
      ctx.fillStyle = "#8b97a6";
      ctx.fillText(clock(s).slice(0, 5), x, axisY + 24);
    }
    ctx.font = `600 17px ${SANS}`;
    ctx.fillStyle = "#8b97a6";
    ctx.globalAlpha = clamp01(1 - 2 * k);
    ctx.fillText("timestamps as written, read as UTC", (CHART.x0 + CHART.x1) / 2, axisY + 54);
    ctx.globalAlpha = clamp01(2 * k - 1);
    ctx.fillText("UTC", (CHART.x0 + CHART.x1) / 2, axisY + 54);
    ctx.globalAlpha = 1;

    // lanes
    lanes.forEach((lane, index) => {
      const y = laneY(index);
      const base = y + CHART.laneHeight - 8;
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(CHART.x0 - 10, y, CHART.x1 - CHART.x0 + 20, CHART.laneHeight);
      ctx.textAlign = "left";
      ctx.font = `600 19px ${MONO}`;
      ctx.fillStyle = COLORS[lane.key];
      ctx.fillText(SOURCES[lane.key].file, 0, y + 34);
      ctx.font = `17px ${SANS}`;
      ctx.fillStyle = "#8b97a6";
      ctx.fillText(SOURCES[lane.key].city, 0, y + 60);
      ctx.font = `700 17px ${MONO}`;
      ctx.globalAlpha = noOffset;
      ctx.fillStyle = ERR;
      ctx.fillText("no offset", 90, y + 60);
      ctx.globalAlpha = zones;
      ctx.fillStyle = OK;
      ctx.fillText(SOURCES[lane.key].offset, 90, y + 60);
      ctx.globalAlpha = 1;
      for (const level of [0, 1, 2]) {
        ctx.fillStyle = COLORS[lane.key];
        ctx.globalAlpha = [0.28, 0.75, 1][level];
        const height = [16, 34, 62][level];
        const width = level === 2 ? 2.5 : 1;
        for (const [wall, sev] of lane.ticks) {
          if (sev !== level) continue;
          const naiveX = X(wall);
          if (sweep < 1 && naiveX > sweepX) continue;
          const x = X(wall - k * lane.offset);
          if (x < CHART.x0 - 10 || x > CHART.x1 + 10) continue;
          ctx.fillRect(x, base - height, width, height);
        }
      }
      ctx.globalAlpha = 1;
    });

    // gap between the first incident's Munich and Mumbai timestamps
    const gapAlpha = ramp(t, b("gap"), 0.5) * (1 - ramp(t, b("shift") - 0.6, 0.5));
    if (gapAlpha > 0) {
      const xa = X(FIRST + SOURCES.os.offset_seconds);
      const xb = X(FIRST + SOURCES.app.offset_seconds);
      drawDashed(ctx, xa, 34, axisY, ERR, gapAlpha);
      drawDashed(ctx, xb, 34, axisY, ERR, gapAlpha);
      ctx.save();
      ctx.globalAlpha = gapAlpha;
      ctx.strokeStyle = ERR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xa, 40);
      ctx.lineTo(xb, 40);
      ctx.stroke();
      ctx.fillStyle = ERR;
      ctx.font = `700 22px ${SANS}`;
      ctx.textAlign = "center";
      ctx.fillText(`incident #1: ${gapText} apart`, (xa + xb) / 2, 30);
      ctx.restore();
    }

    // incident columns once aligned
    const colAlpha = ramp(t, b("columns"), 0.6);
    if (colAlpha > 0) {
      D.incidents.forEach((incident) => {
        const x = X(incident.utc_seconds);
        drawDashed(ctx, x, 30, axisY, "#ffffff", colAlpha * 0.7);
        ctx.save();
        ctx.globalAlpha = colAlpha;
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 18px ${SANS}`;
        ctx.textAlign = "center";
        ctx.fillText(`#${incident.number} ${clock(incident.utc_seconds)}`, x, 22);
        ctx.restore();
      });
    }

    const toB = ramp(t, b("shift"), 0.6);
    headA.style.opacity = String(1 - toB);
    headB.style.opacity = String(toB);
    reveal(warning, ramp(t, b("sweep_end")) * (1 - ramp(t, b("command"), 0.4)));
    reveal(seam, ramp(t, b("snippet")) * (1 - ramp(t, b("command"), 0.4)));
    reveal(cmd, ramp(t, b("zones")) * (1 - ramp(t, b("columns"), 0.4)));
    reveal(caption, ramp(t, b("columns") + 0.5));
  };
}

/* ---------- segment: closeup ---------- */

function buildCloseup(root, seg) {
  const b = beatGetter(seg);
  const app = SOURCES.app;
  const munich = SOURCES.os;
  heading(root, `Incident #${D.closeup.incident}, merged and aligned`, `UTC ${clock(FIRST)}  ·  ${app.city} ${clock(FIRST + app.offset_seconds)}  ·  ${munich.city} ${clock(FIRST + munich.offset_seconds)}  ·  times relative to the link drop`);
  const log = add(root, h("div", "abs log")).lastChild;
  const groups = D.closeup.groups.map((g) => ({ ...g, nodes: [] }));
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
  let current = null;
  for (const row of D.closeup.rows) {
    const group = byId[row.group];
    if (current !== group) {
      const note = h("div", `group-note c-${row.key}`, group.note);
      log.appendChild(note);
      group.nodes.push(note);
      current = group;
    }
    const div = h("div", "log-row");
    const split = row.line.indexOf("] ") + 1;
    const text = add(h("span", "text"), h("span", `c-${row.key}`, row.line.slice(0, split)), document.createTextNode(row.line.slice(split)));
    add(div, h("span", "rel", rel(row.rel)), text);
    if (row.count > 1) div.appendChild(h("span", "count", `×${row.count}`));
    log.appendChild(div);
    group.nodes.push(div);
  }
  return (t) => {
    const latest = groups.filter((g) => t >= b(g.id)).at(-1);
    groups.forEach((g) => {
      const focus = g === latest ? 1 : 0.55;
      g.nodes.forEach((n, i) => {
        const p = easeOut(ramp(t, b(g.id) + i * 0.3, 0.45));
        n.style.opacity = String(p * focus);
        n.style.transform = `translateX(${(1 - p) * -30}px)`;
      });
    });
  };
}

/* ---------- segment: pattern ---------- */

function buildPattern(root, seg) {
  const b = beatGetter(seg);
  heading(root, "Every incident, same sequence", "Seconds from the fibre channel link drop to each team's first log entry");
  const table = place(h("table", "steps"), 90, 230);
  const headRow = h("tr");
  ["#", "UTC", ...D.closeup.groups.map((g) => g.label), "HBA port"].forEach((label) => headRow.appendChild(h("th", null, label)));
  add(table, add(h("thead"), headRow));
  const body = h("tbody");
  const keyOf = { fc_down: "os", app_errors: "app", os_timeout: "os", db_report: "db", recovery: "os" };
  const rows = D.pattern.map((r) => {
    const tr = h("tr");
    add(tr, h("td", null, `#${r.number}`), h("td", null, clock(r.utc_seconds)));
    D.closeup.groups.forEach((g) => {
      const value = r.steps[g.id];
      tr.appendChild(h("td", `c-${keyOf[g.id] ?? "os"}`, value === null ? "missing" : rel(value)));
    });
    tr.appendChild(h("td", "port", r.port));
    body.appendChild(tr);
    return tr;
  });
  table.appendChild(body);
  const box = h("div", "port-box");
  const caption = place(h("div", "caption", "Same order every time. Same HBA port every time."), 0, 820);
  add(root, table, box, caption);
  return (t) => {
    rows.forEach((tr, i) => reveal(tr, ramp(t, b("rows") + i * 0.5, 0.5), 12));
    const last = b("rows") + rows.length * 0.5 + 0.4;
    const opacity = ramp(t, last, 0.4);
    box.style.opacity = String(opacity);
    if (opacity > 0) {
      // Measure only once every row has settled, so row slide-in transforms do not skew the box.
      const origin = stage.getBoundingClientRect();
      const first = rows[0].lastChild.getBoundingClientRect();
      const final = rows.at(-1).lastChild.getBoundingClientRect();
      Object.assign(box.style, { left: `${first.left - origin.left - 8}px`, top: `${first.top - origin.top - 4}px`, width: `${first.width + 16}px`, height: `${final.bottom - first.top + 8}px` });
    }
    reveal(caption, ramp(t, last + 0.3));
  };
}

/* ---------- segment: close ---------- */

function chip(key, title, detail) {
  return add(h("div", `abs cchip ${key}`), h("b", `c-${key}`, title), h("small", null, detail));
}

function buildClose(root, seg) {
  const b = beatGetter(seg);
  const ph = D.placeholders;
  const slots = [520, 920, 1320];
  const rowY = [190, 420];
  const arrowsFor = (y) => [0, 1].map((i) => place(h("div", "carrow", "→"), slots[i] + 330, y + 22));
  const reportedLabel = place(h("div", "lane-label", "Reported"), 150, rowY[0] + 30);
  const causedLabel = place(h("div", "lane-label", "Caused"), 150, rowY[1] + 30);
  const reportedDetail = { app: `paged at ${ph.app_alert_hhmm} ${SOURCES.app.city}`, db: `slow I/O at ${ph.munich_hhmm} ${SOURCES.db.city}`, os: `FC errors at ${ph.munich_hhmm} ${SOURCES.os.city}` };
  const causedDetail = { os: `FC link drops · ${rel(STEPS.fc_down)}`, db: `I/O stalls · reports at ${rel(STEPS.db_report)}`, app: `requests fail · ${rel(STEPS.app_errors)}` };
  const reported = ["app", "db", "os"].map((key, i) => ({ node: chip(key, SHORT[key], reportedDetail[key]), slot: i, key }));
  const caused = ["os", "db", "app"].map((key, i) => ({ node: chip(key, SHORT[key], causedDetail[key]), slot: i, from: ["app", "db", "os"].indexOf(key) }));
  const arrowsTop = arrowsFor(rowY[0]);
  const arrowsBottom = arrowsFor(rowY[1]);
  const take = add(h("div", "abs takeaway"), h("h2", null, "Align the clocks first. Then correlate."), h("p", null, `Root cause: a flapping fibre channel link on HBA port ${D.pattern[0].port}`));
  const footer = h("div", "abs footer", "loglinealign  ·  github.com/jftuga/loglinealign");
  add(root, reportedLabel, causedLabel, ...reported.map((r) => r.node), ...caused.map((c) => c.node), ...arrowsTop, ...arrowsBottom, take, footer);
  return (t) => {
    reveal(reportedLabel, ramp(t, b("reported")));
    reported.forEach((r) => {
      place(r.node, slots[r.slot], rowY[0]);
      reveal(r.node, ramp(t, b("reported") + r.slot * 0.5));
    });
    arrowsTop.forEach((a, i) => reveal(a, ramp(t, b("reported") + i * 0.5 + 0.4)));
    reveal(causedLabel, ramp(t, b("caused")));
    caused.forEach((c) => {
      const p = easeInOut(ramp(t, b("caused") + c.slot * 0.25, 1.2));
      c.node.style.left = `${lerp(slots[c.from], slots[c.slot], p)}px`;
      c.node.style.top = `${lerp(rowY[0], rowY[1], p)}px`;
      c.node.style.opacity = String(ramp(t, b("caused") + c.slot * 0.25, 0.3));
    });
    arrowsBottom.forEach((a, i) => reveal(a, ramp(t, b("caused") + 1.5 + i * 0.2)));
    reveal(take, ramp(t, b("takeaway"), 0.8));
    reveal(footer, ramp(t, b("takeaway") + 1.0, 0.8));
  };
}

/* ---------- playback ---------- */

const BUILDERS = { title: buildTitle, setup: buildSetup, escalation: buildEscalation, timeline: buildTimeline, closeup: buildCloseup, pattern: buildPattern, close: buildClose };
const stage = document.getElementById("stage");
const scenes = D.segments.map((seg) => {
  const builder = BUILDERS[seg.id];
  if (!builder) throw new Error(`no renderer for segment "${seg.id}"`);
  const root = add(stage, h("section", "seg")).lastChild;
  return { seg, root, update: builder(root, seg) };
});
const params = new URLSearchParams(location.search);
const captions = params.get("captions") === "1" ? add(stage, h("div", "captions")).lastChild : null;

window.seek = async (t) => {
  scenes.forEach((scene, index) => {
    const local = t - scene.seg.start;
    const last = index === scenes.length - 1;
    const visible = local >= 0 && (local < scene.seg.duration || (last && local <= scene.seg.duration));
    scene.root.style.visibility = visible ? "visible" : "hidden";
    if (!visible) return;
    const fadeIn = index === 0 ? 1 : ramp(local, 0, FADE);
    scene.root.style.opacity = String(Math.min(fadeIn, 1 - ramp(local, scene.seg.duration - FADE, FADE)));
    scene.update(local);
  });
  if (captions) {
    const cue = D.cues.find((c) => t >= c.start && t < c.end);
    captions.textContent = cue ? cue.text : "";
    captions.style.visibility = cue ? "visible" : "hidden";
  }
};

window.seek(Number(params.get("t") ?? 0));
