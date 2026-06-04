# Onboarding-Vorlage: neues Dashboard aus dieser Codebasis

Diese Codebasis ist ein **generisches Lead- & Kampagnen-Dashboard**: Es liest
ein Google Tracking Sheet live aus, holt (optional) die Facebook-Ads-Zahlen aus
der Meta Marketing API und schlüsselt Leads nach Kampagne → Anzeigengruppe →
Creative → Placement auf. Eine **zweite Funnel-Stufe** (z. B. Tickets/Termine)
und ein **Fragebogen-basiertes Lead-Qualitäts-Scoring** lassen sich per
Feature-Flag zu- oder abschalten.

Ein neues Projekt aufzusetzen heißt: **eine Config-Datei ausfüllen**, ein paar
**Umgebungsvariablen** setzen und das Sheet freigeben. Kein Code-Umbau nötig.

---

## 1. `config/project.config.json` ausfüllen

Das ist die zentrale Stellschraube. Fehlende Felder fallen auf die Defaults in
[`server/config.js`](server/config.js) zurück (= Verhalten des Referenz-Workshops
mit Tickets + Qualität, deutschem Fragebogen).

```jsonc
{
  "name": "ProScaling GmbH",                 // Anzeigename (Sidebar/Topbar/Chatbot)
  "subtitle": "Lead- & Kampagnen-Dashboard", // Untertitel

  "branding": {
    "primary": "#000000",   // Markenfarbe (dunkler Hintergrund)
    "accent":  "#cba851",   // Akzent: Buttons, KPI-Akzente, Graphen-Hauptlinie
    "logo":    null,        // Pfad zu einem Logo in web/public (z. B. "/logo.svg")
                            // ODER null -> dann wird das Kürzel angezeigt
    "initials": "PS"        // Kürzel als Markenzeichen, wenn kein Logo gesetzt ist
  },

  "features": {
    "hasTickets": false,    // zweite Funnel-Stufe (Ticket/Termin/Call) an/aus
    "hasQuality": false     // Fragebogen-Lead-Qualitäts-Scoring an/aus
  },

  "labels": {
    "ticketSingular": "Ticket",  // Beschriftung der Stufe (nur bei hasTickets)
    "ticketPlural":   "Tickets"
  }
}
```

### Was die Feature-Flags bewirken

