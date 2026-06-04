import Anthropic from '@anthropic-ai/sdk';

/**
 * KI-Chatbot für das Dashboard. Beantwortet inhaltsbezogene Fragen anhand der
 * Kennzahlen UND der einzelnen Lead-Datensätze (inkl. Name, E-Mail, Telefon,
 * Fragebogen-Antworten). Rein internes Projekt-Tool.
 */

const MAX_LEAD_ROWS = 400; // so viele Einzel-Leads max. in den Kontext (Token-Budget)

export function isChatConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = 'claude-opus-4-8';

/** Verdichtet das Dashboard-Payload zu einem kompakten, anonymen Kontext. */
export function buildContext(payload, filtered, project = null) {
  const features = project?.features || payload.project?.features || { hasQuality: true };
  const stageDefs = project?.stages || payload.project?.stages || [];
  const hasQuality = features.hasQuality;
  const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const leads = filtered || payload.leads || [];

  const paid = leads.filter((l) => l.sourceType === 'paid');
  const organic = leads.filter((l) => l.sourceType !== 'paid');
  const tickets = leads.filter((l) => l.hasTicket);
  const scored = tickets.filter((l) => l.quality);
  const qualified = tickets.filter((l) => ['A', 'B'].includes(l.quality?.tier));

  // Verteilungen
  const tierDist = {};
  for (const l of scored) tierDist[l.quality.tier] = (tierDist[l.quality.tier] || 0) + 1;

  // Je Dimension verdichten (nur Kennzahlen, keine PII)
  const byDim = (key) => {
    const STAGE_DIM = { campaign: 'campaign', adset: 'adset', creative: 'creative' }[key];
    const m = new Map();
    const ensure = (k) => { if (!m.has(k)) m.set(k, { name: k, leads: 0, stufen: {} }); return m.get(k); };
    for (const l of leads) ensure(l[key] || '(unbekannt)').leads += 1;
    for (const s of stageDefs) {
      for (const l of leads) {
        const hit = l.stages?.[s.key];
        if (!hit) continue;
        const e = ensure((STAGE_DIM ? hit[STAGE_DIM] : l[key]) || '(unbekannt)');
        e.stufen[s.key] = (e.stufen[s.key] || 0) + 1;
      }
    }
    return [...m.values()].sort((a, b) => b.leads - a.leads).slice(0, 25);
  };

  // Funnel-Stufen-Summen
  const stageSummary = {};
  let prev = leads.length;
  for (const s of stageDefs) {
    const n = leads.filter((l) => l.stages?.[s.key]).length;
    stageSummary[s.plural] = {
      anzahl: n,
      cvr_von_vorstufe: prev ? round(n / prev) : null,
      kosten_pro_stufe: payload.fb?.totals?.leadSpend && n ? round(payload.fb.totals.leadSpend / n) : null,
    };
    prev = n;
  }

  const fb = payload.fb || {};
  const ctx = {
    zeitraum: payload.range || 'Maximum (gesamter Zeitraum)',
    stand: payload.fetchedAt,
    quelle: payload.source,
    summe: {
      leads_gesamt: leads.length,
      leads_bezahlt: paid.length,
      leads_organisch: organic.length,
      ...(stageDefs.length ? { funnel_stufen: stageSummary } : {}),
      ...(hasQuality ? {
        qualifizierte_tickets: qualified.length,
        quali_rate: tickets.length ? round(qualified.length / tickets.length) : null,
      } : {}),
      ad_spend_gesamt: round(fb.totals?.spend ?? null),
      ad_spend_lead_kampagnen: round(fb.totals?.leadSpend ?? null),
      ad_spend_traffic: round(fb.totals?.nonLeadSpend ?? null),
      impressionen: fb.totals?.impressions ?? null,
      cpl: fb.totals?.leadSpend && paid.length ? round(fb.totals.leadSpend / paid.length) : null,
    },
    ...(hasQuality ? { qualitaets_verteilung_tickets: tierDist } : {}),
    je_kampagne: byDim('campaign'),
    je_anzeigengruppe: byDim('adset'),
    je_creative: byDim('creative'),
    je_placement: byDim('placement'),
  };

  // Einzelne Leads inkl. personenbezogener Daten (internes Tool).
  // Auf MAX_LEAD_ROWS begrenzt, damit der Kontext nicht das Token-Budget sprengt.
  ctx.leads = leads.slice(0, MAX_LEAD_ROWS).map((l) => ({
    name: l.name,
    email: l.email,
    telefon: l.phone,
    lead_am: l.wonAt,
    quelle: l.sourceType,
    kampagne: l.campaign,
    anzeigengruppe: l.adset,
    creative: l.creative,
    placement: l.placement,
    ...(stageDefs.length ? { stufen: Object.fromEntries(stageDefs.filter((s) => l.stages?.[s.key]).map((s) => [s.key, l.stages[s.key].at || true])) } : {}),
    ...(hasQuality ? {
      quali_score: l.quality?.score ?? null,
      quali_tier: l.quality?.tier ?? null,
      antworten: l.answers || null,
    } : {}),
  }));
  if (leads.length > MAX_LEAD_ROWS) {
    ctx.leads_hinweis = `Nur die ersten ${MAX_LEAD_ROWS} von ${leads.length} Leads sind einzeln enthalten; die Summen oben decken alle ab.`;
  }

  // FB-Hierarchie (Kampagnen-Kennzahlen)
  if (Array.isArray(fb.hierarchy)) {
    ctx.facebook_kampagnen = fb.hierarchy.slice(0, 25).map((c) => ({
      name: c.name, aktiv: c.active, traffic: c.leadCampaign === false,
      spend: round(c.spend), leads: c.leads, tickets: c.tickets,
      cpl: round(c.cpl), cpt: round(c.cpt), quali_rate: round(c.qualifiedRate),
      cpm: round(c.cpm), ausg_ctr: round(c.outboundCtr), ausg_cpc: round(c.cpoc),
    }));
  }
  return ctx;
}

