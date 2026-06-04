# Onboarding-Vorlage: neues Dashboard aus dieser Codebasis

Diese Codebasis ist ein **generisches Lead- & Kampagnen-Dashboard**: Es liest
ein Google Tracking Sheet live aus, holt (optional) die Facebook-Ads-Zahlen aus
der Meta Marketing API und schlüsselt Leads nach Kampagne → Anzeigengruppe →
Creative → Placement auf. **Beliebig viele Funnel-Stufen nach dem Lead**
(z. B. Ticket; oder Erstgespräch → Zweitgespräch) und ein **Fragebogen-basiertes
Lead-Qualitäts-Scoring** lassen sich per Konfiguration zu- oder abschalten.

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
    "hasQuality": false     // Fragebogen-Lead-Qualitäts-Scoring an/aus
  },

  "stages": [               // Funnel-Stufen NACH dem Lead (siehe Abschnitt 2). Leer = nur Leads.
    { "key": "eg", "singular": "Erstgespräch", "plural": "Erstgespräche", "short": "EG", "color": "#6fcf97", "sheet": { /* … */ } }
  ]
}
```

### Funnel-Stufen (`stages`) und `hasQuality`

- **`stages`** ist eine geordnete Liste von Stufen nach dem Lead. Jede Stufe wird
  als eigener Sheet-Tab erkannt, per E-Mail an den Lead gejoint und trägt eine
  eigene UTM-Attribution. Das Dashboard zeigt je Stufe automatisch **Anzahl**,
  **Kosten/Stufe** (auf Lead-Spend) und **CVR von der Vorstufe** – in KPIs,
  Breakdown-Tabellen, der Leadliste (eine Spalte je Stufe) und der
  Kampagnen-Aufschlüsselung. Eine **leere** Liste = reines Leads-/Spend-Dashboard.
- **`hasQuality: false`** blendet die komplette **Lead-Qualitäts-Sektion** aus
  (Quali-Rate, Ø Quali, Tier-Verteilung, Qualitäts-Badges, Fragebogen-Antworten,
  CSV-Quali-Felder und die Fragebogen-Filter). Quality gehört zur Stufe mit
  `"quality": true` (im Default die „Ticket"-Stufe).

> `scoring.json` (Bewertungsmodell) und `campaigns.json` (Lead- vs.
> Traffic-Kampagnen, **organicPatterns/paidPatterns** für die Paid-Erkennung)
> bleiben bestehen und werden nicht durch die Config ersetzt.

### Branding ändern

Es genügt, `branding.accent` (und optional `primary`) zu setzen – alle
abgeleiteten Töne kaskadieren über `color-mix` in `web/src/styles.css`. Für ein
eigenes Logo eine Datei in `web/public/` ablegen und `branding.logo` auf den
Pfad setzen (z. B. `/logo.svg`); sonst erscheint `branding.initials`. Das
Favicon ist `web/public/logo.svg` (separat ersetzen, falls gewünscht).

---

## 2. Sheet-Spalten zuordnen

Der Parser erkennt die Tabellen **an ihren Kopfzeilen**, nicht an Tab-Namen. Die
Standard-Zuordnung (`server/config.js` → `sheet` / `stages`) passt zum deutschen
Referenz-Sheet. Hat das neue Projekt andere Spaltennamen, in `project.config.json`
die passenden Felder überschreiben.

**Lead-Tabelle** (`sheet.lead`):
```jsonc
"sheet": {
  "lead": {
    "classifyHas":  ["datum"],                 // Pflichtspalten zur Erkennung
    "classifySome": ["e-mail", "utm source"],  // mindestens eine davon
    "wonAt": "datum",
    "name":  "name",        // EIN Namensfeld …
    // ODER: "firstName": "vorname", "lastName": "nachname"
    "email": "e-mail",
    "phone": "telefon",
    "utmSource": "utm source", "utmMedium": "utm medium",
    "utmCampaign": "utm campaign", "utmTerm": "utm term"
  }
}
```

**Funnel-Stufen** (`stages[]`): jede Stufe ist ein eigener Tab, erkannt an einer
eindeutigen Spalte (`classifyHas`), per E-Mail an den Lead gejoint:
```jsonc
"stages": [
  {
    "key": "eg", "singular": "Erstgespräch", "plural": "Erstgespräche",
    "short": "EG", "color": "#6fcf97",
    "sheet": {
      "classifyHas": ["e-mail", "klient"],     // eindeutige Spalte des EG-Tabs
      "date": "datum", "name": "name", "emailColumns": ["e-mail"], "phone": "telefon",
      "utmSource": "utm source", "utmMedium": "utm medium",
      "utmCampaign": "utm campaign", "utmTerm": "utm term"
    }
  }
]
```
Optionen je Stufe:
- `"standalone": true` — die Stufe wird **komplett eigenständig** aus ihrem Tab
  gezählt (eigenes Datum, eigene UTM, **kein** Abgleich mit der Leadliste). Ideal
  für einen Sales-Funnel, in dem jede Stufe (Erst-/Zweitgespräch) ihre eigene
  Tabelle mit eigenen Daten ist. Anzahl, „worüber" (Kampagne/Anzeigengruppe/
  Creative) und Zeitraum kommen rein aus dem Stufen-Tab.
- `"quality": true` — Stufe trägt das Fragebogen-Scoring (dazu `"answers": { … }`).
- `"emailColumns"` (mehrere Mail-Spalten), `"leadMarker"` (Spalte in der Lead-Zeile,
  die die Stufe markiert) — nur für **gejointe** Stufen (ohne `standalone`).

> **Gejoint vs. standalone:** Ohne `standalone` wird die Stufe per E-Mail an den
> Lead gehängt (z. B. Ticket mit Qualität, erscheint als Spalte je Lead). Mit
> `standalone` ist die Stufe eine unabhängige Quelle und erscheint nicht pro Lead.

> Schlüssel sind **normalisiert** (klein, ohne `? : .`, Mehrfach-Leerzeichen
> zusammengefasst) – genau so, wie der Parser die Kopfzellen vergleicht. Beispiel:
> `UTM Source` → `utm source`, `Angestellt, Selbstständig?` → `angestellt, selbstständig`.

**Paid/Organisch:** ob ein Lead bezahlt ist, steuert `config/campaigns.json`
(`organicPatterns`, `paidPatterns` – z. B. `"//"` im Targeting-Namen). Der
Ad-Spend kommt live aus der Meta-API.

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
- [ ] `config/project.config.json`: Name, Branding, `stages`, `hasQuality` gesetzt
- [ ] `sheet.lead`- und `stages[].sheet`-Mapping auf die echten Sheet-Kopfzeilen geprüft
- [ ] `config/campaigns.json`: `organicPatterns`/`paidPatterns` passend gesetzt
- [ ] `SPREADSHEET_ID` gesetzt und Service-Account im Sheet freigegeben
- [ ] `DASHBOARD_USER` / `DASHBOARD_PASSWORD` gesetzt (vor dem Teilen!)
- [ ] (optional) `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` für Live-Ads-Zahlen
- [ ] (optional) `ANTHROPIC_API_KEY` für den Chatbot
- [ ] Logo/Kürzel in `web/public/` bzw. `branding` final
- [ ] `npm test` grün, `npm run serve` zeigt echte Daten (kein „DEMO"-Badge)
