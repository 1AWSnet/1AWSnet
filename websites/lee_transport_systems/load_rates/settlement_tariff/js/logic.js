// "All States" view: every CT (232) row plus every Maine-Mass-NH-RI (237) row.
const ALL_STATES_TARIFF = {
  rows: [...CT_TARIFF.rows, ...NE_TARIFF.rows],
};

const TARIFFS = [CT_TARIFF, NE_TARIFF, ALL_STATES_TARIFF];
const TARIFF_LABELS = ['CT & NJ', 'MA, ME, RI & NH', 'All States'];
let activeTariff = 2;
let sortCol = 1;
let sortAsc = true;

function switchTariff(i) {
  activeTariff = i;
  sortCol = 1;
  sortAsc = true;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.tariff) === i));
  render();
}

function toggleOldRate() {
  const on = document.getElementById('showOldRate').checked;
  if (!on && sortCol === 2) {
    sortCol = 1;
    sortAsc = true;
  }
  render();
}

function sortBy(col) {
  if (sortCol === col) {
    sortAsc = !sortAsc;
  } else {
    sortCol = col;
    sortAsc = true;
  }
  render();
}

function render() {
  const tariff = TARIFFS[activeTariff];
  const showOld = document.getElementById('showOldRate').checked;
  const originFilter = document.getElementById('originFilter').value.trim().toLowerCase();
  const destFilter = document.getElementById('destFilter').value.trim().toLowerCase();
  // East Haven origin rows duplicate the New Haven ones in the source tables;
  // the toggle (on by default) drops loads originating from East Haven. Rows
  // with East Haven as the destination are left alone.
  const hideEastHaven = document.getElementById('hideEastHaven').checked;

  document.querySelector('th[data-col="2"]').style.display = showOld ? '' : 'none';

  let rows = tariff.rows.filter(r =>
    r[0].toLowerCase().includes(originFilter) &&
    r[1].toLowerCase().includes(destFilter) &&
    (!hideEastHaven || !r[0].toLowerCase().includes('east haven'))
  );

  rows = rows.slice().sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol];
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv));
    }
    return sortAsc ? cmp : -cmp;
  });

  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  for (const r of rows) {
    const [origin, dest, oldRate, newRate] = r;
    // Origin shows the city only (drop ", ST") to keep that column narrow;
    // filtering and sorting still run against the full value.
    const originCity = origin.split(',')[0];
    const tr = document.createElement('tr');
    const oldCell = showOld ? `<td>$${oldRate.toFixed(2)}</td>` : '';
    tr.innerHTML = `
      <td>${originCity}</td>
      <td>${dest}</td>
      ${oldCell}
      <td>$${newRate.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById('rowCount').textContent =
    `${rows.length} of ${tariff.rows.length} rows from ${TARIFF_LABELS[activeTariff]}.`;
}

document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => sortBy(parseInt(th.dataset.col, 10)));
});

render();
