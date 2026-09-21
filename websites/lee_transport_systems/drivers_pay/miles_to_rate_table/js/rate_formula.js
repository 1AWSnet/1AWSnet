// The miles -> rate formula, shared by miles_to_rate_table and settlement_tariff.
// Change the formula here and both pages follow. No DOM access in this file.

const MIN_MILES = 5;
const MAX_MILES = 150;

function roundToNearest5(n) {
  return Math.round(n / 5) * 5;
}

// Hours for the round trip at the average speed for that distance,
// plus 1 hour (30 minutes to load, 30 minutes to unload).
function fullTripHours(miles) {
  const roundTripMiles = miles * 2;
  let mph;
  if (miles <= 15) {
    mph = 35;
  } else if (miles <= 20) {
    mph = 40;
  } else if (miles <= 40) {
    mph = 45;
  } else {
    mph = 50;
  }
  return roundTripMiles / mph + 1;
}

// What a trip of this many (table) miles pays at the given hourly rate.
function roundedRate(miles, hourlyRate) {
  return roundToNearest5(fullTripHours(miles) * hourlyRate);
}

// The reverse: the hourly rate a trip works out to when it pays `pay`.
function impliedHourlyRate(miles, pay) {
  return pay / fullTripHours(miles);
}