| Flag | `false` blendet überall sauber aus … |
| --- | --- |
| `hasTickets` | KPI-Karten „… (Paid/Organisch)" und „Kosten/Ticket", Tabellen-Spalten **Tickets**, **€/Ticket**, **CVR Ticket**, die **VIP-Spalte** der Leadliste, die Ticket-Serie im Verlauf und die Ticket-Tiles in der Kampagnen-Ansicht. |
| `hasQuality` | die ganze **Lead-Qualitäts-Sektion** (Quali-Rate, Ø Quali, Tier-Verteilung, Tagesverlauf), die Spalten **Quali-Rate**/**Ø Quali**, die **Qualitäts-Badges** + Fragebogen-Antworten der Leadliste, die Quali-Felder im CSV-Export und die Fragebogen-Filter (Einkommen/Immobilien/Beschäftigung/Tier). |

> `scoring.json` (Bewertungsmodell) und `campaigns.json` (Lead- vs.
> Traffic-Kampagnen) bleiben wie gehabt und werden **nicht** durch die Flags
> ersetzt – sie greifen nur, wenn `hasQuality` bzw. die Meta-Anbindung aktiv ist.

### Branding ändern

Es genügt, `branding.accent` (und optional `primary`) zu setzen – alle
abgeleiteten Töne kaskadieren über `color-mix` in `web/src/styles.css`. Für ein
eigenes Logo eine Datei in `web/public/` ablegen und `branding.logo` auf den
Pfad setzen (z. B. `/logo.svg`); sonst erscheint `branding.initials`. Das
Favicon ist `web/public/logo.svg` (separat ersetzen, falls gewünscht).

---

## 2. Sheet-Spalten zuordnen (nur bei `hasTickets`/`hasQuality`)

Der Parser erkennt die Tabellen **an ihren Kopfzeilen**, nicht an Tab-Namen. Die
Standard-Zuordnung (`server/config.js` → `questionnaire`) passt zum deutschen
Referenz-Sheet. Hat das neue Projekt **andere Spaltennamen** oder einen anderen
Fragebogen, in `project.config.json` ein `questionnaire`-Objekt ergänzen –
es überschreibt nur die genannten Felder:

```jsonc
"questionnaire": {
  "classify": {
    "overviewHas": ["anzeigengruppe", "adspend"],   // erkennt die Adspend-Übersicht
    "ticketsSome": ["monatliches einkommen"],        // erkennt den Fragebogen-Tab
    "ticketsHas":  ["teilgenommen am", "vorname"],
    "leadsHas":    ["gewonnen am"],                   // erkennt die Lead-Liste
    "leadsSome":   ["utm_source", "e-mail"]
  },
  "lead":   { "wonAt": "gewonnen am", "email": "e-mail", "utmSource": "utm_source", "...": "..." },
  "ticket": { "date": "teilgenommen am", "emailColumns": ["e-mail"], "...": "..." },
  "answers": { "income": "monatliches einkommen", "employment": "...", "...": "..." }
}
```

Schlüssel sind **normalisiert** (klein, ohne `? : .`, Mehrfach-Leerzeichen
zusammengefasst) – genau so, wie der Parser die Kopfzellen vergleicht.

> Bei `hasTickets = false` **und** `hasQuality = false` wird gar kein
> Fragebogen-Tab erkannt – das `questionnaire`-Mapping ist dann irrelevant.

---

## 3. Umgebungsvariablen (`.env` bzw. Hosting-Secrets)

Vorlage: [`.env.example`](.env.example) kopieren (`cp .env.example .env`).
Beim Hosting auf Render werden die mit `sync: false` markierten Werte beim Deploy
abgefragt (siehe [`render.yaml`](render.yaml)).

### Google Sheets (Datenquelle)
| Variable | Pflicht | Zweck |
| --- | --- | --- |
| `SPREADSHEET_ID` | ja* | ID des Tracking-Sheets (in der URL zwischen `/d/` und `/edit`). |
| `GOOGLE_APPLICATION_CREDENTIALS` | ja* | Pfad zur Service-Account-JSON (lokal). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ja* | Kompletter Service-Account-JSON als **eine Zeile** (Hosting). Hat Vorrang vor dem Pfad. |

\* Ohne diese Werte startet das Dashboard im **Demo-Modus** mit synthetischen
Daten. Den Service-Account (`…@…gserviceaccount.com`) im Sheet als **Betrachter**
freigeben.

### Dashboard-Login (Basic Auth, beim Teilen dringend empfohlen)
| Variable | Zweck |
| --- | --- |
| `DASHBOARD_USER` | Benutzername fürs Login. Leer = kein Schutz. |
| `DASHBOARD_PASSWORD` | Passwort fürs Login. |

### KI-Chatbot (optional)
| Variable | Zweck |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic-API-Key für den Analyse-Assistenten. Leer = Chat-Widget ausgeblendet. |

### Facebook-Ads via Meta Marketing API (optional, empfohlen)
| Variable | Zweck |
| --- | --- |
| `META_ACCESS_TOKEN` | Access-Token mit Berechtigung `ads_read`. |
| `META_AD_ACCOUNT_ID` | Werbekonto, z. B. `act_920807585902328`. |
| `META_API_VERSION` | optional, z. B. `v21.0`. |
| `META_LOOKBACK_DAYS` | optional, Zeitfenster (Default 90). |

### Facebook-Ads via Supermetrics (Alternative zu Meta)
| Variable | Zweck |
| --- | --- |
| `SUPERMETRICS_API_KEY` | Supermetrics-API-Key. |
| `SUPERMETRICS_DS_ACCOUNTS` | Ad-Account(s), kommagetrennt. |
| `SUPERMETRICS_DS_USER` | verbundener Supermetrics-User. |
| `SUPERMETRICS_QUERY_JSON` | optional: komplette Abfrage als JSON (hat Vorrang). |

### Server
| Variable | Zweck |
| --- | --- |
| `PORT` | Server-Port (Default 3000). |
| `CACHE_TTL_SECONDS` | Cache-Dauer der Sheet-/Meta-Daten (Default 900). |

---

## 4. Starten & prüfen

```bash
npm install
npm run serve     # Build + Start auf http://localhost:3000
# Entwicklung:
npm run dev       # Vite (5173) + API (3000) mit Hot-Reload
npm test          # Parser-, Combine-, Meta-, Supermetrics- & Feature-Flag-Tests
```

Checkliste fürs neue Projekt:
- [ ] `config/project.config.json`: Name, Branding, Flags gesetzt
- [ ] (falls Flags an) `questionnaire`-Mapping auf die echten Sheet-Spalten geprüft
- [ ] `SPREADSHEET_ID` gesetzt und Service-Account im Sheet freigegeben
- [ ] `DASHBOARD_USER` / `DASHBOARD_PASSWORD` gesetzt (vor dem Teilen!)
- [ ] (optional) `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` für Live-Ads-Zahlen
- [ ] (optional) `ANTHROPIC_API_KEY` für den Chatbot
- [ ] Logo/Kürzel in `web/public/` bzw. `branding` final
- [ ] `npm test` grün, `npm run serve` zeigt echte Daten (kein „DEMO"-Badge)
