// Converts PP-StructureV3's rec_texts (flat OCR text lines from the /structure
// endpoint) into the {date, driverName, rows: [...]} shape structureOcrResult()
// expects (structure.js, this folder's own fork of haiku/haiku_frame/js/structure.js)
// -- all the trip pairing / city-state parsing / tariff lookup / terminal lookup logic
// there is reused as-is. Depends on findTerminal from terminals.js (also this folder's
// own fork), loaded before this script.
//
// Validated against real PP-StructureV3 output from 3 real Driver Summary Report
// photos before being wired into the page. PP-StructureV3's line order is less
// reliable than Haiku's around the "Trip:" header specifically -- the Refinery BL#
// value sometimes sorts in right after "Trip:" instead of the trip's own number, so
// trip number is never read from text near "Trip:" (see tripNumber below). Delivery
// rows are also more likely to have their name/address split across several short
// recognized lines rather than one or two clean ones (a single physical row's text
// getting interleaved with an adjacent column during reading-order sorting) -- see
// findAddressWithSpan and looksLikeNonNameLine.

const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

const STREET_SUFFIXES =
  '(?:STREET|ROAD|AVENUE|DRIVE|LANE|PLACE|COURT|WAY|BOULEVARD|PARKWAY|TURNPIKE|HIGHWAY|ROUTE|CIRCLE)';

// Finds the delivery address within a blob of joined candidate lines, along with
// where it starts/ends in that blob (so the caller can use everything before it as the
// delivery name). Tries every digit position that isn't embedded mid-word (not just
// the first one re.exec/matchAll would normally stop at), and prefers the SHORTEST
// valid match when several qualify.
//
// Both of those are needed because a delivery's own numeric ID (e.g. "306 GPM VALERO")
// or a bare rate figure with no "$" (e.g. "90") can sit earlier in the same blob as the
// real address, and also starts with a digit -- without a length cap and boundary
// check, the greedy match swallows straight through it into the real street ("306 GPM
// VALERO...269 MAIN STREET, Windsor Locks, CT"); without trying every position
// independently, a short valid match starting a few characters after a longer one that
// already matched successfully never even gets attempted, since regex match-finding
// treats that span as already consumed. The real address is reliably the
// tightest-fitting candidate.
function findAddressWithSpan(text) {
  const candidates = [];
  for (const startMatch of text.matchAll(/(?<!\w)\d/g)) {
    const pos = startMatch.index;
    const m = text.slice(pos).match(/^(\d[^,\n]{0,25},\s*[^,\n]+,\s*([A-Z]{2}))\b/);
    if (m && STATE_CODES.has(m[2])) {
      candidates.push({ address: m[1].trim(), start: pos, end: pos + m[1].length });
    }
  }
  if (candidates.length) {
    return candidates.reduce((a, b) => (b.end - b.start < a.end - a.start ? b : a));
  }

  const suffixMatch = text.match(new RegExp(`(?<!\\w)\\d[^\\n]{0,25}?\\b${STREET_SUFFIXES}\\b`, 'i'));
  if (!suffixMatch) return null;
  const street = suffixMatch[0];
  const rest = text.slice(suffixMatch.index + street.length);
  const tailMatch = rest.match(/^\.?,?\s+([^,\n]+?),?\s*([A-Z]{2})\b/);
  if (tailMatch && STATE_CODES.has(tailMatch[2])) {
    return {
      address: `${street}, ${tailMatch[1]}, ${tailMatch[2]}`.trim(),
      start: suffixMatch.index,
      end: suffixMatch.index + street.length + tailMatch[0].length,
    };
  }
  return null;
}

// A line that's clearly not part of a delivery's name -- a UN-hazmat product code, a
// bare "$" (with or without digits), or a comma-containing digit run (a quantity like
// "8,500") -- so name/address assembly can skip past it. Deliberately does NOT filter
// a plain digit run with no comma (e.g. "1589", a bare "90") -- that's sometimes
// genuinely the leading number of a split-apart street address, which
// findAddressWithSpan needs to see to find the address at all.
function looksLikeNonNameLine(line) {
  if (/^UN\s?\d{3,4}\b/i.test(line)) return true;
  if (/^\$[\d,]*$/.test(line)) return true;
  if (/^[\d,]+$/.test(line) && line.includes(',')) return true;
  return false;
}

