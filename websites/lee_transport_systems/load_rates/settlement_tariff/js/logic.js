// "All States" view: every CT (232) row plus every Maine-Mass-NH-RI (237) row.
const ALL_STATES_TARIFF = {
  rows: [...CT_TARIFF.rows, ...NE_TARIFF.rows],
};

const TARIFFS = [CT_TARIFF, NE_TARIFF, ALL_STATES_TARIFF];
const TARIFF_LABELS = ['CT', 'MA', 'All States'];
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

// "Menu" disclosure: folds the site header, table switcher and Old Rates
// toggle away so the table has the screen. Collapsed by default.
function toggleChrome() {
  const panel = document.getElementById('chromePanel');
  const btn = document.getElementById('chromeToggle');
  const opening = panel.hidden;
  panel.hidden = !opening;
  btn.setAttribute('aria-expanded', String(opening));
  btn.querySelectorAll('.chev').forEach(c => { c.textContent = opening ? '▴' : '▾'; });
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

  document.querySelector('th[data-col="2"]').style.display = showOld ? '' : 'none';

  let rows = tariff.rows.filter(r =>
    r[0].toLowerCase().includes(originFilter) &&
    r[1].toLowerCase().includes(destFilter)
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
