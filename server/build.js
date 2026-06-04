import { computeQuality } from './scoring.js';
import { loadCampaignConfig } from './campaigns.js';
import { DEFAULTS } from './config.js';

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Rein numerischer Wert (z. B. Meta-IDs wie 52540202640549) -> nicht zuordenbar. */
const isNumericId = (s) => /^\d{6,}$/.test(collapse(s));

const titleCase = (s) => collapse(s).replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Aussagekräftiges Label für eine ORGANISCHE Quelle:
 * - ManyChat (steht im utm_medium) -> "ManyChat · <Kampagnenname>"
 * - Bio (utm_source enthält "bio")  -> "<Plattform> Bio"  (fb-bio -> Facebook Bio)
 * - sonst -> die Quelle selbst (Title Case)
 * Liefert { campaign, adset } für die zweistufige Gruppierung.
 */
function organicLabels(utm) {
  const src = collapse(utm.source).toLowerCase();
  const med = collapse(utm.medium).toLowerCase();
  const camp = collapse(utm.campaign);

  if (/manychat/.test(med) || /manychat/.test(src) || /manychat/.test(camp.toLowerCase())) {
    const flow = camp || titleCase(collapse(utm.medium).replace(/manychat/i, '').replace(/[-_|]/g, ' ').trim()) || '(ohne Flow)';
    return { campaign: 'ManyChat', adset: flow };
  }
  if (/bio/.test(src)) {
    const platMap = { fb: 'Facebook', facebook: 'Facebook', ig: 'Instagram', insta: 'Instagram', instagram: 'Instagram', yt: 'YouTube', youtube: 'YouTube', tiktok: 'TikTok', tt: 'TikTok' };
    const token = src.replace(/[-_\s]*bio.*/, '').replace(/[-_\s]+/g, '');
    const plat = platMap[token] || titleCase(token) || 'Bio';
    return { campaign: 'Bio', adset: `${plat} Bio` };
  }
  const label = titleCase(src) || '(direkt)';
  return { campaign: label, adset: label };
}

/** Lesbares Label für ein Placement (utm_term). */
function placementLabel(term) {
  const t = collapse(term);
  if (!t) return '(kein Placement)';
  if (/^\d{6,}$/.test(t)) return `Placement-ID ${t}`;
  return t.replace(/_/g, ' ');
}

/** Quellen, die immer als organisch gelten – unabhängig vom UTM-Schema. */
function isOrganicSource(utm, patterns) {
  const hay = [utm.source, utm.medium, utm.campaign, utm.term]
    .map((v) => collapse(v).toLowerCase())
    .join(' | ');
  return patterns.some((p) => hay.includes(String(p).toLowerCase()));
}

/**
 * Entscheidet, ob ein Datensatz aus bezahlter Werbung stammt.
 * Bezahlte Anzeigengruppen folgen dem Schema "X | Y | Z | ..." und/oder
 * tauchen in der Adspend-Übersicht auf. Alles andere gilt als organisch.
 */
function isPaid(utm, paidAdsets, patterns, paidPatterns = []) {
  // Harte Regel: organische Muster (ManyChat / Bio / Newsletter …) immer organisch.
  if (isOrganicSource(utm, patterns)) return false;
  const src = collapse(utm.source);
  if (!src) return false;
  if (paidAdsets.has(src.toLowerCase())) return true;
  const hay = `${src} ${collapse(utm.campaign)} ${collapse(utm.medium)}`.toLowerCase();
  // Projektspezifische Paid-Marker (z. B. "//" im Targeting-Namen). Konfigurierbar
  // über campaigns.json -> paidPatterns.
  if (paidPatterns.some((p) => hay.includes(String(p).toLowerCase()))) return true;
  // Bezahlte Anzeigen folgen oft dem Schema "X | Y | Z | ..." – das kann in der
  // Anzeigengruppe (utm_source), der Kampagne (utm_campaign) ODER dem Creative
  // (utm_medium) stehen. Manche Konten nutzen Pipes nur im Kampagnennamen.
  if (hay.includes('|')) return true;
  // Rein numerische Source = Meta-ID -> bezahlt (aber nicht eindeutig zuordenbar).
  if (isNumericId(src)) return true;
  return false;
}

/**
 * Führt Leads, VIP-Tickets und Adspend-Übersicht zu einem einheitlichen
 * Datensatz zusammen. Join über die E-Mail-Adresse.
 */
