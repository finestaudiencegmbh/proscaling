/**
 * Test für das generische Funnel-Stufen-Modell + den Config-Loader.
 * Prüft: (1) Default = eine Stufe "Ticket" mit Qualität (wie der alte Workshop),
 * (2) keine Stufen -> reines Lead-Dashboard, (3) zwei Stufen (EG -> ZG) mit
 * E-Mail-Join und stufen-eigener Attribution.
 * Ausführen: node server/config.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';
import { DEFAULTS } from './config.js';

const cfg = loadScoringConfig();

// --- 1) Default: eine Stufe "Ticket" mit Qualität --------------------------
const overviewSheet = {
  title: 'Übersicht',
  values: [
    ['Status', 'Anzeigengruppe', 'Adspend', 'Leads', 'VIP Ticket'],
    ['AUS', 'J&P | LP 1 | Broad | DACH | W | 30-55', '1.030,66 €', '13', '6'],
  ],
};
const leadsSheet = {
  title: 'Leads',
  values: [
    ['Gewonnen am', 'Vorname', 'Nachname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'VIP-Ticket geholt am'],
    ['2026-05-26 20:42:50 +0000', 'Rebecca', 'Schießl', 'rebecca@gmail.com', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV | ABO', 'Facebook_Mobile_Feed', '2026-05-26 20:47:35 +0000'],
    ['2026-05-26 21:00:00 +0000', 'Max', 'Organik', 'max@example.com', 'instagram', 'bio', 'moneymaker-workshop', 'x', ''],
  ],
};
const ticketsSheet = {
  title: 'VIP Ticket',
  values: [
    ['Teilgenommen am', 'Vorname', 'Nachname', 'E-Mail (Funnelcockpit)', 'E-Mail (Typeform)', 'Handynummer', 'Monatliches Einkommen', 'Immobilien im Besitz?', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'],
    ['2026-05-26 20:47:35 +0000', 'Rebecca', 'Schießl', 'rebecca@gmail.com', 'rebecca@gmail.com', '+49170', '3.500-5.000 im Monat', 'Ja, mehrere', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV | ABO', 'Facebook_Mobile_Feed'],
  ],
};
const defParsed = parseSheets([overviewSheet, leadsSheet, ticketsSheet], DEFAULTS);
const def = buildDataset(defParsed, cfg, DEFAULTS);
assert.equal(defParsed.tickets.length, 1, 'Default: Ticket-Tab erkannt');
assert.equal(def.counts.tickets, 1, 'Default: Ticket gezählt');
assert.equal(def.counts.stages.ticket, 1, 'Default: Stufe ticket = 1');
assert.ok(def.leads.find((l) => l.email === 'rebecca@gmail.com').quality, 'Default: Qualität berechnet');

// --- 2) Keine Stufen: reines Lead-Dashboard --------------------------------
const noStages = { ...DEFAULTS, features: { hasQuality: false }, stages: [] };
const nsParsed = parseSheets([overviewSheet, leadsSheet, ticketsSheet], noStages);
const ns = buildDataset(nsParsed, cfg, noStages);
assert.equal(ns.counts.leads, 2, 'Keine Stufen: Lead-Anzahl unverändert');
assert.equal(ns.counts.tickets, 0, 'Keine Stufen: keine Tickets');
assert.equal(ns.leads.every((l) => l.hasTicket === false), true, 'Keine Stufen: kein Lead trägt ein Ticket');
assert.equal(ns.leads.every((l) => l.quality === null), true, 'Keine Stufen: keine Qualität');

// --- 3) Zwei Stufen: Erstgespräch -> Zweitgespräch (E-Mail-Join) ------------
const twoStage = {
  ...DEFAULTS,
  features: { hasQuality: false },
  stages: [
    { key: 'eg', singular: 'Erstgespräch', plural: 'Erstgespräche', short: 'EG', standalone: true, sheet: { classifyHas: ['e-mail', 'klient'], date: 'datum', name: 'name', emailColumns: ['e-mail'], utmSource: 'utm source', utmMedium: 'utm medium', utmCampaign: 'utm campaign', utmTerm: 'utm term' } },
    { key: 'zg', singular: 'Zweitgespräch', plural: 'Zweitgespräche', short: 'ZG', standalone: true, sheet: { classifyHas: ['e-mail', 'closer'], date: 'datum', name: 'name', emailColumns: ['e-mail'], utmSource: 'utm source 1', utmMedium: 'utm medium 1', utmCampaign: 'utm campaign 1', utmTerm: 'utm term 1' } },
  ],
  sheet: { ...DEFAULTS.sheet, lead: { classifyHas: ['datum'], classifySome: ['e-mail', 'utm source'], wonAt: 'datum', name: 'name', email: 'e-mail', utmSource: 'utm source', utmMedium: 'utm medium', utmCampaign: 'utm campaign', utmTerm: 'utm term' } },
};
const psLeads = {
  title: 'Leadliste',
  values: [
    ['Datum', 'Name', 'E-Mail', 'Telefon', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Term', 'A/B'],
    ['2026-05-09 16:33:20 +0000', 'Nico', 'nico@gmx.de', '+49170', 'AG1: SIT // DE AT // 25-55', 'C2: Ratespiel H1', 'ABO Leads', 'Instagram_Reels', 'V1'],
    ['2026-05-09 17:00:00 +0000', 'Lara', 'lara@gmail.com', '+49171', 'AG1: SIT // DE AT // 25-55', 'C2: Ratespiel H1', 'ABO Leads', 'Instagram_Stories', 'V1'],
    ['2026-05-10 09:00:00 +0000', 'News', 'news@x.de', '+49172', 'newsletter', 'finestaudience', 'link-1', '', 'V1'],
  ],
};
const psEg = {
  title: 'EGs',
  values: [
    ['Datum', 'Name', 'E-Mail', 'Telefon', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Term', 'Klient'],
    ['2026-05-11 10:00:00 +0000', 'Nico', 'nico@gmx.de', '+49170', 'AG1: SIT // DE AT // 25-55', 'C2: Ratespiel H1', 'ABO Leads', 'Instagram_Reels', ''],
    // EG-Zeile OHNE passenden Lead -> wird trotzdem eigenständig als EG gezählt (standalone),
    // erzeugt aber KEINEN Lead-Datensatz.
    ['2026-05-11 11:00:00 +0000', 'Geist', 'ghost@nowhere.de', '+49199', 'AG1: SIT // DE AT // 25-55', 'C2: Ratespiel H1', 'ABO Leads', 'Instagram_Reels', ''],
  ],
};
const psZg = {
  title: 'ZGs',
  values: [
    ['Datum', 'Name', 'E-Mail', 'Telefon', 'UTM Source 1', 'UTM Medium 1', 'UTM Campaign 1', 'UTM Term 1', 'Closer'],
    ['2026-05-12 10:00:00 +0000', 'Nico', 'nico@gmx.de', '+49170', 'AG1: SIT // DE AT // 25-55', 'C2: Ratespiel H1', 'ABO Leads', 'Instagram_Reels', 'Tom'],
  ],
};
const tsParsed = parseSheets([psLeads, psEg, psZg], twoStage);
assert.equal(tsParsed.leads.length, 3, 'Zwei Stufen: 3 Leads geparst');
assert.equal(tsParsed.stages.eg.length, 2, 'EG-Tab erkannt (2 Zeilen)');
assert.equal(tsParsed.stages.zg.length, 1, 'ZG-Tab erkannt');

const ts = buildDataset(tsParsed, cfg, twoStage);
assert.equal(ts.counts.leads, 3, 'Zwei Stufen: 3 Leads (standalone -> Stufen erzeugen KEINE Lead-Datensätze)');
assert.equal(ts.counts.stages.eg, 2, 'eg eigenständig aus dem EG-Tab gezählt (beide Zeilen, auch ohne Lead)');
assert.equal(ts.counts.stages.zg, 1, 'zg eigenständig aus dem ZG-Tab gezählt');
assert.equal(ts.stageRecords.eg.length, 2, 'stageRecords.eg = 2 Events');
assert.equal(ts.leads.find((l) => l.email === 'ghost@nowhere.de'), undefined, 'EG-Zeile ohne Lead erzeugt keinen Lead-Datensatz');
const nico = ts.leads.find((l) => l.email === 'nico@gmx.de');
assert.equal(Object.keys(nico.stages).length, 0, 'eigenständige Stufen werden NICHT an den Lead gehängt (kein Join)');
assert.equal(nico.sourceType, 'paid', 'Nico ist bezahlt (// im Targeting)');
// Stufen-Attribution über die stufen-eigene UTM
const egPaid = ts.stageRecords.eg.filter((e) => e.sourceType === 'paid').length;
assert.equal(egPaid, 2, 'beide EG-Events sind bezahlt (// im Targeting)');
const news = ts.leads.find((l) => l.email === 'news@x.de');
assert.equal(news.sourceType, 'organic', 'Newsletter-Lead ist organisch');

// --- 4) Tab-Namen-Erkennung trennt Leadliste & EG, auch bei gleichen Spalten ---
// Die Leadliste hat hier (wie im echten Sheet) eine leere "Klient"-Spalte – an
// den Spalten allein wäre sie nicht vom EG-Tab zu unterscheiden. Der Tab-Name
// entscheidet.
const byTab = {
  ...twoStage,
  sheet: { ...twoStage.sheet, lead: { ...twoStage.sheet.lead, tab: 'leadliste' } },
  stages: twoStage.stages.map((s) => ({ ...s, sheet: { ...s.sheet, tab: s.key === 'eg' ? 'egs' : 'zgs' } })),
};
const leadTab = { title: 'Leadliste_2026', values: [
  ['Datum', 'Name', 'E-Mail', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Term', 'Klient'],
  ['2026-05-09 16:33:20 +0000', 'Nico', 'nico@gmx.de', 'AG1: SIT // DE AT // 25-55', 'C2', 'ABO', 'Instagram_Reels', ''],
  ['2026-05-09 17:00:00 +0000', 'Lara', 'lara@x.de', 'AG1: SIT // DE AT // 25-55', 'C2', 'ABO', 'Instagram_Reels', ''],
] };
const egTab = { title: 'EGs_2026', values: [
  ['Datum', 'Name', 'E-Mail', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Term', 'Klient'],
  ['2026-05-11 10:00:00 +0000', 'Nico', 'nico@gmx.de', 'AG1: SIT // DE AT // 25-55', 'C2', 'ABO', 'Instagram_Reels', ''],
] };
const zgTab = { title: 'ZGs_2026', values: [
  ['Datum', 'Name', 'E-Mail', 'UTM Source 1', 'UTM Medium 1', 'UTM Campaign 1', 'UTM Term 1', 'Closer'],
  ['2026-05-12 10:00:00 +0000', 'Nico', 'nico@gmx.de', 'AG1: SIT // DE AT // 25-55', 'C2', 'ABO', 'Instagram_Reels', 'Tom'],
] };
const tabParsed = parseSheets([leadTab, egTab, zgTab], byTab);
assert.equal(tabParsed.leads.length, 2, 'Leadliste (trotz leerer Klient-Spalte) als Leads erkannt – nicht als EG');
assert.equal(tabParsed.stages.eg.length, 1, 'EGs_2026 am Tab-Namen als EG erkannt');
assert.equal(tabParsed.stages.zg.length, 1, 'ZGs_2026 am Tab-Namen als ZG erkannt');

// --- 5) ZG-Datum = zweite "Datum"-Spalte (Termin), nicht die erste (Herkunft) --
const byTab2 = {
  ...byTab,
  stages: byTab.stages.map((s) => (s.key === 'zg' ? { ...s, sheet: { ...s.sheet, date: 'datum#2' } } : s)),
};
const zgTermin = { title: 'ZGs_2026', values: [
  ['Datum', 'Name', 'E-Mail', 'UTM Source 1', 'UTM Medium 1', 'UTM Campaign 1', 'UTM Term 1', 'Closer', 'Datum'],
  // erste Datum = alte Lead-Herkunft, zweite Datum = Termin (gestern)
  ['2026-03-12 10:00:00', 'Nico', 'nico@gmx.de', 'AG1: SIT // DE AT // 25-55', 'C2', 'ABO', 'Instagram_Reels', 'Tom', '2026-07-05 09:00:00'],
] };
const zgParsed = parseSheets([leadTab, egTab, zgTermin], byTab2);
assert.equal(zgParsed.stages.zg[0].at, '2026-07-05T09:00:00.000Z', 'ZG nutzt die zweite Datum-Spalte (Termin), nicht die erste (Herkunft)');

console.log('✓ Alle Funnel-Stufen-Tests bestanden');
console.log(`  Default: tickets=${def.counts.tickets} | keine Stufen: leads=${ns.counts.leads} | zwei Stufen: eg=${ts.counts.stages.eg} zg=${ts.counts.stages.zg}`);
