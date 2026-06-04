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
    { key: 'eg', singular: 'Erstgespräch', plural: 'Erstgespräche', short: 'EG', requireLead: true, sheet: { classifyHas: ['e-mail', 'klient'], date: 'datum', name: 'name', emailColumns: ['e-mail'], utmSource: 'utm source', utmMedium: 'utm medium', utmCampaign: 'utm campaign', utmTerm: 'utm term' } },
    { key: 'zg', singular: 'Zweitgespräch', plural: 'Zweitgespräche', short: 'ZG', requireLead: true, sheet: { classifyHas: ['e-mail', 'closer'], date: 'datum', name: 'name', emailColumns: ['e-mail'], utmSource: 'utm source 1', utmMedium: 'utm medium 1', utmCampaign: 'utm campaign 1', utmTerm: 'utm term 1' } },
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
    // EG-Zeile OHNE passenden Lead -> darf KEINEN Phantom-Lead erzeugen (requireLead)
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
assert.equal(ts.counts.leads, 3, 'Zwei Stufen: 3 Datensätze (requireLead -> kein Phantom-Lead aus der EG-Zeile ohne Lead)');
assert.equal(ts.counts.stages.eg, 1, 'eg-Stufe nur für gematchten Lead gezählt');
assert.equal(ts.counts.stages.zg, 1, 'zg-Stufe gezählt');
assert.equal(ts.leads.find((l) => l.email === 'ghost@nowhere.de'), undefined, 'EG ohne Lead erzeugt keinen Datensatz');
const nico = ts.leads.find((l) => l.email === 'nico@gmx.de');
assert.ok(nico.stages.eg && nico.stages.zg, 'Nico hat EG und ZG (per E-Mail gejoint)');
assert.equal(nico.sourceType, 'paid', 'Nico ist bezahlt (// im Targeting)');
const news = ts.leads.find((l) => l.email === 'news@x.de');
assert.equal(news.sourceType, 'organic', 'Newsletter-Lead ist organisch');
assert.equal(Boolean(news.stages.eg), false, 'Newsletter-Lead hat kein EG');

console.log('✓ Alle Funnel-Stufen-Tests bestanden');
console.log(`  Default: tickets=${def.counts.tickets} | keine Stufen: leads=${ns.counts.leads} | zwei Stufen: eg=${ts.counts.stages.eg} zg=${ts.counts.stages.zg}`);
