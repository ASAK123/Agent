// Google Calendar event colorId reference (the only 11 colors selectable per-event):
// 1 Lavender, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana,
// 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato
//
// Radicchio and Amethyst (requested for S.N.C / Weapons) are only available as
// *calendar* colors, not per-event colors - substituted with the closest event
// colors available: Flamingo (soft red) and Grape (purple).

const DIVISIONS = [
  { hebrew: 'סונאר', english: 'Sonar', colorId: '5', colorName: 'Banana (yellow)' },
  { hebrew: 'גנ"ק', english: 'S.N.C', colorId: '4', colorName: 'Flamingo (substitute for Radicchio)' },
  { hebrew: 'נשק', english: 'Weapons', colorId: '3', colorName: 'Grape (substitute for Amethyst)' },
  { hebrew: 'טכנית', english: 'Technical', colorId: '8', colorName: 'Graphite' },
  { hebrew: 'סגן', english: 'XO', colorId: '10', colorName: 'Basil' },
  { hebrew: 'מפקד', english: 'Captain', colorId: '11', colorName: 'Tomato' },
  { hebrew: 'צוות', english: 'All', colorId: '6', colorName: 'Tangerine' },
];

const DEFAULT_DIVISION = DIVISIONS.find((d) => d.english === 'All');

// Hebrew display names, used as the tool-schema enum and shown to Claude.
const DIVISION_NAMES = DIVISIONS.map((d) => d.hebrew);

function findDivision(division) {
  if (!division) return undefined;
  const needle = String(division).trim().toLowerCase();
  return DIVISIONS.find((d) => d.hebrew === division.trim() || d.english.toLowerCase() === needle);
}

function colorIdForDivision(division) {
  const match = findDivision(division) || DEFAULT_DIVISION;
  return match.colorId;
}

function divisionForColorId(colorId) {
  if (!colorId) return undefined;
  const match = DIVISIONS.find((d) => d.colorId === String(colorId));
  return match ? match.hebrew : undefined;
}

module.exports = { DIVISIONS, DIVISION_NAMES, colorIdForDivision, divisionForColorId };
