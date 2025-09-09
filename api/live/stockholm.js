// api/live/stockholm.js
// Vercel serverless function
// Converts GTFS-RT protobuf vehicle positions into GeoJSON for Stockholm

const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const key = process.env.GTFS_KEY; // Your Trafiklab key in Vercel
    if (!key) throw new Error("Missing GTFS_KEY");

    // National realtime vehicle positions feed
    const url = `https://opendata.samtrafiken.se/gtfs-rt/sweden/VehiclePositions.pb?key=${key}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);

    // Decode protobuf
    const buffer = Buffer.from(await response.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

    // Only keep vehicles inside greater Stockholm
    const BOX = [17.7, 59.15, 18.35, 59.50]; // [minLng, minLat, maxLng, maxLat]
    const inBox = (lon, lat) => lon > BOX[0] && lon < BOX[2] && lat > BOX[1] && lat < BOX[3];

    const now = new Date().toISOString();
    const features = [];

    for (const entity of feed.entity) {
      const vp = entity.vehicle;
      if (!vp || !vp.position) continue
