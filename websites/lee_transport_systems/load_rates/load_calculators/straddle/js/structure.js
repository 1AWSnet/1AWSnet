// Forked from haiku/haiku_shared_js/structure.js so Straddle-driven fixes never change
// the Haiku pages' behavior (and vice versa) -- the two copies are free to diverge from
// here on.
//
// Turns parse-rec-texts.js's flat per-row extraction into trip records with a matched
// settlement-tariff rate. Runs entirely in the browser -- no extra OCR call per photo --
// so parsing stays a plain per-row transcription of what's printed on the page, and all
// business logic (pairing LLD/LUL rows into trips, city/state parsing, tariff lookup,
// totals) lives here, where it's exact and can be fixed without touching OCR at all. The
// parser never pairs a trip's LLD row with its LUL row itself -- it only tags each row
// with its own trip number, and groupRowsIntoTrips below does the pairing
// deterministically.
// Depends on CT_TARIFF/NE_TARIFF from ../../../settlement_tariff/js/data.js and
// findTerminal from terminals.js (this folder's own copy), both loaded before this
// script.

const TARIFFS = [CT_TARIFF, NE_TARIFF];

// Corrects known OCR misreads of a city name before tariff lookup/display, so a
// single misread letter doesn't silently turn into "no tariff match" -- same idea as
// TERMINALS' name misread arrays in terminals.js, but keyed on city name since
// that's what feeds findTariffRate. Keyed lowercase; value is the corrected,
// properly-cased name shown on screen. Add more entries here as they're found.
const CITY_MISREADS = {
  bradford: 'Branford', // OCR misread of Branford (drops the "n")
  enfied: 'Enfield', // PP-StructureV3 misread of Enfield (drops the "l")
  betny: 'Bethany', // PP-StructureV3 misread of Bethany (drops the "ha")
};

// LLD/LUL addresses are always printed as "Street, City, ST" — the tariff only keys
// on city + state, so this keeps just the last two comma-separated segments.
function parseCityState(address) {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const rawCity = parts[parts.length - 2];
  const city = CITY_MISREADS[rawCity.toLowerCase()] || rawCity;
  return { city, state: parts[parts.length - 1] };
}

function cityStateKey(cityState) {
  return cityState ? `${cityState.city}, ${cityState.state}`.toLowerCase() : null;
}

// Every destination city that appears in the tariff tables, deduped and sorted -- the
// full set of valid destinations a delivery's city can be corrected to.
function allDestinationCities() {
  const cities = new Set();
  for (const tariff of TARIFFS) {
    for (const [, destination] of tariff.rows) cities.add(destination);
  }
  return [...cities].sort();
}

const DESTINATION_CITY_KEYS = new Set(allDestinationCities().map((c) => c.toLowerCase()));

// parseCityState only checks that an address had a city/state-shaped tail -- it has no
// idea whether that city is a real, known one (a misread like "Betny" parses out fine
// structurally). Without this check, render.js's buildDestinationCell sees a non-empty
// city and treats the row as already resolved, so the editable "UNRECOGNIZED" box (the
// only way to actually fix a bad city) never appears.
function isKnownDestination(cityState) {
  return !!cityState && DESTINATION_CITY_KEYS.has(cityStateKey(cityState));
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
        // Carries the tariff table's own origin/destination text back with the rate --
        // it's transcribed straight from the real tariff PDF, so it's always correctly
        // spelled and cased. Once a trip is matched, there's no reason to keep showing
        // whatever case OCR happened to read (e.g. "WindsOr LOCks, CT") when the
        // verified real spelling is already sitting right here.
        return {
          tariffNumber: tariff.number, tariffName: tariff.name, oldRate, newRate,
          canonicalOrigin: rowOrigin, canonicalDestination: rowDest,
        };
      }
    }
  }
  return null;
}

// Stands in for an LLD/LUL row that should exist for a trip number but doesn't (e.g.
// the OCR pipeline tagged a row with the wrong trip number and left this trip short a
// leg) — kept visible as "(missing)" rather than silently dropping the trip, so a
// grouping problem shows up on screen instead of just vanishing from the total.
const MISSING_ROW = { name: '(missing)', address: '', orderNumber: '' };

// Groups the parser's flat, per-row transcription (each row tagged with its own trip
// number and LLD/LUL type) into trips. This is plain array grouping, not something the
// OCR/parsing step has any part in — it can't mis-pair an LLD with the wrong LUL
// because it never pairs them at all. Handles one LLD to one LUL (the common case), one
// LLD to several LULs, and several LLDs to one LUL. Several LLDs to several LULs for the
// same trip number isn't handled yet (falls back to pairing by position, which may not
// be right for that case).
function groupRowsIntoTrips(rows) {
  const byTrip = new Map();
  for (const row of rows) {
    if (!byTrip.has(row.tripNumber)) {
      byTrip.set(row.tripNumber, { origins: [], destinations: [] });
    }
    const bucket = byTrip.get(row.tripNumber);
    (row.rowType === 'LLD' ? bucket.origins : bucket.destinations).push(row);
  }

  const legs = [];
  for (const [tripNumber, { origins, destinations }] of byTrip) {
    const legCount = Math.max(origins.length, destinations.length, 1);
    for (let i = 0; i < legCount; i++) {
      const lld = origins.length === 1 ? origins[0] : origins[i] || MISSING_ROW;
      const lul = destinations.length === 1 ? destinations[0] : destinations[i] || MISSING_ROW;
      legs.push({ tripNumber, lld, lul });
    }
  }
  return legs;
}

function structureOcrResult(ocrResult) {
  const trips = groupRowsIntoTrips(ocrResult.rows).map(({ tripNumber, lld, lul }) => {
    // Origin city/state comes only from the LLD name's match in TERMINALS, never from
    // parsing lld.address -- a pickup terminal's location is a fixed, curated fact, not
    // something to re-derive per photo from text an OCR misread can corrupt. An LLD row
    // whose name doesn't match any known terminal is simply unresolved (null), the same
    // as it would be if TERMINALS didn't have it.
    const origin = findTerminalCityState(lld.name);
    const destination = parseCityState(lul.address);
    const rate = findTariffRate(origin, destination);
    // Once matched, shows the tariff row's own destination text instead of the
    // OCR-parsed one -- see findTariffRate's comment on canonicalDestination. Origin
    // never needs this: it already comes straight from curated TERMINALS, not OCR.
    // Otherwise, a destination that isn't a real known city (see isKnownDestination)
    // is treated as unresolved rather than shown as plain text, so it gets the
    // editable "UNRECOGNIZED" box instead of silently displaying a misread city name.
    const resolvedDestination = rate
      ? { ...destination, ...parseCityState(rate.canonicalDestination) }
      : isKnownDestination(destination) ? destination : null;

    return {
      tripNumber,
      orderNumber: lld.orderNumber,
      origin: {
        name: lld.name,
        address: lld.address,
        ...origin,
        terminalLines: findTerminal(lld.name),
      },
      destination: { name: lul.name, address: lul.address, ...resolvedDestination },
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
