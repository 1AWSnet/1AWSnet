// Big up/down buttons next to the Hourly Rate box: step by $1, never below 0.
function stepRate(dir) {
  const input = document.getElementById('hourlyRate');
  const current = parseFloat(input.value) || 0;
  const next = Math.max(0, current + dir);
  input.value = Number.isInteger(next) ? next : next.toFixed(2);
  render();
}

function render() {
  const hourlyRate = parseFloat(document.getElementById('hourlyRate').value) || 0;
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';

  for (let miles = MIN_MILES; miles <= MAX_MILES; miles += 5) {
    const roundTripMiles = miles * 2;
    const rate = roundedRate(miles, hourlyRate);
    const cpm = rate / roundTripMiles;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${miles}</td>
      <td>$${rate}</td>
      <td>$${cpm.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  }

  const tableEl = document.querySelector('table');
  const disclaimer = document.getElementById('disclaimer');
  disclaimer.style.width = tableEl.offsetWidth + 'px';
  disclaimer.style.marginInline = 'auto';
}

render();
