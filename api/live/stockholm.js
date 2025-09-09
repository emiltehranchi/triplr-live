// Live Crowd for Stockholm using SL Transport departures
// Vercel serverless (Node 22). No external deps.

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Tune these to taste
  const LOOKAHEAD_MINUTES = 30; // how far ahead we count
  const MIN_WEIGHT = 0.12;      // floor so faint hubs are still visible
  const BUSY_DIVISOR = 6;       // lower = hotter map

  // Central hubs to monitor (match by substring, case-insensitive)
  const HUB_NAMES = [
    "T-Centralen","Slussen","Odenplan","Gullmarsplan","Fridhemsplan",
    "Skanstull","Gamla stan","Tekniska högskolan","Stadion",
    "Hornstull","Rådmansgatan","St Eriksplan","Medborgarplatsen",
    "Mariatorget","Skanstull","Sundbyberg","Sickla","Nacka Strand"
  ];

  try {
    const now = new Date();

    // 1) Get all SL sites once
    const sites = await fetch("https://transport.integration.sl.se/v1/sites?expand=true")
      .then(r => r.json());

    // Pick hubs by name
    const hubs = (sites || []).filter(s =>
      s?.name && HUB_NAMES.some(n => s.name.toLowerCase().includes(n.toLowerCase()))
    );

    // Helper: parse "display" like "nu", "5 min", "14:07", or ISO
    const asMinutes = (s) => {
      if (!s) return 999;
      if (/^\s*nu\s*$/i.test(s)) return 0;
      const m = s.match(/(\d+)\s*min/i);
      if (m) return parseInt(m[1], 10);
      const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
      if (hhmm) {
        const [, hh, mm] = hhmm;
        const dt = new Date(now); dt.setHours(+hh, +mm, 0, 0);
        let diff = (dt - now) / 60000; if (diff < -5) diff += 1440; // wrap midnight
        return diff;
      }
      const t = Date.parse(s);
      return Number.isFinite(t) ? (t - now) / 60000 : 999;
    };

    const features = [];

    // 2) For each hub: fetch live departures, compute weight
    for (const s of hubs) {
      const id = s.id;
      if (!id) continue;

      const dep = await fetch(
        `https://transport.integration.sl.se/v1/sites/${id}/departures`,
        { cache: "no-store" }
      ).then(r => r.json());

      // Flatten modes that may exist
      let items = [];
      for (const k of ["metro","bus","tram","train","ferry","ship"]) {
        if (Array.isArray(dep?.[k])) items = items.concat(dep[k]);
      }

      // Minutes to departure for all items, keep next LOOKAHEAD_MINUTES
      const mins = items.map(d => asMinutes(d?.display ?? d?.estimatedTime ?? d?.plannedTime));
      const soon = mins.filter(m => m >= 0 && m <= LOOKAHEAD_MINUTES);

      // Closeness-weighted score: 1 if now, 0 if at horizon
      let score = 0;
      for (const m of soon) score += 1 - (m / LOOKAHEAD_MINUTES);

      // Normalize 0..1, with a floor
      const weight = Math.max(MIN_WEIGHT, Math.min(1, score / BUSY_DIVISOR));

      // Site coordinates (handle different shapes)
      const lat =
        s?.latitude ?? s?.lat ?? s?.location?.latitude ?? s?.geometry?.coordinates?.[1];
      const lon =
        s?.longitude ?? s?.lon ?? s?.location?.longitude ?? s?.geometry?.coordinates?.[0];

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          weight,
          name: s.name,
          siteId: id,
          departuresCount: soon.length,
          ts: now.toISOString()
        }
      });
    }

    res.status(200).json({ type: "FeatureCollection", features });
  } catch (e) {
    res.status(500).json({ error: "feed-failed", details: String(e) });
  }
};
