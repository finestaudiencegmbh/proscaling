/**
 * Test für die Feature-Flags (hasTickets / hasQuality) und den Config-Loader.
 * Stellt sicher, dass bei deaktivierten Flags KEINE Ticket-/Qualitäts-Daten
 * mehr entstehen, das Lead-Geschäft aber unverändert weiterläuft.
 * Ausführen: node server/config.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';
import { DEFAULTS } from './config.js';

// Sheet wie im Parser-Test (Leads + Übersicht + Ticket-/Fragebogen-Tab)
const overviewSheet = {
  title: 'Anzeigengruppen',
  values: [
    ['Status', 'Anzeigengruppe', 'Adspend', 'Ausg. Klicks', 'CPC', 'CVR Optin', 'CVR Ticket', 'CPL', 'Pro Ticket', 'Quali Rate Ticket', 'Leads', 'VIP Ticket', 'Ticket Nicht Qualifiziert', 'Ticket Qualifiziert'],
    ['AUS', 'J&P | LP 1 | Broad | DACH | W | 30-55', '1.030,66 €', '134', '7,69 €', '9,70%', '46,15%', '79,28 €', '171,78 €', '0,00%', '13', '6', '6', '0'],
  ],
};
const leadsSheet = {
  title: 'Leads',
  values: [
    ['Gewonnen am', 'Vorname', 'Nachname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'VIP-Ticket geholt am'],
    ['2026-05-26 20:42:50 +0000', 'Rebecca', 'Schießl', 'schiessl.rebecca@gmail.com', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV | ABO | 260526', 'Facebook_Mobile_Feed', '2026-05-26 20:47:35 +0000'],
    ['2026-05-26 21:00:00 +0000', 'Max', 'Organik', 'max@example.com', 'instagram', 'bio', 'moneymaker-workshop-2026', 'workshop-anmeldung', ''],
  ],
};
const ticketsSheet = {
  title: 'VIP Ticket',
  values: [
    ['Teilgenommen am', 'Vorname', 'Nachname', 'E-Mail (Funnelcockpit)', 'E-Mail (Typeform)', 'Handynummer', 'Monatliches Einkommen', 'Immobilien im Besitz?', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'],
    ['2026-05-26 20:47:35 +0000', 'Rebecca', 'Schießl', 'schiessl.rebecca@gmail.com', 'schiessl.rebecca@gmail.com', '+491783420945', '3.500-5.000 im Monat', 'Ja, mehrere', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV | ABO | 260526', 'Facebook_Mobile_Feed'],
  ],
};
const sheets = [overviewSheet, leadsSheet, ticketsSheet];
const cfg = loadScoringConfig();

// 1) Defaults: Tickets + Qualität AN (Referenz)
const onParsed = parseSheets(sheets, DEFAULTS);
const on = buildDataset(onParsed, cfg, DEFAULTS);
assert.equal(onParsed.tickets.length, 1, 'Ticket-Tab erkannt, wenn Flags an');
assert.equal(on.counts.tickets, 1, 'Ticket gezählt');
assert.ok(on.leads.find((l) => l.email === 'schiessl.rebecca@gmail.com').quality, 'Qualität berechnet');

// 2) Beide Flags AUS: keine Tickets, keine Qualität – Leads unverändert
const noFeatures = { ...DEFAULTS, features: { hasTickets: false, hasQuality: false } };
const offParsed = parseSheets(sheets, noFeatures);
const off = buildDataset(offParsed, cfg, noFeatures);
assert.equal(offParsed.tickets.length, 0, 'Ticket-/Fragebogen-Tab wird ohne Flags nicht als Tickets erkannt');
assert.equal(off.counts.leads, 2, 'Lead-Anzahl unverändert');
assert.equal(off.counts.tickets, 0, 'keine Tickets, wenn hasTickets=false');
assert.equal(off.counts.scored, 0, 'keine Qualität, wenn hasQuality=false');
assert.equal(off.leads.every((l) => l.hasTicket === false), true, 'kein Lead trägt ein Ticket');
assert.equal(off.leads.every((l) => l.quality === null), true, 'kein Lead trägt eine Qualität');
// Übersicht/Spend bleibt erhalten
assert.ok(off.overviewByAdset['j&p | lp 1 | broad | dach | w | 30-55'].adspend === 1030.66, 'Adspend weiter geparst');

// 3) Nur Qualität aus (Tickets an): Tickets gezählt, aber kein Score
const noQuality = { ...DEFAULTS, features: { hasTickets: true, hasQuality: false } };
const nqParsed = parseSheets(sheets, noQuality);
const nq = buildDataset(nqParsed, cfg, noQuality);
assert.equal(nq.counts.tickets, 1, 'Tickets weiterhin gezählt');
assert.equal(nq.counts.scored, 0, 'aber keine Qualität, wenn hasQuality=false');

console.log('✓ Alle Feature-Flag-Tests bestanden');
console.log(`  an: tickets=${on.counts.tickets} scored=${on.counts.scored} | aus: leads=${off.counts.leads} tickets=${off.counts.tickets}`);
