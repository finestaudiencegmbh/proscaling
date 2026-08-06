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
    .replace(/ /g, ' ')
    .trim();

const key = (s) =>
  norm(s)
    .toLowerCase()
    .replace(/[?:.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Bestimmt den Tabellentyp aus dem TAB-NAMEN (sofern in der Config `tab` gesetzt).
 * Das ist die zuverlässigste Erkennung – nötig, wenn sich Tabs (Leadliste/EG)
 * an den Spalten kaum unterscheiden. Reihenfolge: Übersicht -> Stufen -> Leads.
 */
function tabTypeFromTitle(title, project) {
  const t = key(title);
  if (!t) return null;
  const m = (pat) => pat && t.includes(key(pat));
  if (m(project.sheet.overview?.tab)) return 'overview';
  for (const stage of project.stages || []) if (m(stage.sheet?.tab)) return `stage:${stage.key}`;
  if (m(project.sheet.lead?.tab)) return 'leads';
  return null;
}

/** Schlüsselspalten, an denen die Kopfzeile eines (namensbasiert) erzwungenen
 *  Typs erkannt wird (zur Trennung Header vs. Datenzeile). */
function headerKeysFor(type, project) {
  // Suffixe (#2) für die Header-Erkennung entfernen – die Kopfzeile enthält den
  // Basisnamen (z. B. "datum"), das Suffix entsteht erst in rowToObj.
  const strip = (c) => String(c).replace(/#\d+$/, '');
  const ov = project.sheet.overview, ld = project.sheet.lead;
  if (type === 'overview') return [ov.dimension, ov.adspend].filter(Boolean).map(strip);
  if (type === 'leads') return [ld.wonAt, ld.email].filter(Boolean).map(strip);
  if (type && type.startsWith('stage:')) {
    const s = (project.stages || []).find((x) => `stage:${x.key}` === type);
    return s ? [s.sheet.date, ...(s.sheet.emailColumns || [])].filter(Boolean).map(strip) : [];
  }
  return [];
}

/**
 * Erkennt anhand einer Kopfzeile, um welchen Tabellentyp es sich handelt.
 * Ist der Tab bereits über seinen Namen einem Typ zugeordnet (forcedType), gilt
 * dieser – die Kopfzeile wird nur noch von Datenzeilen unterschieden. Sonst:
 * Übersicht -> Stufen -> Leads (Stufen vor Leads, da Spalten ähnlich sind).
 */
function classifyHeader(cells, project, forcedType = null) {
  const set = new Set(cells.map(key));
  const has = (keys) => (keys || []).length > 0 && (keys || []).every((k) => set.has(k));
  const some = (keys) => (keys || []).some((k) => set.has(k));

  if (forcedType) return some(headerKeysFor(forcedType, project)) ? forcedType : null;

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
  const seen = {};
  headerCells.forEach((h, i) => {
    const base = key(h);
    if (!base) return;
    seen[base] = (seen[base] || 0) + 1;
    // Erste gleichnamige Spalte behält den Namen; weitere bekommen ein Suffix
    // ("datum" -> "datum#2"), damit z. B. die zweite Datum-Spalte im ZG-Tab
    // (= ZG-Termin) gezielt angesprochen werden kann.
    const k = seen[base] === 1 ? base : `${base}#${seen[base]}`;
    obj[k] = norm(row[i]);
  });
  return obj;
}

function isEmptyRow(row) {
  return !row || row.every((c) => norm(c) === '');
}

function parseDate(s) {
  const v = norm(s);
  if (!v) return null;
  // Die Zeit im Sheet ist bereits deutsche Wanduhr-Zeit und wird 1:1 übernommen
  // (KEINE Zeitzonen-Umrechnung): die Ziffern werden direkt als UTC-Wanduhr
  // abgelegt. Unterstützte Formate: "YYYY-MM-DD[ HH:MM[:SS]]" (Suffix wie
  // " +0000" wird ignoriert) UND "DD.MM.YYYY[ HH:MM[:SS]]". Verhindert auch,
  // dass Zähl-/Summenzeilen wie "161" als Datum interpretiert werden.
  let Y, Mo, D, H = '00', Mi = '00', S = '00';
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) { [, Y, Mo, D, H = '00', Mi = '00', S = '00'] = m; }
  else {
    m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    [, D, Mo, Y, H = '00', Mi = '00', S = '00'] = m;
  }
  const d = new Date(Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S));
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
function* iterateTables(rows, project, forcedType = null) {
  let header = null;
  let type = null;
  let body = [];
  const flush = () => {
    if (header && body.length) return { header, type, body };
    return null;
  };
  for (const row of rows) {
    const t = classifyHeader(row.map(norm).filter(Boolean).length >= 2 ? row : [], project, forcedType);
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
        // Eine Leerzeile beendet die Tabelle nur, wenn sie bereits Daten hatte.
        // Eine Leerzeile DIREKT unter der Kopfzeile (z. B. Zeile 2 im ZG-Tab)
        // wird übersprungen – sonst würde der Header verworfen und alle
        // Datenzeilen fielen weg.
        if (body.length) {
          const prev = flush();
          if (prev) yield prev;
          header = null;
          type = null;
          body = [];
        }
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

/** Spätestes gültiges Datum in einer Zeile (robust gegen Spalten-Versatz). Nur
 *  echte Datumszellen zählen – parseDate verlangt ein Datum am Zeilenanfang,
 *  UTM-/Namensfelder liefern daher null. */
function latestDateInRow(o) {
  let best = null;
  for (const v of Object.values(o)) {
    const iso = parseDate(v);
    if (iso && (!best || iso > best)) best = iso;
  }
  return best;
}

function parseStageRow(o, stage) {
  const S = stage.sheet;
  // dateMode:'latest' -> das späteste Datum der Zeile (z. B. ZG-Termin, der nach
  // dem Lead-Datum liegt); sonst gezielt die konfigurierte Spalte.
  const at = S.dateMode === 'latest' ? latestDateInRow(o) : parseDate(o[S.date]);
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
    const forcedType = tabTypeFromTitle(sheet.title, project);
    for (const table of iterateTables(rows, project, forcedType)) {
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
