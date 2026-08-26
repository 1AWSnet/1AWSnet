// Converts Haiku's raw, unstructured OCR text (from /api/ocr-regex) into the same
// {date, driverName, rows: [...]} shape worker.js's EXTRACTION_SCHEMA produces, so it
// can be fed straight into the existing, unmodified structureOcrResult() from
// ../haiku_shared_js/structure.js -- all the trip pairing / city-state parsing / tariff lookup /
// terminal lookup logic there is reused as-is, nothing about it changes for this path.
// Depends on findTerminal from ../haiku_shared_js/terminals.js (loaded before this
// script): LLD rows are found by matching a known terminal name directly, rather than
// by reading the "LLD" tag OCR misreads inconsistently (see parseRawTextToRows below).
//
// Validated against real Driver Summary Report photos. Specifically accounts for:
// a hazmat "Packing Group" code like "PG-II" false-matching as a state abbreviation if
// state codes aren't checked against a real list; two different per-row text layouts
// (name+tag on one line vs. each field on its own line); OCR noise that reads like a
// "Trip: N" header (e.g. from handwriting bleeding into a totals section) but isn't
// one, rejected by requiring a real Order # nearby; and OCR dropping the comma before
// the city, after it, or both, in a printed street address.

const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

// Street-suffix words used to split "street city" when OCR drops the comma between
// them (see findAddressInText below). Deliberately not exhaustive -- just the suffixes
// seen in real scans so far; add more here as new ones turn up.
const STREET_SUFFIXES =
  '(?:STREET|ROAD|AVENUE|DRIVE|LANE|PLACE|COURT|WAY|BOULEVARD|PARKWAY|TURNPIKE|HIGHWAY|ROUTE|CIRCLE)';

function findAddressInText(text) {
  const re = /(\d[^,\n]*,\s*[^,\n]+,\s*([A-Z]{2}))\b/g;
  let m;
  while ((m = re.exec(text))) {
    if (STATE_CODES.has(m[2])) return m[1].trim();
  }

  // OCR sometimes drops the comma before the city, after it, or both (e.g. "607 NEW
  // PARK AVENUE West Hartford, CT" or "1589 Main Street, Willimantic CT"). The city
  // can be one word or two, so it can't be recovered by counting words back from the
  // state code -- instead, split the street from the city at a street-suffix word
  // (AVENUE, STREET, ...), found case-insensitively since OCR mixes ALL CAPS and Title
  // Case. The state code match right after it stays case-sensitive (real state codes
  // are always printed uppercase), done as a separate step so an ordinary word ending
  // right after the suffix -- e.g. "..West" -- can't be mistaken for one the way it
  // would if the whole match were case-insensitive.
  const suffixRe = new RegExp(`\\d[^\\n]*?\\b${STREET_SUFFIXES}\\b`, 'i');
  const suffixMatch = suffixRe.exec(text);
  if (!suffixMatch) return null;
  const street = suffixMatch[0];
  const rest = text.slice(suffixMatch.index + street.length);
  const tailMatch = rest.match(/^\.?,?\s+([^,\n]+?),?\s*([A-Z]{2})\b/);
  if (tailMatch && STATE_CODES.has(tailMatch[2])) {
    return `${street}, ${tailMatch[1]}, ${tailMatch[2]}`.trim();
  }

  return null;
}

