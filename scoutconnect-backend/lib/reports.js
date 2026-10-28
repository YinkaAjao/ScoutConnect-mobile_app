// lib/reports.js
const { normaliseName } = require('./profile');

const REPORT_CATEGORIES = ['Inaccurate stats', 'Wrong identity', 'Inappropriate photo', 'Safeguarding concern', 'Other'];

/** Reports that must reach an administrator straight away. */
const URGENT_CATEGORIES = ['Safeguarding concern'];

/** Validates a report. Returns { error } or { category, details }. `reason` is accepted as an older name for `details`. */
function validateReport(body) {
  if (!REPORT_CATEGORIES.includes(body?.category)) return { error: 'Choose what kind of problem you are reporting.' };
  const details = normaliseName(body?.details ?? body?.reason);
  if (details.length < 5) return { error: 'Please describe the problem in a few words.' };
  return { category: body.category, details: details.slice(0, 255) };
}

module.exports = { REPORT_CATEGORIES, URGENT_CATEGORIES, validateReport };
