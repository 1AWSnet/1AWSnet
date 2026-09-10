function roundToNearest5(n) {
  return Math.round(n / 5) * 5;
}

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

  for (let miles = 5; miles <= 150; miles += 5) {
    const roundTripMiles = miles * 2;
    const average35MPH = roundTripMiles / 35;
    const average40MPH = roundTripMiles / 40;
    const average45MPH = roundTripMiles / 45;
    const average50MPH = roundTripMiles / 50;
    let averageSpeedTime;
    if (miles <= 15) {
      averageSpeedTime = average35MPH;
    } else if (miles <= 20) {
      averageSpeedTime = average40MPH;
    } else if (miles <= 40) {
      averageSpeedTime = average45MPH;
    } else {
      averageSpeedTime = average50MPH;
    }
    const fullTripTime = averageSpeedTime + 1;
    const decimalRate = fullTripTime * hourlyRate;
    const roundedRate = roundToNearest5(decimalRate);
    const cpm = roundedRate / roundTripMiles;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${miles}</td>
      <td>$${roundedRate}</td>
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
