// lib/membership.js
// How a signed-in account relates to its club. Rows created before club membership existed have no value set.
const membershipOf = (user) => user.membershipStatus || 'Active';
const clubRoleOf = (user) => user.clubRole || 'Owner';

module.exports = { membershipOf, clubRoleOf };
