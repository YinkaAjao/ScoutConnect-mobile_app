// config/supabase.js
// Pinned (never taken from a token) so a forged `iss` can't point verification at an attacker's keys.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xekggzfumxbqvoyirndd.supabase.co';

module.exports = { SUPABASE_URL };
