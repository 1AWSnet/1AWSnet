// Curated display names for known pickup (LLD) terminals, keyed by the address
// printed under the LLD row. The printed terminal name is not always what drivers
// actually call the place (ownership changes, e.g. Magellan -> Buckeye), so this
// maps the address -- which doesn't change when a facility is sold/renamed -- to
// the short label drivers recognize. Addresses not listed here just fall back to
// showing the raw OCR'd name + address. Add more entries here as they're learned.
const TERMINALS = [
  { address: '100 Waterfront St., New Haven, CT', lines: ['Call Dispatch', 'New Haven'] },
  { address: '109 DIVIDEND ROAD, Rocky Hill, CT', lines: ['CITGO', 'Rocky Hill', 'Rocky Hill'] },
  { address: '250 Eagles Nest Road, Bridgeport, CT', lines: ['Sprague', 'Bridgeport'] },
  { address: '481 East Shore Parkway, New Haven, CT', lines: ['Shell/Motiva', 'New Haven'] },
  { address: '500 Waterfront Street, New Haven, CT', lines: ['Global', 'New Haven'] },
  { address: '280 Waterfront Street, New Haven, CT', lines: ['Buckeye', 'Waterfront', 'New Haven'] },
];

function normalizeAddress(address) {
  return address
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TERMINALS_BY_ADDRESS = new Map(
  TERMINALS.map((t) => [normalizeAddress(t.address), t.lines])
);

function findTerminal(address) {
  return TERMINALS_BY_ADDRESS.get(normalizeAddress(address)) || null;
}
