// Curated display names for known pickup (LLD) terminals, keyed by a distinctive
// fragment of the address printed under the LLD row (street name, or house number +
// street for the Waterfront entries where the street name alone is shared by several
// terminals). A fragment, not the full address, because exact-matching the whole
// OCR'd address string was missing real matches. The printed terminal name is not
// always what drivers actually call the place (ownership changes, e.g. Magellan ->
// Buckeye), so this maps the address -- which doesn't change when a facility is
// sold/renamed -- to the short label drivers recognize. Addresses not listed here
// just fall back to showing the raw OCR'd name + address. Add more entries here as
// they're learned; keep fragments distinctive enough not to collide.
//
// `address` can be a single fragment or an array of fragments -- add an array entry
// when Haiku's OCR misreads a given terminal's address more than one way (e.g. a
// digit it sometimes gets wrong), so each known misread is its own array item instead
// of a separate TERMINALS entry.
const TERMINALS = [
  // 100 Waterfront St., New Haven, CT
  { address: '100 Waterfront', lines: ['Call Dispatch', 'New Haven'] },

  // 134 FORBES AVENUE, New Haven, CT
  { address: 'Forbes Avenue', lines: ['Buckeye', 'Forbes', 'New Haven'] },

  // 280 WATERFRONT STREET, New Haven, CT
  { address: ['280 Waterfront', '200 Waterfront'], lines: ['Buckeye', 'Waterfront', 'New Haven'] },
  // 200 = OCR misread of 280

  // 500 WATERFRONT STREET, New Haven, CT
  { address: '500 Waterfront', lines: ['Global', 'New Haven'] },

  // 481 EAST SHORE PARKWAY, New Haven, CT
  { address: 'East Shore', lines: ['Shell/Motiva', 'New Haven'] },

  // 250 EAGLES NEST ROAD, Bridgeport, CT
  { address: 'Eagles Nest', lines: ['Sprague', 'Bridgeport'] },

  // 109 DIVIDEND ROAD, Rocky Hill, CT
  { address: 'Dividend Road', lines: ['CITGO', 'Rocky Hill'] },
];

function normalizeAddress(address) {
  return address
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTerminal(address) {
  const normalized = normalizeAddress(address);
  const match = TERMINALS.find((t) => {
    const fragments = Array.isArray(t.address) ? t.address : [t.address];
    return fragments.some((fragment) => normalized.includes(normalizeAddress(fragment)));
  });
  return match ? match.lines : null;
}
