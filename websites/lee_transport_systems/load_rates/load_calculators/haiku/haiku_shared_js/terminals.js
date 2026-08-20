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
const TERMINALS = [
  // { address: '100 Waterfront St., New Haven, CT', lines: ['Call Dispatch', 'New Haven'] },
  // { address: '109 DIVIDEND ROAD, Rocky Hill, CT', lines: ['CITGO', 'Rocky Hill'] },
  // { address: '250 Eagles Nest Road, Bridgeport, CT', lines: ['Sprague', 'Bridgeport'] },
  // { address: '481 East Shore Parkway, New Haven, CT', lines: ['Shell/Motiva', 'New Haven'] },
  // { address: '500 Waterfront Street, New Haven, CT', lines: ['Global', 'New Haven'] },
  // { address: '280 Waterfront Street, New Haven, CT', lines: ['Buckeye', 'Waterfront', 'New Haven'] },
  // { address: '134 Forbes Avenue, New Haven, CT', lines: ['Buckeye', 'Forbes', 'New Haven'] },
  { address: '100 Waterfront', lines: ['Call Dispatch', 'New Haven'] },
  { address: 'DIVIDEND', lines: ['CITGO', 'Rocky Hill'] },
  { address: 'Eagles', lines: ['Sprague', 'Bridgeport'] },
  { address: 'Shore', lines: ['Shell/Motiva', 'New Haven'] },
  { address: '500 Waterfront', lines: ['Global', 'New Haven'] },
  { address: '280 Waterfront', lines: ['Buckeye', 'Waterfront', 'New Haven'] },
  { address: 'Forbes', lines: ['Buckeye', 'Forbes', 'New Haven'] },
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
  const match = TERMINALS.find((t) => normalized.includes(normalizeAddress(t.address)));
  return match ? match.lines : null;
}
