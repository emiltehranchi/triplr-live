export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const now = new Date().toISOString();

  // Make 100 random points inside Stockholm box
  const B = [17.95, 59.28, 18.15, 59.37];
  const points = Array.from({ length: 100 }, () => {
    const lng = B[0] + Math.random() * (B[2] - B[0]);
    const lat = B[1] + Math.random() * (B[3] - B[1]);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { weight: Math.random(), ts: now }
    };
  });

  res.status(200).json({ type: "FeatureCollection", features: points });
}
