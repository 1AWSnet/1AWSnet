// Renders a structured OCR result (../haiku_shared_js/structure.js's structureOcrResult
// output) into index.html's trips table and summary line. Depends on getOcrPageElements /
// makeCell / makeMultilineCell / makeTripOrderCell (../haiku_shared_js/dom-helpers.js) --
// loaded before this script.

const { tripsTable, tripsBody, summaryEl } = getOcrPageElements();

function makeRateCell(trip) {
  const td = document.createElement('td');
  if (!trip.rate) {
    td.className = 'unmatched';
    td.textContent = 'No tariff match — verify manually';
    return td;
  }
  const amount = document.createElement('span');
  amount.className = 'rate-amount';
  amount.textContent = `$${trip.rate.newRate}`;
  td.appendChild(amount);
  return td;
}

function renderTrips(structured) {
  tripsBody.innerHTML = '';
  for (const trip of structured.trips) {
    const tr = document.createElement('tr');
    tr.appendChild(makeTripOrderCell(trip.tripNumber, trip.orderNumber));
    const originLines = trip.origin.terminalLines || [`${trip.origin.name} — ${trip.origin.address}`];
    tr.appendChild(makeMultilineCell(originLines));
    tr.appendChild(makeCell(trip.destination.city || `${trip.destination.name} — ${trip.destination.address}`));
    tr.appendChild(makeRateCell(trip));
    tripsBody.appendChild(tr);
  }
  tripsTable.style.display = structured.trips.length ? 'table' : 'none';

  const totalText = `Matched total: $${structured.matchedTotal}` +
    (structured.unmatchedCount ? ` (+ ${structured.unmatchedCount} trip(s) with no tariff match)` : '');
  summaryEl.textContent = `${structured.driverName} — ${structured.date}. ${totalText}`;
}
