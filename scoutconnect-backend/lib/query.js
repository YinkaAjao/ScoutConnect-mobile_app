// lib/query.js
// Small helpers for building database queries from request input.
const { fn, col, where: sqlWhere } = require('sequelize');
const { normaliseName } = require('./profile');

/** Escapes % and _ so user input is matched literally inside a LIKE pattern. */
const escapeLike = (text) => String(text).replace(/[\\%_]/g, '\\$&');

/** Matches rows whose `name` equals the given name, ignoring case and surrounding whitespace. */
const byLowerName = (name) => sqlWhere(fn('lower', col('name')), normaliseName(name).toLowerCase());

/** Parses a comma-separated query value ("a,b,c") into a clean list. */
const csv = (value) => String(value || '').split(',').map(normaliseName).filter(Boolean);

/** A whole number within [min, max], or null. */
const toInt = (value, { min = 0, max = 1000000 } = {}) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

module.exports = { escapeLike, byLowerName, csv, toInt };
