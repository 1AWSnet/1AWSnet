function roundToNearest5(n) {
  return Math.round(n / 5) * 5;
}

function render() {
  const hourlyRate = parseFloat(document.getElementById('hourlyRate').value) || 0;
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';

  for (let miles = 5; miles <= 150; miles += 5) {
    const roundTripMiles = miles * 2;
    const average50MPH = roundTripMiles / 50;
    const fullTripTime = average50MPH + 1;
    const decimalRate = fullTripTime * hourlyRate;
    const roundedRate = roundToNearest5(decimalRate);
    const cpm = roundedRate / roundTripMiles;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${miles}</td>
      <td>$${decimalRate.toFixed(2)}</td>
      <td>$${roundedRate}</td>
      <td>$${cpm.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  }

  const tableEl = document.querySelector('table');
  document.getElementById('disclaimer').style.width = tableEl.offsetWidth + 'px';
}

render();
