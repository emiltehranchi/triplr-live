// api/live/stockholm.js
// Decodes GTFS-RT with protobufjs and returns GeoJSON for Stockholm

const protobuf = require("protobufjs");

const GTFS_RT_PROTO = `
syntax = "proto2";
package transit_realtime;

message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional Incrementality incrementality = 2 [default = FULL_DATASET];
  optional uint64 timestamp = 3;
  enum Incrementality { FULL_DATASET = 0; DIFFERENTIAL = 1; }
}
message FeedEntity {
  required string id = 1;
  optional VehiclePosition vehicle = 3;
}
message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional Position position = 2;
  optional uint64 timestamp = 5;
  optional VehicleDescriptor vehicle = 8;
}
message Position {
  optional float latitude = 1;
  optional float longitude = 2;
  optional float bearing = 3;
  optional double odometer = 4;
  optional float speed = 5;
}
message TripDescriptor { optional string route_id = 5; }
message VehicleDescriptor { optional string id = 1; }
`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const key = process.env.GTFS_KEY;
    if (!key) throw new Error("Missing GTFS_KEY");

    // Correct Sweden-3 endpoint for your key
    const url = `https://opendata.samtrafiken.se/gtfs-rt/sweden-3/VehiclePositions.pb?key=${key}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Upstream ${r.status}`);

    const buf = Buffer.from(await r.arrayBuffer());

    // Decode protobuf using inline schema
    const root = protobuf.parse(GTFS_RT_PROTO).root;
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
    const msg = FeedMessage.decode(buf);
    const feed = FeedMessage.toObject(msg, {
      longs: Number, enums: Number, defaults: false
    });

    // Only keep greater Stockholm
    const BOX = [17.7, 59.15, 18.35, 59.50]; // [minLng,minLat,maxLng,maxLat]
    const now = new Date().toISOString();
    const features = [];

    for (const e of feed.entity || []) {
      const v = e.vehicle;
      const p = v && v.position;
      if (!p || typeof p.latitude !== "number" || typeof p.longitude !== "number") continue;
      const lon = p.longitude, lat = p.latitude;
      if (!(lon > BOX[0] && lon < BOX[2] && lat > BOX[1] && lat < BOX[3])) continue;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          weight: 1.0,
          speed: p.speed ?? null,
          bearing: p.bearing ?? null,
          route_id: v.trip?.route_id ?? null,
          vehicle_id: v.vehicle?.id ?? null,
          ts: now
        }
      });
    }

    res.status(200).json({ type: "FeatureCollection", features });
  } catch (err) {
    res.status(500).json({ error: "feed-failed", details: String(err) });
  }
};
