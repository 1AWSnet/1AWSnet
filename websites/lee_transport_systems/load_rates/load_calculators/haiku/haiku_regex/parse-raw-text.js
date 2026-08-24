// Converts Haiku's raw, unstructured OCR text (from /api/ocr-regex) into the same
// {date, driverName, rows: [...]} shape worker.js's EXTRACTION_SCHEMA produces, so it
// can be fed straight into the existing, unmodified structureOcrResult() from
// ../haiku_shared_js/structure.js -- all the trip pairing / city-state parsing / tariff lookup /
// terminal lookup logic there is reused as-is, nothing about it changes for this path.
// Depends on findTerminal from ../haiku_shared_js/terminals.js (loaded before this
// script) for one thing only: deciding whether an LLD row with no parseable address is
// still worth keeping.
//
// Validated against 13 real Driver Summary Report photos. Specifically accounts for:
// a hazmat "Packing Group" code like "PG-II" false-matching as a state abbreviation if
// state codes aren't checked against a real list; two different per-row text layouts
// (name+tag on one line vs. each field on its own line); and OCR noise that reads like
// a "Trip: N" header (e.g. from handwriting bleeding into a totals section) but isn't
// one, which is rejected by requiring a real Order # nearby.

const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

function findAddressInText(text) {
  const re = /(\d[^,\n]*,\s*[^,\n]+,\s*([A-Z]{2}))\b/g;
  let m;
  while ((m = re.exec(text))) {
    if (STATE_CODES.has(m[2])) return m[1].trim();
  }
  return null;
}

function parseRawTextToRows(rawText) {
  const dateMatch = rawText.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
  const driverMatch = rawText.match(/Driver:?\s*([A-Z][A-Za-z'-]+\s+[A-Z][A-Za-z'-]+)/);

  // Matches on the word "Trip" alone and skips past whatever punctuation separates it
  // from the number ("Trip: 1", "Trip 1", "Trip #1", ...) rather than enumerating every
  // separator OCR might produce.
  const tripHeaderRe = /Trip\D*(\d+)/g;
  const matches = [...rawText.matchAll(tripHeaderRe)];
  const rows = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const tripNumber = match[1];
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
    for (let li = 0; li < lines.length; li++) {
      // "LD"/"UL" tolerate a known misread that drops the leading L from "LLD"/"LUL" --
      // normalized back to "LLD"/"LUL" below so nothing downstream needs to know about it.
      const tagMatch = lines[li].match(/(?:^|\s)(LLD|LD|LUL|UL)\s*(.*)$/);
      if (!tagMatch) continue;
      const rowType = tagMatch[1] === 'LD' ? 'LLD' : tagMatch[1] === 'UL' ? 'LUL' : tagMatch[1];
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
        if (lj > nameLineIdx && /\b(LLD|LD|LUL|UL)\b/.test(lines[lj])) break;
        const searchText = lj === nameLineIdx ? restOfLine : lines[lj];
        const found = findAddressInText(searchText);
        if (found) {
          address = found;
          break;
        }
      }

      // No address found for this row -- normally leave it out rather than guess (with
      // no LLD/LUL row for this trip number, structureOcrResult's MISSING_ROW fallback
      // takes over downstream). Exception: an LLD row whose name matches a known
      // terminal doesn't need its address at all -- structureOcrResult resolves that
      // row's city/state from TERMINALS by name, not from this address text -- so keep
      // the row even with no address found.
      if (!address && !findTerminal(restOfLine)) continue;

      rows.push({ tripNumber, rowType, orderNumber: orderMatch[1], name: restOfLine, address: address || '' });
    }
  }

  return {
    date: dateMatch ? dateMatch[0] : '',
    driverName: driverMatch ? driverMatch[1] : '',
    rows,
  };
}
