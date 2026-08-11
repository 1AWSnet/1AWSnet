// Turns the raw OCR JSON from /api/ocr (worker.js's EXTRACTION_SCHEMA) into trip
// records with a matched settlement-tariff rate. Runs entirely in the browser — no
// extra Haiku call per photo — so the extraction schema stays a plain transcription
// of what's printed on the page, and all business logic (city/state parsing, tariff
// lookup, totals) lives here where it can be fixed without touching the OCR prompt.
// Depends on CT_TARIFF/NE_TARIFF from ../../settlement_tariff/js/data.js, loaded
// before this script.

const TARIFFS = [CT_TARIFF, NE_TARIFF];

// LLD/LUL addresses are always printed as "Street, City, ST" — the tariff only keys
// on city + state, so this keeps just the last two comma-separated segments.
function parseCityState(address) {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { city: parts[parts.length - 2], state: parts[parts.length - 1] };
}

function cityStateKey(cityState) {
  return cityState ? `${cityState.city}, ${cityState.state}`.toLowerCase() : null;
}

// Returns null (not a $0 rate) when no tariff row matches, so a bad/unlisted
// origin-destination pair is visibly unresolved instead of silently paying nothing.
function findTariffRate(origin, destination) {
  const originKey = cityStateKey(origin);
  const destKey = cityStateKey(destination);
  if (!originKey || !destKey) return null;

  for (const tariff of TARIFFS) {
    for (const [rowOrigin, rowDest, oldRate, newRate] of tariff.rows) {
      if (rowOrigin.toLowerCase() === originKey && rowDest.toLowerCase() === destKey) {
        return { tariffNumber: tariff.number, tariffName: tariff.name, oldRate, newRate };
      }
    }
  }
  return null;
}

function structureOcrResult(ocrResult) {
  const trips = ocrResult.trips.map((trip) => {
    const origin = parseCityState(trip.lldAddress);
    const destination = parseCityState(trip.lulAddress);
    const rate = findTariffRate(origin, destination);

    return {
      tripNumber: trip.tripNumber,
      orderNumber: trip.orderNumber,
      origin: { name: trip.lldName, address: trip.lldAddress, ...origin },
      destination: { name: trip.lulName, address: trip.lulAddress, ...destination },
      rate,
    };
  });

  const matchedTotal = trips.reduce((sum, t) => sum + (t.rate ? t.rate.newRate : 0), 0);
  const unmatchedCount = trips.filter((t) => !t.rate).length;

  return {
    date: ocrResult.date,
    driverName: ocrResult.driverName,
    trips,
    matchedTotal,
    unmatchedCount,
  };
}
