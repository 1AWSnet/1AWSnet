// Renders a structured OCR result (../haiku_shared_js/structure.js's structureOcrResult
// output) into index.html's trips table and summary line. Depends on getOcrPageElements /
// makeCell / makeMultilineCell / makeTripOrderCell (../haiku_shared_js/dom-helpers.js) --
// loaded before this script.

const { tripsTable, tripsBody, summaryEl } = getOcrPageElements();

function makeRateCell(trip) {
  const td = document.createElement('td');
  const amount = document.createElement('span');
  amount.className = trip.rate ? 'rate-amount' : 'rate-amount unmatched';
  amount.textContent = trip.rate ? `$${trip.rate.newRate}` : '$??';
  td.appendChild(amount);
  return td;
}

// structureOcrResult() (../haiku_shared_js/structure.js) flags a trip number
// that came up short an LLD or LUL row with its MISSING_ROW placeholder, whose name is
// literally "(missing)". Swap that for a clearer flag here at render time only — no
// change to structure.js needed for that.
function originDisplay(trip) {
  if (trip.origin.name === '(missing)') return ['UNRECOGNIZED!'];
  return trip.origin.terminalLines || [`${trip.origin.name} — ${trip.origin.address}`];
}
function destinationDisplay(trip) {
  if (trip.destination.name === '(missing)') return 'UNRECOGNIZED!';
  return trip.destination.city || `${trip.destination.name} — ${trip.destination.address}`;
}

function renderTrips(structured) {
  tripsBody.innerHTML = '';
  for (const trip of structured.trips) {
    const tr = document.createElement('tr');
    tr.appendChild(makeTripOrderCell(trip.tripNumber, trip.orderNumber));
    tr.appendChild(makeMultilineCell(originDisplay(trip), trip.origin.name === '(missing)' ? 'unmatched' : ''));
    tr.appendChild(makeCell(destinationDisplay(trip), trip.destination.name === '(missing)' ? 'unmatched' : ''));
    tr.appendChild(makeRateCell(trip));
    tripsBody.appendChild(tr);
  }
  tripsTable.style.display = structured.trips.length ? 'table' : 'none';

  const totalText = `Matched total: $${structured.matchedTotal}` +
    (structured.unmatchedCount ? ` (+ ${structured.unmatchedCount} trip(s) with no tariff match)` : '');
  summaryEl.textContent = `${structured.driverName} — ${structured.date}. ${totalText}`;
}
