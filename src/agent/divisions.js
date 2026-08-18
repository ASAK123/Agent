// Google Calendar event colorId reference:
// 1 Lavender, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana,
// 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato

const DIVISIONS = {
  Sonar: { colorId: '7', colorName: 'Peacock (blue)' },
  'S.N.C': { colorId: '6', colorName: 'Tangerine (orange)' },
  Weapon: { colorId: '11', colorName: 'Tomato (red)' },
  Technical: { colorId: '10', colorName: 'Basil (dark green)' },
  XO: { colorId: '3', colorName: 'Grape (purple)' },
  Captain: { colorId: '5', colorName: 'Banana (yellow)' },
};

const DIVISION_NAMES = Object.keys(DIVISIONS);

function findDivision(division) {
  if (!division) return undefined;
  return DIVISION_NAMES.find((d) => d.toLowerCase() === String(division).trim().toLowerCase());
}

function colorIdForDivision(division) {
  const match = findDivision(division);
  return match ? DIVISIONS[match].colorId : undefined;
}

function divisionForColorId(colorId) {
  if (!colorId) return undefined;
  return DIVISION_NAMES.find((d) => DIVISIONS[d].colorId === String(colorId));
}

module.exports = { DIVISIONS, DIVISION_NAMES, colorIdForDivision, divisionForColorId };