function buildSystemPrompt(project) {
  const name = project?.name || 'das Projekt';
  const f = project?.features || { hasQuality: true };
  const stageDefs = project?.stages || [];
  const lines = [
    `Du bist der Analyse-Assistent im Lead-Dashboard für "${name}".`,
    `Du beantwortest Fragen zu Werbe-Performance${f.hasQuality ? ' und Lead-Qualität' : ''} auf Basis der dir gelieferten, bereits aggregierten Kennzahlen.`,
    '',
    'Regeln:',
    ...(stageDefs.length ? [`- Der Funnel hat nach dem Lead diese Stufen: ${stageDefs.map((s) => s.plural).join(' -> ')}. 'funnel_stufen' enthält Anzahl, CVR von der Vorstufe und Kosten/Stufe.`] : []),
    '- Antworte kurz, präzise und auf Deutsch. Nutze konkrete Zahlen aus dem Kontext.',
    '- Rechne bei Bedarf abgeleitete Werte (z. B. Verhältnisse) sauber aus den vorhandenen Zahlen.',
    '- Beträge in Euro mit € und Tausenderpunkt; Raten in Prozent.',
    '- Wenn eine Zahl nicht im Kontext steht, sag das klar – erfinde nichts.',
    '- Der Kontext bezieht sich auf den aktuell im Dashboard gewählten Zeitraum/Filter.',
  ];
  if (f.hasQuality) {
    lines.push('- Lead-Qualität: Tier A/B = qualifiziert; basiert v. a. auf Einkommen (Haushaltsregel: <3.500 € + Partner = schwach).');
    lines.push('- Dir liegen auch die einzelnen Leads inkl. Name, E-Mail, Telefon und Fragebogen-Antworten vor (internes Tool). Du darfst daraus konkrete Personen nennen, Listen erstellen (z. B. "alle qualifizierten Leads aus Kampagne X") und Kontaktdaten ausgeben, wenn danach gefragt wird.');
  } else {
    lines.push('- Dir liegen auch die einzelnen Leads inkl. Name, E-Mail, Telefon vor (internes Tool). Du darfst daraus konkrete Personen nennen, Listen erstellen und Kontaktdaten ausgeben, wenn danach gefragt wird.');
  }
  lines.push("- Das Feld 'leads' enthält ggf. nur die ersten N Datensätze (siehe leads_hinweis); für Gesamtzahlen nutze die Summen/Verdichtungen.");
  lines.push('- Formatiere Vergleiche/Ranglisten/Lead-Listen als kurze Aufzählung oder Tabelle, wenn es hilft.');
  return lines.join('\n');
}

/**
 * Beantwortet eine Chat-Nachricht. messages = [{role, content}], history-fähig.
 * Der aggregierte Kontext wird als cache-fähiger Block vorangestellt.
 */
export async function chat({ messages, context, project = null }) {
  if (!isChatConfigured()) {
    throw new Error('Chatbot nicht konfiguriert (ANTHROPIC_API_KEY fehlt).');
  }
  const client = new Anthropic();

  const system = [
    { type: 'text', text: buildSystemPrompt(project) },
    {
      type: 'text',
      // Kontext als eigener Block, gecacht – stabil über die Konversation
      text: `Aktuelle Dashboard-Kennzahlen (aggregiert, anonym) als JSON:\n${JSON.stringify(context)}`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system,
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  });

  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || 'Dazu habe ich keine Antwort.';
}
