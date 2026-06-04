/**
 * Wandelt die Roh-Zellen aus dem Google Sheet in strukturierte Datensätze um.
 *
 * Das Sheet besteht aus mehreren Tabs/Tabellen. Statt fixe Tab-Namen
 * vorauszusetzen, erkennt der Parser jede Tabelle an ihrer Kopfzeile.
 * Dadurch bleibt er stabil, auch wenn Tabs umbenannt oder verschoben werden.
 *
 * Generisches Funnel-Modell: Neben Leads und der Adspend-Übersicht kennt der
 * Parser beliebig viele "Stufen" (project.stages) – jede Stufe ist ein eigener
 * Tab (z. B. Ticket; oder Erstgespräch -> Zweitgespräch), erkannt an ihren
 * eigenen Erkennungs-Spalten.
 */

import { DEFAULTS } from './config.js';

const norm = (s) =>
  String(s ?? '')
    .replace(/ /g, ' ')
    .trim();

const key = (s) =>
  norm(s)
    .toLowerCase()
    .replace(/[?:.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Erkennt anhand einer Kopfzeile, um welchen Tabellentyp es sich handelt.
 * Reihenfolge: Übersicht -> Stufen (in Config-Reihenfolge) -> Leads. Die Stufen
 * werden VOR den Leads geprüft, weil sich Stufen-Tabs (EG/ZG) oft nur durch
 * eine Zusatzspalte (z. B. "Klient"/"Closer") von der Lead-Tabelle unterscheiden.
 */
function classifyHeader(cells, project) {
  const set = new Set(cells.map(key));
  const has = (keys) => (keys || []).length > 0 && (keys || []).every((k) => set.has(k));
  const some = (keys) => (keys || []).some((k) => set.has(k));
  const ov = project.sheet.overview;
  const ld = project.sheet.lead;

  if (has(ov.classifyHas)) return 'overview';
  for (const stage of project.stages || []) {
    const c = stage.sheet || {};
    if (some(c.classifySome) || has(c.classifyHas)) return `stage:${stage.key}`;
  }
  if (has(ld.classifyHas) && (some(ld.classifySome) || (ld.classifySome || []).length === 0)) return 'leads';
  return null;
}

function rowToObj(headerCells, row) {
  const obj = {};
  headerCells.forEach((h, i) => {
    const k = key(h);
    if (!k) return;
    if (obj[k] === undefined) obj[k] = norm(row[i]); // erste gleichnamige Spalte gewinnt
  });
  return obj;
}

function isEmptyRow(row) {
  return !row || row.every((c) => norm(c) === '');
}

function parseDate(s) {
  const v = norm(s);
  if (!v) return null;
  // Nur echte Datumsangaben akzeptieren (Format im Sheet:
  // "2026-05-26 18:46:08 +0000"). Verhindert, dass Zähl-/Summenzeilen
  // wie "161" fälschlich als Datum (Jahr 161) interpretiert werden.
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v.replace(' +0000', 'Z').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const normEmail = (s) => norm(s).toLowerCase();

/** Vor-/Nachname auflösen – entweder aus einem einzelnen Namensfeld oder zwei. */
function resolveName(o, m) {
  if (m.name) return { firstName: norm(o[m.name]), lastName: '' };
  return { firstName: norm(o[m.firstName]), lastName: norm(o[m.lastName]) };
}

const resolveUtm = (o, m) => ({
  source: norm(o[m.utmSource]),
  medium: norm(o[m.utmMedium]),
  campaign: norm(o[m.utmCampaign]),
  term: norm(o[m.utmTerm]),
});

/**
 * Zerlegt ein Tab (2D-Array) in einzelne Tabellen. Ein Tab kann mehrere
 * untereinander gestapelte Tabellen enthalten (z. B. die Übersicht mit
 * mehreren Kampagnen).
 */
function* iterateTables(rows, project) {
  let header = null;
  let type = null;
  let body = [];
  const flush = () => {
    if (header && body.length) return { header, type, body };
    return null;
  };
  for (const row of rows) {
    const t = classifyHeader(row.map(norm).filter(Boolean).length >= 2 ? row : [], project);
    if (t) {
      const prev = flush();
      if (prev) yield prev;
      header = row;
      type = t;
      body = [];
      continue;
    }
    if (header) {
      if (isEmptyRow(row)) {
        const prev = flush();
        if (prev) yield prev;
        header = null;
        type = null;
        body = [];
      } else {
        body.push(row);
      }
    }
  }
  const last = flush();
  if (last) yield last;
}

const num = (s) => {
  const v = norm(s).replace(/[^\d,.-]/g, '');
  if (!v) return null;
  // deutsches Format: 1.030,11 -> 1030.11
  const n = parseFloat(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function parseOverviewRow(o, ov) {
  // `adset` heißt das Feld aus historischen Gründen; es enthält den Wert der
  // konfigurierten Dimensions-Spalte (ov.dimension), die je nach ov.matches als
  // Anzeigengruppe ODER Creative interpretiert wird.
  const dim = norm(o[ov.dimension]);
  if (!dim) return null;
  const clicksCols = Array.isArray(ov.clicks) ? ov.clicks : [ov.clicks];
  return {
    status: norm(o[ov.status]),
    adset: dim,
    matches: ov.matches || 'adset',
    adspend: num(o[ov.adspend]),
    clicks: num(clicksCols.map((c) => o[c]).find((v) => v != null && v !== '')),
    cpc: num(o[ov.cpc]),
    leads: num(o[ov.leads]),
  };
}

function parseLeadRow(o, project) {
  const L = project.sheet.lead;
  const wonAt = parseDate(o[L.wonAt]);
  if (!wonAt) return null; // Zähl-/Summenzeilen ohne gültiges Datum überspringen
  const { firstName, lastName } = resolveName(o, L);
  // Stufen-Marker direkt aus der Lead-Zeile (z. B. "VIP-Ticket geholt am")
  const markers = {};
  for (const stage of project.stages || []) {
    const col = stage.sheet?.leadMarker;
    if (col) markers[stage.key] = parseDate(o[col]);
  }
  return {
    wonAt,
    firstName,
    lastName,
    email: normEmail(o[L.email]),
    phone: L.phone ? norm(o[L.phone]) : '',
    utm: resolveUtm(o, L),
    markers,
  };
}

function parseStageRow(o, stage) {
  const S = stage.sheet;
  const at = parseDate(o[S.date]);
  const emailCols = S.emailColumns || [S.email].filter(Boolean);
  const email = normEmail(emailCols.map((c) => o[c]).find(Boolean));
  if (!at && !email) return null;
  const { firstName, lastName } = resolveName(o, S);
  const row = {
    at,
    firstName,
    lastName,
    email,
    emailSecondary: S.emailSecondary ? normEmail(o[S.emailSecondary]) : '',
    phone: S.phone ? norm(o[S.phone]) : '',
    utm: resolveUtm(o, S),
  };
  if (stage.answers) {
    const answers = {};
    for (const [field, col] of Object.entries(stage.answers)) answers[field] = norm(o[col]);
    row.answers = answers;
  }
  return row;
}

/**
 * Hauptfunktion: bekommt die Tabs als [{title, values}] und liefert
 * { leads, stages: {key:[...]}, tickets, overview, warnings }.
 * `tickets` ist ein Alias auf die Stufe mit key 'ticket' (Rückwärtskompatibilität).
 */
export function parseSheets(sheets, project = DEFAULTS) {
  const leads = [];
  const overview = [];
  const warnings = [];
  const stages = {};
  const seen = {};
  const stageByType = {};
  for (const stage of project.stages || []) {
    stages[stage.key] = [];
    seen[stage.key] = new Set();
    stageByType[`stage:${stage.key}`] = stage;
  }

  for (const sheet of sheets) {
    const rows = sheet.values || [];
    for (const table of iterateTables(rows, project)) {
      for (const row of table.body) {
        const o = rowToObj(table.header, row);
        if (table.type === 'overview') {
          const r = parseOverviewRow(o, project.sheet.overview);
          if (r) overview.push(r);
        } else if (table.type === 'leads') {
          const r = parseLeadRow(o, project);
          if (r) leads.push(r);
        } else if (stageByType[table.type]) {
          const stage = stageByType[table.type];
          const r = parseStageRow(o, stage);
          if (!r) continue;
          // Dedupe (manche Sheets enthalten denselben Stufen-Tab doppelt/roh)
          const dk = `${r.email}|${r.at || ''}`;
          if (seen[stage.key].has(dk)) continue;
          seen[stage.key].add(dk);
          stages[stage.key].push(r);
        }
      }
    }
  }

  return { leads, stages, tickets: stages.ticket || [], overview, warnings };
}

export const _internal = { classifyHeader, key, num, parseDate, iterateTables };