export function buildDataset({ leads, stages = {}, tickets, overview = [] }, cfg, project = DEFAULTS) {
  const stageDefs = project.stages || [];
  const hasQuality = project.features?.hasQuality;
  const qualityStageKey = stageDefs.find((s) => s.quality)?.key || null;
  const warnings = [];
  const paidAdsets = new Set(overview.filter((o) => (o.matches || 'adset') === 'adset').map((o) => o.adset.toLowerCase()));
  const paidCreatives = new Set(overview.filter((o) => o.matches === 'creative').map((o) => o.adset.toLowerCase()));
  const campCfg = loadCampaignConfig();
  const organicPatterns = campCfg.organicPatterns || ['manychat', 'bio'];
  const paidPatterns = campCfg.paidPatterns || [];
  const organicLabel = campCfg.organicLabel || '(organisch)';
  const unattribLabel = campCfg.unattributablePaidLabel || '(Paid · nicht zuordenbar)';

  // Leitet die Dimensions-Labels (Kampagne/Anzeigengruppe/Creative) aus einer
  // UTM-Kombination ab – einheitlich für Lead-UTM UND Stufen-UTM verwendbar.
  const dimsFor = (utm) => {
    let paid = isPaid(utm, paidAdsets, organicPatterns, paidPatterns);
    // Zusätzliches Paid-Signal: Creative steht in der Adspend-Übersicht (matches:creative)
    if (!paid && paidCreatives.size && paidCreatives.has(collapse(utm.medium).toLowerCase())) paid = true;
    const rawCampaign = collapse(utm.campaign);
    const rawAdset = collapse(utm.source);
    const rawCreative = collapse(utm.medium);
    if (!paid) return { paid: false, campaign: organicLabel, adset: organicLabel, creative: rawCreative || organicLabel };
    if (isNumericId(rawCampaign) || isNumericId(rawAdset) || !rawCampaign || !rawAdset) {
      return { paid: true, campaign: unattribLabel, adset: unattribLabel, creative: rawCreative || unattribLabel };
    }
    return { paid: true, campaign: rawCampaign, adset: rawAdset, creative: rawCreative || unattribLabel };
  };

  // Jede Stufe nach E-Mail (und Sekundär-E-Mail) indizieren – zum Anreichern der
  // Lead-Zeilen, ohne die Lead-Anzahl zu verändern.
  const stageIndex = {};
  const claimed = {};
  for (const s of stageDefs) {
    const m = new Map();
    for (const row of (stages[s.key] || [])) {
      for (const e of [row.email, row.emailSecondary]) if (e && !m.has(e)) m.set(e, row);
    }
    stageIndex[s.key] = m;
    claimed[s.key] = new Set();
  }

  // 1) Jede Lead-Zeile = ein Datensatz (KEIN Dedup, auch ohne E-Mail). Eine Stufe
  //    wird je Person nur EINMAL gewertet (erste passende Lead-Zeile beansprucht
  //    sie). Stufen-Treffer kommen aus dem Stufen-Tab (E-Mail-Join) ODER aus einer
  //    Marker-Spalte in der Lead-Zeile selbst (z. B. "VIP-Ticket geholt am").
  const recs = [];
  const seenLeadEmails = new Set();
  let anon = 0;
  for (const l of leads) {
    const email = l.email || '';
    if (email) seenLeadEmails.add(email);
    const stageHits = {};
    const stageAnswers = {};
    let firstName = l.firstName || '';
    let lastName = l.lastName || '';
    let phone = l.phone || '';
    for (const s of stageDefs) {
      const row = email ? stageIndex[s.key].get(email) : null;
      const markerAt = l.markers?.[s.key] || null;
      if (!row && !markerAt) continue;
      const identity = row?.email || email;
      let counts = false;
      if (!identity) counts = true; // keine E-Mail -> nicht dedupierbar, einzeln werten
      else if (!claimed[s.key].has(identity)) { claimed[s.key].add(identity); counts = true; }
      if (!counts) continue;
      const utm = (row?.utm && collapse(row.utm.source)) ? row.utm : l.utm;
      stageHits[s.key] = { at: markerAt || row?.at || null, utm: { ...utm } };
      if (s.answers && row?.answers) stageAnswers[s.key] = row.answers;
      if (!firstName && row?.firstName) firstName = row.firstName;
      if (!lastName && row?.lastName) lastName = row.lastName;
      if (!phone && row?.phone) phone = row.phone;
    }
    recs.push({ email, firstName, lastName, phone, wonAt: l.wonAt, leadUtm: { ...l.utm }, stageHits, stageAnswers });
  }

  // 2) Stufen-Zeilen, deren E-Mail in KEINER Lead-Zeile vorkommt, als eigene
  //    Datensätze ergänzen. Mehrere Stufen derselben Person -> EIN Datensatz.
  const extras = new Map();
  for (const s of stageDefs) {
    for (const row of (stages[s.key] || [])) {
      if ((row.email && seenLeadEmails.has(row.email)) || (row.emailSecondary && seenLeadEmails.has(row.emailSecondary))) continue;
      const identity = row.email || row.emailSecondary || '';
      if (identity && claimed[s.key].has(identity)) continue;
      if (identity) claimed[s.key].add(identity);
      const idKey = identity || `__anon_${anon++}`;
      if (!extras.has(idKey)) extras.set(idKey, { email: identity, firstName: row.firstName || '', lastName: row.lastName || '', phone: row.phone || '', wonAt: row.at || null, leadUtm: null, stageHits: {}, stageAnswers: {} });
      const e = extras.get(idKey);
      e.stageHits[s.key] = { at: row.at || null, utm: { ...row.utm } };
      if (s.answers && row.answers) e.stageAnswers[s.key] = row.answers;
      if (!e.leadUtm) e.leadUtm = { ...row.utm };
      if (row.at && (!e.wonAt || row.at < e.wonAt)) e.wonAt = row.at;
      if (!e.phone && row.phone) e.phone = row.phone;
    }
  }
  for (const e of extras.values()) recs.push(e);

  // 3) Finalisieren: Dimensionen, Quelle, Stufen-Attribution, Qualität
  const records = [];
  for (const r of recs) {
    const baseUtm = r.leadUtm || Object.values(r.stageHits)[0]?.utm || { source: '', medium: '', campaign: '', term: '' };
    const ld = dimsFor(baseUtm);
    const paid = ld.paid;

    // Stufen-Dimensionen aus der STUFEN-EIGENEN UTM (damit eine Stufe dort zählt,
    // wo sie wirklich entstand – nicht in jeder Kampagne, in der die Person Lead war).
    const stagesOut = {};
    for (const [k, hit] of Object.entries(r.stageHits)) {
      const d = dimsFor(hit.utm);
      stagesOut[k] = { at: hit.at, campaign: d.campaign, adset: d.adset, creative: d.creative };
    }

    // Rückwärtskompatible Ticket-Felder = die Stufe mit key 'ticket' (sofern vorhanden).
    const tk = stagesOut['ticket'] || null;
    const quality = (hasQuality && qualityStageKey && stagesOut[qualityStageKey]) ? computeQuality(r.stageAnswers[qualityStageKey] || null, cfg) : null;
    const answers = (qualityStageKey ? r.stageAnswers[qualityStageKey] : null) || null;

    records.push({
      ticketCampaign: tk?.campaign ?? null,
      ticketAdset: tk?.adset ?? null,
      ticketCreative: tk?.creative ?? null,
      email: r.email,
      name: collapse(`${r.firstName} ${r.lastName}`) || '(ohne Name)',
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      wonAt: r.wonAt,
      ticketAt: tk?.at ?? null,
      hasTicket: Boolean(tk),
      // Generische Funnel-Stufen: { eg: {at,campaign,adset,creative}, zg: {...} }
      stages: stagesOut,
      sourceType: paid ? 'paid' : 'organic',
      campaign: ld.campaign,
      adset: ld.adset,
      creative: ld.creative,
      placement: placementLabel(baseUtm.term),
      placementRaw: collapse(baseUtm.term),
      // Rohe UTM-Werte für den Quellen-Tab (Donut/Top-Listen)
      sourceRaw: collapse(baseUtm.source),
      campaignRaw: collapse(baseUtm.campaign),
      mediumRaw: collapse(baseUtm.medium),
      // Aussagekräftige Gruppierung für den Organisch-Container
      ...(paid ? {} : (() => { const o = organicLabels(baseUtm); return { organicCampaign: o.campaign, organicAdset: o.adset }; })()),
      quality,
      answers,
    });
  }

  // Spend-Übersicht: nach Dimension verdichten (mehrere Kampagnen-Tabs)
  const overviewByAdset = new Map();
  for (const o of overview) {
    const k = o.adset.toLowerCase();
    if (!overviewByAdset.has(k)) overviewByAdset.set(k, o);
  }

  return {
    leads: records,
    overview,
    overviewByAdset: Object.fromEntries(overviewByAdset),
    warnings,
    counts: {
      leads: records.length,
      paidLeads: records.filter((r) => r.sourceType === 'paid').length,
      tickets: records.filter((r) => r.hasTicket).length,
      scored: records.filter((r) => r.quality).length,
      stages: Object.fromEntries(stageDefs.map((s) => [s.key, records.filter((r) => r.stages[s.key]).length])),
    },
  };
}
