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
// when Haiku's OCR misreads a given terminal's printed name more than one way, so
// each known misread is its own array item instead of a separate TERMINALS entry.
const TERMINALS = [
  // 100 Waterfront St., New Haven, CT
  { name: 'CALL DISPATCH', lines: ['Call Dispatch', 'New Haven'] },

  // 134 Forbes Avenue, New Haven, CT
  { name: 'MAGELLAN FORBES', lines: ['Buckeye', 'Forbes', 'New Haven'] },

  // 280 Waterfront Street, New Haven, CT
  { name: 'MAGELLAN NEW HAVEN', lines: ['Buckeye', 'Waterfront', 'New Haven'] },

  // 500 Waterfront Street, New Haven, CT
  { name: 'GLOBAL NEW HAVEN', lines: ['Global', 'New Haven'] },

  // 481 East Shore Parkway, New Haven, CT
  { name: 'MOTIVA NEW HAVEN', lines: ['Shell/Motiva', 'New Haven'] },

  // 250 Eagles Nest Road, Bridgeport, CT
  { name: 'SPRAGUE BRIDGEPORT', lines: ['Sprague', 'Bridgeport'] },

  // 109 Dividend Road, Rocky Hill, CT
  { name: 'CITGO ROCKY HILL', lines: ['CITGO', 'Rocky Hill'] },
];

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTerminal(name) {
  const normalized = normalizeText(name);
  const match = TERMINALS.find((t) => {
    const fragments = Array.isArray(t.name) ? t.name : [t.name];
    return fragments.some((fragment) => normalized.includes(normalizeText(fragment)));
  });
  return match ? match.lines : null;
}