function parseRawTextToRows(rawText) {
  const dateMatch = rawText.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
  const driverMatch = rawText.match(/Driver:?\s*([A-Z][A-Za-z'-]+\s+[A-Z][A-Za-z'-]+)/);

  // Matches on the word "Trip" alone and skips past whatever punctuation separates it
  // from the number ("Trip: 1", "Trip 1", "Trip #1", ...) rather than enumerating every
  // separator OCR might produce -- but only punctuation/whitespace (":", "#", spaces),
  // never arbitrary text. A greedier \D* here would, when OCR drops the trip's own
  // number, skip straight past it into "Order #: 1275338" and capture the ORDER number
  // as if it were the trip number -- which also swallows the "Order #:" text itself
  // into this match, so the order-number lookup below finds nothing and the whole trip
  // gets rejected as noise. Stopping at the first non-separator character means a
  // missing number here just leaves the capture group empty instead.
  const tripHeaderRe = /Trip[:\s#]*(\d+)?/g;
  const matches = [...rawText.matchAll(tripHeaderRe)];
  const rows = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    // A missing capture (OCR dropped the trip's own number) falls back to this
    // header's position among the trip headers found -- 1st is trip 1, 2nd is trip 2,
    // and so on, which is safe because these reports always number trips in order.
    const tripNumber = match[1] || String(i + 1);
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const chunk = rawText.slice(start, end);

    // Rejects OCR noise that reads like "Trip: N" but has no real trip data after it.
    // Some scans place the first trip's "Order #" on the column-header line, before
    // the "Trip: 1" marker itself, rather than after it -- fall back to the text
    // since the previous trip marker (or start of document) to still catch it.
    const orderRe = /Order\s*#?:?\s*(\d+)/;
    let orderMatch = chunk.match(orderRe);
    if (!orderMatch) {
      const prevEnd = i === 0 ? 0 : matches[i - 1].index + matches[i - 1][0].length;
      orderMatch = rawText.slice(prevEnd, match.index).match(orderRe);
    }
    if (!orderMatch) continue;

    const lines = chunk.split('\n');

    // LLD (pickup terminal) rows are found by matching a known terminal name anywhere
    // in the line, not by reading the "LLD" tag -- OCR misreads that tag too many
    // different ways to keep tolerating one at a time (LD, R LO, ...), and a terminal's
    // full name is far more reliably read than a two-letter tag. No address is kept for
    // these rows -- structureOcrResult resolves an LLD row's city/state from TERMINALS
    // by name, never by parsing its printed address (see the comment there). A pickup
    // terminal not yet in TERMINALS is simply unresolved (structureOcrResult falls back
    // to a MISSING_ROW placeholder for that trip, which the UI shows as an editable
    // "UNRECOGNIZED" control the same as any other unresolved origin), the same as it
    // would be if it were listed but this particular photo's name were unreadable.
    for (const line of lines) {
      if (findTerminal(line)) {
        rows.push({ tripNumber, rowType: 'LLD', orderNumber: orderMatch[1], name: line.trim(), address: '' });
      }
    }

    // LUL (delivery) rows are still found by their tag -- deliveries are arbitrary
    // consignees, not a curated list to match names against the way LLD terminals are.
    // "UL" tolerates a known misread that drops the leading L from "LUL" -- normalized
    // back to "LUL" below so nothing downstream needs to know about it.
    for (let li = 0; li < lines.length; li++) {
      const tagMatch = lines[li].match(/(?:^|\s)(LUL|UL)\s*(.*)$/);
      if (!tagMatch) continue;
      let restOfLine = tagMatch[2].trim();

      let nameLineIdx = li;
      if (!restOfLine) {
        for (let lj = li + 1; lj < lines.length; lj++) {
          if (lines[lj].trim()) {
            restOfLine = lines[lj].trim();
            nameLineIdx = lj;
            break;
          }
        }
      }

      let address = null;
      for (let lj = nameLineIdx; lj < lines.length; lj++) {
        // Stops at the next delivery row or the next pickup terminal, whichever comes
        // first, so this row's address search can't bleed into either one.
        if (lj > nameLineIdx && (/\b(LUL|UL)\b/.test(lines[lj]) || findTerminal(lines[lj]))) break;
        const searchText = lj === nameLineIdx ? restOfLine : lines[lj];
        const found = findAddressInText(searchText);
        if (found) {
          address = found;
          break;
        }
      }

      // No address found for this row -- leave it out rather than guess; with no LUL
      // row for this trip number, structureOcrResult's MISSING_ROW fallback takes over
      // downstream.
      if (!address) continue;

      rows.push({ tripNumber, rowType: 'LUL', orderNumber: orderMatch[1], name: restOfLine, address });
    }
  }

  return {
    date: dateMatch ? dateMatch[0] : '',
    driverName: driverMatch ? driverMatch[1] : '',
    rows,
  };
}
