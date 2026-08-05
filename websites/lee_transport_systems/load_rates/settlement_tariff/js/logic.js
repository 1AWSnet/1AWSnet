const TARIFFS = [CT_TARIFF, NE_TARIFF];
let activeTariff = 0;
let sortCol = 1;
let sortAsc = true;

function switchTariff(i) {
  activeTariff = i;
  sortCol = 1;
  sortAsc = true;
  document.querySelectorAll('.tab-btn').forEach((btn, idx) => btn.classList.toggle('active', idx === i));
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
  const originFilter = document.getElementById('originFilter').value.trim().toLowerCase();
  const destFilter = document.getElementById('destFilter').value.trim().toLowerCase();

  document.getElementById('tariffTitle').textContent = `Tariff No ${tariff.number} — ${tariff.name}`;
  document.getElementById('tariffMeta').textContent =
    `Effective ${tariff.effective} – ${tariff.expiration} | Rates as of ${tariff.asOf} | New rates per Tariff #${tariff.newRatesTariff} as of ${tariff.newRatesAsOf}`;

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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${origin}</td>
      <td>${dest}</td>
      <td>$${oldRate.toFixed(2)}</td>
      <td>$${newRate.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById('rowCount').textContent = `${rows.length} of ${tariff.rows.length} rows`;
}

document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => sortBy(parseInt(th.dataset.col, 10)));
});

render();
