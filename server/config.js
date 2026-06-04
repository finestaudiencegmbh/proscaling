import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'project.config.json');

/**
 * Standard-Konfiguration = das ursprüngliche Verhalten (MoneyMaker-Workshop):
 * EINE Funnel-Stufe ("Ticket") mit Fragebogen-/Qualitäts-Scoring, deutsche
 * Sheet-Spalten.
 *
 * Das generische Funnel-Modell: `stages` ist eine Liste von Stufen NACH dem
 * Lead (z. B. Ticket; oder Erstgespräch -> Zweitgespräch). Jede Stufe ist ein
 * eigener Sheet-Tab, der per E-Mail an den Lead gejoint wird, eine eigene
 * UTM-Attribution tragen kann und optional ein Qualitäts-Scoring (quality:true).
 *
 * WICHTIG: Diese DEFAULTS dienen den Server-Funktionen als Default-Parameter.
 * Die Original-Tests rufen ohne Projekt-Config auf und nutzen exakt dieses
 * Mapping – unabhängig von config/project.config.json. So bleiben sie grün.
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
    hasQuality: true,
  },
  // Funnel-Stufen nach dem Lead. Leere Liste = reines Lead-/Spend-Dashboard.
  stages: [
    {
      key: 'ticket',
      singular: 'Ticket',
      plural: 'Tickets',
      short: 'VIP',
      color: '#6fcf97',
      quality: true, // diese Stufe trägt das Fragebogen-/Qualitäts-Scoring
      sheet: {
        classifySome: ['monatliches einkommen', 'immobilien im besitz'],
        classifyHas: ['teilgenommen am', 'vorname'],
        date: 'teilgenommen am',
        leadMarker: 'vip-ticket geholt am', // Spalte in der LEAD-Tabelle, die diese Stufe markiert
        firstName: 'vorname',
        lastName: 'nachname',
        name: null,
        emailColumns: ['e-mail (funnelcockpit)', 'e-mail (typeform)', 'e-mail'],
        emailSecondary: 'e-mail (typeform)',
        phone: 'handynummer',
        utmSource: 'utm_source',
        utmMedium: 'utm_medium',
        utmCampaign: 'utm_campaign',
        utmTerm: 'utm_term',
      },
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
  ],
  sheet: {
    // Lead-Tabelle. `tab` = (Teil-)Name des Sheet-Tabs; wenn gesetzt, wird der
    // Tab ZUERST am Namen erkannt (robust, falls Spalten mehrdeutig sind).
    lead: {
      tab: null,
      classifyHas: ['gewonnen am'],
      classifySome: ['utm_source', 'e-mail'],
      wonAt: 'gewonnen am',
      firstName: 'vorname',
      lastName: 'nachname',
      name: null, // alternativ EIN Namensfeld; hat Vorrang vor firstName/lastName
      email: 'e-mail',
      phone: null,
      utmSource: 'utm_source',
      utmMedium: 'utm_medium',
      utmCampaign: 'utm_campaign',
      utmTerm: 'utm_term',
    },
    // Adspend-Übersicht.
    overview: {
      tab: null,
      classifyHas: ['anzeigengruppe', 'adspend'],
      dimension: 'anzeigengruppe', // Spalte mit dem Namen
      matches: 'adset', // welcher Lead-Dimension entspricht die Zeile: 'adset' | 'creative'
      status: 'status',
      adspend: 'adspend',
      clicks: ['ausg klicks', 'klicks'],
      cpc: 'cpc',
      leads: 'leads',
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
    const merged = deepMerge(DEFAULTS, raw);
    // stages wird komplett ersetzt (nicht tief gemergt), wenn in der Datei gesetzt
    if (Array.isArray(raw.stages)) merged.stages = raw.stages;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

/** Nur die öffentlichen (frontend-relevanten) Teile der Projekt-Config. */
export function publicProject(project = loadProjectConfig()) {
  const { name, subtitle, branding, features, labels } = project;
  const stages = (project.stages || []).map((s) => ({
    key: s.key, singular: s.singular, plural: s.plural, short: s.short || s.singular, color: s.color || '#6fcf97', quality: Boolean(s.quality), standalone: Boolean(s.standalone),
  }));
  return { name, subtitle, branding, features, labels, stages };
}
