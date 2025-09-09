// Live crowd proxy for Stockholm using SL Transport departures
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    // 1) Load all SL sites once
    const sites = await fetch("https://transport.integration.sl.se/v1/sites?expand=true")
      .then(r => r.json());

    // Pick central hubs by name
    const HUB_NAMES = [
      "T-Centralen","Slussen","Odenplan","Gullmarsplan","Fridhemsplan",
      "Skanstull","Gamla stan","Tekniska högskolan","Hornstull","Stadion"
    ];
    const hubs = (sites || []).filter(s =>
      s?.name && HUB_NAMES.some(n => s.name.toLowerCase().includes(n.toLowerCase()))
    );

    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 60 * 1000); // next 30 min
    const features = [];

    // 2) For each hub, fetch live departures and score "crowd"
    for (const s of hubs) {
      const id = s.id;
      if (!id) continue;

      const dep = await fetch(`https://transport.integration.sl.se/v1/sites/${id}/departures`,
        { cache: "no-store" }
      ).then(r => r.json());

      // Flatten known modes
      let items = [];
      for (const k of ["metro","bus","tram","train","ferry","ship"])
        if (Array.isArray(dep?.[k])) items = items.concat(dep[k]);

      // Count departures within next 30 minutes
      const upcoming = items.filter(d => {
        const t = d?.plannedTime ?? d?.display ?? d?.advertisedTimeAtLocation;
        const dt = t ? new Date(t) : null;
        return dt && dt >= now && dt <= soon;
      });

      // Normalize to 0..1 for heat weight
      const weight = Math.max(0.05, Math.min(1, upcoming.length / 20));

      const lat = s?.latitude ?? s?.lat ?? s?.location?.latitude ?? s?.geometry?.coordinates?.[1];
      const lon = s?.longitude ?? s?.lon ?? s?.location?.longitude ?? s?.geometry?.coordinates?.[0];
      if (!(Number.isFinite(lat) && Number.isFinite(lon))) continue;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { weight, name: s.name, siteId: id, ts: now.toISOString() }
      });
    }

    res.status(200).json({ type: "FeatureCollection", features });
  } catch (e) {
    res.status(500).json({ error: "feed-failed", details: String(e) });
  }
};
