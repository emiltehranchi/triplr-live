// CommonJS function for Vercel Serverless
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const key = process.env.GTFS_KEY; // set in Vercel → Settings → Environment Variables
    if (!key) throw new Error('Missing GTFS_KEY');

    // National realtime vehicle positions (protobuf)
    const url = `https://opendata.samtrafiken.se/gtfs-rt/sweden/VehiclePositions.pb?key=${key}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Upstream ${r.status}`);

    const buf = Buffer.from(await r.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

    // Keep only greater-Stockholm to reduce payload
    const BOX = [17.7, 59.15, 18.35, 59.50]; // [minLng, minLat, maxLng, maxLat]
    const inBox = (lon, lat) => lon > BOX[0] && lon < BOX[2] && lat > BOX[1] && lat < BOX[3];

    const now = new Date().toISOString();
    const features = [];

    for (const e of feed.entity) {
      const vp = e.vehicle;
      const p = vp && vp.position;
      if (!p) continue;

      const lat = p.latitude;
      const lon = p.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!inBox(lon, lat)) continue;

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          weight: 1.0,
          speed: p.speed ?? null,
          bearing: p.bearing ?? null,
          route_id: vp.trip?.routeId ?? null,
          vehicle_id: vp.vehicle?.id ?? null,
          ts: now
        }
      });
    }

    // Thin out to max 1500 points to keep map fast
    const max = 1500;
    const thinned = features.length > max
      ? features.filter((_, i) => i % Math.ceil(features.length / max) === 0)
      : features;

    res.status(200).json({ type: 'FeatureCollection', features: thinned });
  } catch (err) {
    res.status(500).json({ error: 'decode-failed', details: String(err) });
  }
};
