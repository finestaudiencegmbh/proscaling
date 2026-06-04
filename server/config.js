import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'project.config.json');

/**
 * Standard-Konfiguration = das ursprüngliche Verhalten (MoneyMaker-Workshop):
 * deutsche Fragebogen-Spalten, Ticket- UND Qualitäts-System aktiv.
 *
 * WICHTIG: Diese DEFAULTS dienen den Server-Funktionen (parser/build) als
 * Default-Parameter. Die Tests rufen ohne Projekt-Config auf und nutzen damit
 * exakt dieses Mapping – unabhängig davon, was in config/project.config.json
 * für das konkrete Projekt eingestellt ist. So bleiben die Tests stabil grün.
 */
export const DEFAULTS = {
  name: 'Dashboard',
  subtitle: 'Lead- & Kampagnen-Dashboard',
  branding: {
    primary: '#07070c',
    accent: '#d0bb5a',
    logo: '/logo.svg',
    initials: '',
  },
  features: {
    hasTickets: true,
    hasQuality: true,
  },
  labels: {
    ticketSingular: 'Ticket',
    ticketPlural: 'Tickets',
  },
  // Spalten-Zuordnung des Google Sheets. Schlüssel sind bereits normalisiert
  // (klein, ohne ? : .) – siehe key() in parser.js.
  questionnaire: {
    // Erkennung der Tabellen anhand der Kopfzeile.
    classify: {
      overviewHas: ['anzeigengruppe', 'adspend'],
      ticketsSome: ['monatliches einkommen', 'immobilien im besitz'],
      ticketsHas: ['teilgenommen am', 'vorname'],
      leadsHas: ['gewonnen am'],
      leadsSome: ['utm_source', 'e-mail'],
    },
    // Spalten der Lead-Tabelle.
    lead: {
      wonAt: 'gewonnen am',
      firstName: 'vorname',
      lastName: 'nachname',
      email: 'e-mail',
      ticketDate: 'vip-ticket geholt am',
      utmSource: 'utm_source',
      utmMedium: 'utm_medium',
      utmCampaign: 'utm_campaign',
      utmTerm: 'utm_term',
    },
    // Spalten der Ticket-/Teilnahme-Tabelle (Fragebogen).
    ticket: {
      date: 'teilgenommen am',
      firstName: 'vorname',
      lastName: 'nachname',
      emailColumns: ['e-mail (funnelcockpit)', 'e-mail (typeform)', 'e-mail'],
      emailTypeform: 'e-mail (typeform)',
      phone: 'handynummer',
      utmSource: 'utm_source',
      utmMedium: 'utm_medium',
      utmCampaign: 'utm_campaign',
      utmTerm: 'utm_term',
    },
    // Fragebogen-Antworten -> interne Felder (fürs Scoring & die Detailansicht).
    answers: {
      employment: 'angestellt selbstständig oder unternehmer',
      challenge: 'größte herausforderung im vermögensaufbau',
      income: 'monatliches einkommen',
      realEstate: 'immobilien im besitz',
      invested: 'geld investiert in den vermögensaufbau wenn ja wie viel',
      relationship: 'beziehungsstand',
      expectation: 'was erhoffst du dir von den 4 abenden',
    },
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Tiefes Mergen: Datei-Werte überschreiben DEFAULTS; Arrays werden ersetzt. */
function deepMerge(base, over) {
  if (!isObj(over)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('_')) continue; // Kommentar-Felder ignorieren
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * Lädt config/project.config.json und legt es über die DEFAULTS. Fehlt die
 * Datei oder ist sie ungültig, gelten die DEFAULTS.
 */
export function loadProjectConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return deepMerge(DEFAULTS, raw);
  } catch {
    return DEFAULTS;
  }
}

/** Nur die öffentlichen (frontend-relevanten) Teile der Projekt-Config. */
export function publicProject(project = loadProjectConfig()) {
  const { name, subtitle, branding, features, labels } = project;
  return { name, subtitle, branding, features, labels };
}
