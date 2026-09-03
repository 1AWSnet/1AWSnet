// Forked from haiku/haiku_frame/js/terminals.js so Straddle-driven fixes never change
// the Haiku pages' behavior (and vice versa) -- the two copies are free to diverge from
// here on.
//
// Curated display names for known pickup (LLD) terminals, keyed by a distinctive
// fragment of the NAME printed on the LLD row -- not the address. A misread digit in
// an address can coincidentally equal a different, unrelated terminal's real address
// (e.g. a misread "280 Waterfront" landing exactly on "500 Waterfront"), which is
// silently wrong with no way to detect it from the address text alone. A misread
// company name is far less likely to collide with a different terminal's real name.
//
// The printed name is often an old/legal name that predates a sale or rebrand (e.g.
// Magellan -> Buckeye) -- when that happens, update the `name` fragment below to
// whatever the paper now prints. Ownership changes are rare and the paper reads the
// same for every driver/photo, so this only needs updating once per change, not
// per misread. Addresses not listed here just fall back to showing the raw OCR'd
// name + address. Add more entries here as they're learned; keep fragments
// distinctive enough not to collide with each other (e.g. the two Magellan-owned
// terminals below are kept apart by including the location in the fragment, not
// just "Magellan").
//
// `name` can be a single fragment or an array of fragments -- add an array entry
// when OCR misreads a given terminal's printed name more than one way, so each known
// misread is its own array item instead of a separate TERMINALS entry.
const TERMINALS = [
    // 250 Eagles Nest Road, Bridgeport, CT
  { name: 'SPRAGUE BRIDGEPORT', lines: ['Sprague', 'Bridgeport'], city: 'Bridgeport', state: 'CT' },

  // 250 Eagles Nest Road, Bridgeport, CT
  { name: 'CALL DISPATCH- BRIDGEPORT', lines: ['Call Dispatch', 'Bridgeport'], city: 'Bridgeport', state: 'CT' },

  // 100 Waterfront St., New Haven, CT
  { name: 'CALL DISPATCH- NEW HAVEN', lines: ['Call Dispatch', 'New Haven'], city: 'New Haven', state: 'CT' },

  // 134 Forbes Avenue, New Haven, CT
  { name: 'MAGELLAN FORBES', lines: ['Buckeye', 'Forbes', 'New Haven'], city: 'New Haven', state: 'CT' },

  // 280 Waterfront Street, New Haven, CT
  { name: 'MAGELLAN NEW HAVEN', lines: ['Buckeye', 'Waterfront', 'New Haven'], city: 'New Haven', state: 'CT' },

  // 500 Waterfront Street, New Haven, CT
  { name: 'GLOBAL NEW HAVEN', lines: ['Global', 'New Haven'], city: 'New Haven', state: 'CT' },

  // 481 East Shore Parkway, New Haven, CT
  { name: 'MOTIVA NEW HAVEN', lines: ['Shell/Motiva', 'New Haven'], city: 'New Haven', state: 'CT' },

  // 109 Dividend Road, Rocky Hill, CT
  { name: 'CITGO ROCKY HILL', lines: ['CITGO', 'Rocky Hill'], city: 'Rocky Hill', state: 'CT' },
];

// Strips whitespace entirely rather than just collapsing it, so a name OCR'd with a
// dropped space (e.g. PP-StructureV3 reading "MOTIVA NEW HAVEN" as "MOTIVANEW HAVEN",
// or "MAGELLAN NEW HAVEN" as "MAGELLANNEWHAVEN") still matches its fragment below.
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function findTerminalEntry(name) {
  const normalized = normalizeText(name);
  return TERMINALS.find((t) => {
    const fragments = Array.isArray(t.name) ? t.name : [t.name];
    return fragments.some((fragment) => normalized.includes(normalizeText(fragment)));
  }) || null;
}

function findTerminal(name) {
  const entry = findTerminalEntry(name);
  return entry ? entry.lines : null;
}

// City/state for a matched terminal, straight from the curated table above -- not
// parsed from the OCR'd address text. A terminal's location is fixed and already known
// here, so there's nothing for an address-text parse to get right that this doesn't
// already have, and nothing for a per-photo OCR misread (e.g. a garbled state code) to
// break.
function findTerminalCityState(name) {
  const entry = findTerminalEntry(name);
  return entry ? { city: entry.city, state: entry.state } : null;
}
