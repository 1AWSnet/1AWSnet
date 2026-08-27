// Forked from haiku/haiku_shared_js/render.js so Straddle-driven fixes never change the
// Haiku pages' behavior (and vice versa) -- the two copies are free to diverge from
// here on. Unmodified at fork time.
//
// Renders a structured OCR result (structure.js's structureOcrResult output) into a
// page's trips table and summary line. Depends on getOcrPageElements (dom-helpers.js),
// TERMINALS / findTerminalEntry (terminals.js), and findTariffRate /
// allDestinationCities (structure.js) -- all this folder's own forks, loaded before
// this script.
//
// OCR can misread or fully drop a trip's origin terminal or destination city. A row
// that already resolved (parse-rec-texts.js found a real match) just shows plain
// text -- there's nothing to fix. Only an unresolved row gets an editable control: a
// dropdown of known terminals for the origin, a city text box with autocomplete for
// the destination. Picking a value recomputes that trip's rate immediately and updates
// the summary total, but never locks in: the control stays there and editable so a
// wrong pick can be corrected again later.

const { tripsTable, tripsBody, summaryEl } = getOcrPageElements();

// Backs every destination input's autocomplete list -- one shared <datalist>, since its
// options (every city the tariff tables know about) are the same for every row.
const destinationCities = allDestinationCities();
const destinationCitiesListEl = document.createElement('datalist');
destinationCitiesListEl.id = 'haikuDestinationCities';
for (const city of destinationCities) {
  const option = document.createElement('option');
  option.value = city;
  destinationCitiesListEl.appendChild(option);
}
document.body.appendChild(destinationCitiesListEl);

function terminalLabel(entry) {
  return entry.lines.join(' — ');
}

// Built with DOM APIs (not innerHTML) so OCR'd text is always treated as plain text,
// never parsed as markup, however it's punctuated.
function makeTextCell(lines) {
  const td = document.createElement('td');
  lines.forEach((line, i) => {
    if (i > 0) td.appendChild(document.createElement('br'));
    td.appendChild(document.createTextNode(line));
  });
  return td;
}

// Origin cell: plain text once a terminal is already matched -- nothing to fix, so
// nothing to edit. Only an unresolved row gets the dropdown (every known terminal plus
// "UNRECOGNIZED"), which stays editable so a wrong pick can be changed again later.
function buildOriginCell(trip, onEdit) {
  const matched = trip.origin.name === '(missing)' ? null : findTerminalEntry(trip.origin.name);
  if (matched) return makeTextCell(matched.lines);

  const td = document.createElement('td');
  const select = document.createElement('select');

  const unrecognized = document.createElement('option');
  unrecognized.value = '';
  unrecognized.textContent = 'UNRECOGNIZED';
  select.appendChild(unrecognized);

  TERMINALS.forEach((entry, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = terminalLabel(entry);
    select.appendChild(option);
  });

  select.className = 'unmatched';
  select.addEventListener('change', () => {
    const entry = select.value === '' ? null : TERMINALS[Number(select.value)];
    trip.origin.city = entry ? entry.city : null;
    trip.origin.state = entry ? entry.state : null;
    trip.origin.terminalLines = entry ? entry.lines : null;
    select.className = entry ? '' : 'unmatched';
    onEdit();
  });

  td.appendChild(select);
  return td;
}

// Destination cell: plain text once a city is already resolved from the address --
// nothing to fix, so nothing to edit. Only an unresolved row gets the text box (with a
// native autocomplete list of every tariff city). Deliveries are arbitrary consignees,
// not a curated set, so unlike the origin dropdown this takes free text -- it only
// resolves to a city once the typed text exactly matches one of the known ones
// (case-insensitively).
function buildDestinationCell(trip, onEdit) {
  if (trip.destination.city) return makeTextCell([`${trip.destination.city}, ${trip.destination.state}`]);

  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'UNRECOGNIZED';
  input.setAttribute('list', destinationCitiesListEl.id);
  input.className = 'unmatched';

  input.addEventListener('change', () => {
    const typed = input.value.trim();
    const match = destinationCities.find((city) => city.toLowerCase() === typed.toLowerCase());
    const commaIndex = match ? match.lastIndexOf(',') : -1;
    trip.destination.city = match ? match.slice(0, commaIndex).trim() : null;
    trip.destination.state = match ? match.slice(commaIndex + 1).trim() : null;
    input.value = match || typed;
    input.className = match ? '' : 'unmatched';
    onEdit();
  });

  td.appendChild(input);
  return td;
}

function paintRate(amountEl, trip) {
  amountEl.className = trip.rate ? 'rate-amount' : 'rate-amount unmatched';
  amountEl.textContent = trip.rate ? `$${trip.rate.newRate}` : '$??';
}

function updateSummary(structured) {
  const matchedTotal = structured.trips.reduce((sum, t) => sum + (t.rate ? t.rate.newRate : 0), 0);
  const unmatchedCount = structured.trips.filter((t) => !t.rate).length;
  const totalText = `Matched total: $${matchedTotal}` +
    (unmatchedCount ? ` (+ ${unmatchedCount} trip(s) with no tariff match)` : '');
  summaryEl.textContent = `${structured.driverName} — ${structured.date}. ${totalText}`;
}

function renderTrips(structured) {
  tripsBody.innerHTML = '';
  for (const trip of structured.trips) {
    const tr = document.createElement('tr');
    const rateTd = document.createElement('td');
    const rateAmount = document.createElement('span');
    rateTd.appendChild(rateAmount);
    paintRate(rateAmount, trip);

    const onEdit = () => {
      trip.rate = findTariffRate(trip.origin, trip.destination);
      paintRate(rateAmount, trip);
      updateSummary(structured);
    };

    tr.appendChild(makeTripOrderCell(trip.tripNumber, trip.orderNumber));
    tr.appendChild(buildOriginCell(trip, onEdit));
    tr.appendChild(buildDestinationCell(trip, onEdit));
    tr.appendChild(rateTd);
    tripsBody.appendChild(tr);
  }
  tripsTable.style.display = structured.trips.length ? 'table' : 'none';
  updateSummary(structured);
}