function parseRecTextsToRows(recTexts) {
  const rawText = recTexts.join('\n');

  // Prefers a real 4-digit year (the shift date printed at the top of the page);
  // falls back to a 2-digit year only when no 4-digit date exists anywhere in the
  // recognized text (seen once: the top date field failed OCR entirely, misread down
  // to a couple of stray letters). The 2-digit fallback rejects a match immediately
  // followed by another digit, since OCR sometimes drops the space between a
  // 2-digit-year date and an adjacent time (e.g. "3/15/2612:00am"), which would
  // otherwise look exactly like a valid 4-digit year ending in "12".
  const dateMatch =
    rawText.match(/\d{1,2}\/\d{1,2}\/20\d{2}\b/) || rawText.match(/\d{1,2}\/\d{1,2}\/\d{2}(?!\d)/);

  // Bounded to exactly two capitalized words (first + last name) -- an unbounded
  // repeat here runs straight into the next label on the line below (e.g. "Tractor:"),
  // since \s+ matches across the newlines separate OCR lines get joined with here.
  const driverMatch = rawText.match(/Driver:?\s*([A-Z][A-Za-z'-]*\s+[A-Z][A-Za-z'-]*)/);
  const driverName = driverMatch ? driverMatch[1].replace(/\s+/g, ' ').toUpperCase() : '';

  // Trip number is always this header's position among all "Trip:" occurrences (1st =
  // trip 1, 2nd = trip 2, ...), never read from text near "Trip:" itself -- unlike
  // Haiku, PP-StructureV3's line ordering for this dense header row is unreliable.
  const tripMatches = [...rawText.matchAll(/Trip:/g)];
  const rows = [];

  for (let i = 0; i < tripMatches.length; i++) {
    const tripNumber = String(i + 1);
    const start = tripMatches[i].index + tripMatches[i][0].length;
    const end = i + 1 < tripMatches.length ? tripMatches[i + 1].index : rawText.length;
    const chunk = rawText.slice(start, end);

    // Prefers a number directly labeled "Order #:" -- falls back to the first 6-8
    // digit run in the chunk only when that label's own value got sorted elsewhere
    // (seen once: the whole header row scrambled enough that "Order #:" landed next to
    // the Refinery BL# text instead, while the real order number sat unlabeled near
    // the top of the chunk).
    const labeledOrder = chunk.match(/Order\s*#?:?\s*(\d{5,8})/);
    const fallbackOrder = chunk.match(/\b(\d{6,8})\b/);
    const orderNumber = labeledOrder ? labeledOrder[1] : fallbackOrder ? fallbackOrder[1] : null;
    if (!orderNumber) continue;

    const lines = chunk.split('\n');

    for (const line of lines) {
      if (findTerminal(line)) {
        // Strips a leading "<seq#> LLD" if the tag ended up merged onto the same line
        // as the terminal name, rather than as its own separate OCR line.
        const name = line.replace(/^\s*\d*\s*LLD\s*/i, '').trim();
        rows.push({ tripNumber, rowType: 'LLD', orderNumber, name, address: '' });
      }
    }

    for (let li = 0; li < lines.length; li++) {
      // Case-insensitive: PP-StructureV3 sometimes reads the tag itself with scrambled
      // case (e.g. "Lul" instead of "LUL") -- the same per-character case uncertainty
      // seen in city names, just landing on the tag this time.
      //
      // Leading boundary is "not preceded by a letter" rather than "start of line or
      // whitespace" -- a sequence number sometimes glues directly onto the tag with no
      // space at all (e.g. "2LUL"), which a \s/start-of-line requirement would miss
      // entirely, silently dropping that row's whole address. Digits, punctuation, and
      // start-of-string are all fine to precede it; only a letter isn't (that's what
      // keeps this from matching "UL" inside "ULTRA" or "SULFUR" -- see findAddressWithSpan's
      // trailing \b for the other half of that same guard).
      const tagMatch = lines[li].match(/(?<![A-Za-z])(LUL|UL)\b\s*(.*)$/i);
      if (!tagMatch) continue;

      const candidateLines = [];
      for (let lj = li + 1; lj < lines.length; lj++) {
        const line = lines[lj].trim();
        if (!line) continue;
        if (/(?<![A-Za-z])(LUL|UL)\b/i.test(line) || findTerminal(line)) break;
        if (looksLikeNonNameLine(line)) continue;
        candidateLines.push(line);
      }

      const blob = candidateLines.join(' ');
      const found = findAddressWithSpan(blob);
      if (!found) continue;

      const namePrefix = blob.slice(0, found.start).trim();
      const name = [tagMatch[2].trim(), namePrefix].filter(Boolean).join(' ');
      rows.push({ tripNumber, rowType: 'LUL', orderNumber, name, address: found.address });
    }
  }

  return {
    date: dateMatch ? dateMatch[0] : '',
    driverName,
    rows,
  };
}
