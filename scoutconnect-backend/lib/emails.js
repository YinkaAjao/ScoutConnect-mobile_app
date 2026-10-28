// lib/emails.js
// Plain-text templates only (no HTML), so user-entered text such as a club name can never inject markup.

/** Header-safe single line. */
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Sent to the administrators when an owner submits a verification request. */
function newRequestEmail({ club, owner, documentCount, athleteCount }) {
  const name = oneLine(club.name);
  return {
    subject: `New verification request: ${name}`,
    text: [
      `${name} has asked to be verified.`,
      '',
      `Classification: ${oneLine(club.entityType) || 'Not set'}`,
      `Region: ${oneLine(club.region) || 'Not set'}`,
      `Athletes on roster: ${athleteCount}`,
      `Documents attached: ${documentCount}`,
      `Submitted by: ${oneLine(owner.username) || 'Unknown'} (${oneLine(owner.email) || 'no email'})`,
      '',
      'Open ScoutConnect and go to Verification Review to look at the documents and decide.'
    ].join('\n')
  };
}

/** Sent to the club owner(s) when an administrator decides on their club. */
function decisionEmail({ club, decision, reason }) {
  const name = oneLine(club.name);
  const why = oneLine(reason);

  if (decision === 'approve') {
    return {
      subject: `${name} is now verified`,
      text: [
        `Good news: ${name} has been reviewed and verified.`,
        '',
        'Scouts will now see the Verified badge next to your club.',
        'Note: changing the club name or classification removes the badge until it is reviewed again.'
      ].join('\n')
    };
  }

  if (decision === 'reject') {
    return {
      subject: `Verification update for ${name}: more information needed`,
      text: [
        `Your verification request for ${name} was not approved.`,
        '',
        `Reason: ${why || 'No reason was given.'}`,
        '',
        'You can fix the issue and send a new request from the Club tab in ScoutConnect.'
      ].join('\n')
    };
  }

  return {
    subject: `Verification removed for ${name}`,
    text: [
      `The verified status of ${name} has been removed by an administrator.`,
      '',
      `Reason: ${why || 'No reason was given.'}`,
      '',
      'You can request verification again from the Club tab in ScoutConnect.'
    ].join('\n')
  };
}

/** Sent to the administrators when a scout applies for accreditation. */
function scoutRequestEmail({ scout, profile, documentCount }) {
  const name = oneLine(scout.username) || 'A scout';
  return {
    subject: `New scout accreditation request: ${name}`,
    text: [
      `${name} has applied to be accredited as a scout.`,
      '',
      `Organisation: ${oneLine(profile.organisation)}`,
      `Type: ${oneLine(profile.orgType)}`,
      `Licence / registration number: ${oneLine(profile.licenceNumber) || 'Not given'}`,
      `Documents attached: ${documentCount}`,
      `Email: ${oneLine(scout.email) || 'Unknown'}`,
      '',
      'Open ScoutConnect and go to Verification Review > Scouts to look at the documents and decide.'
    ].join('\n')
  };
}

/** Sent to a scout when an administrator decides on their accreditation. */
function scoutDecisionEmail({ decision, reason }) {
  const why = oneLine(reason);

  if (decision === 'approve' || decision === 'reinstate') {
    return {
      subject: decision === 'approve' ? 'Your scout accreditation is approved' : 'Your scout access has been restored',
      text: [
        decision === 'approve' ? 'Your accreditation has been approved.' : 'An administrator has restored your scout access.',
        '',
        'You can now browse athletes and ask clubs for contact details from the Discover tab in ScoutConnect.'
      ].join('\n')
    };
  }

  if (decision === 'reject') {
    return {
      subject: 'Your scout accreditation needs more information',
      text: [
        'Your accreditation request was not approved.',
        '',
        `Reason: ${why || 'No reason was given.'}`,
        '',
        'You can fix the issue and apply again from the Discover tab in ScoutConnect.'
      ].join('\n')
    };
  }

  return {
    subject: 'Your scout access has been suspended',
    text: ['An administrator has suspended your scout access.', '', `Reason: ${why || 'No reason was given.'}`].join('\n')
  };
}

/** Sent to a club's owner(s) when a scout asks for contact about one of their athletes. */
function contactRequestEmail({ club, athleteName, scout, organisation, message }) {
  return {
    subject: `A scout wants to contact you about ${oneLine(athleteName)}`,
    text: [
      `${oneLine(scout.username)} (${oneLine(organisation) || 'independent'}) asked to contact ${oneLine(club.name)} about ${oneLine(athleteName)}.`,
      '',
      'Their message:',
      String(message || '').trim(),
      '',
      'Open ScoutConnect and go to the Club tab > Scout requests to accept or decline. Nothing about the athlete or your club is shared until you accept.'
    ].join('\n')
  };
}

/** Sent to a scout when a club answers their contact request. */
function contactResponseEmail({ decision, athleteName, clubName, note }) {
  const accepted = decision === 'accept';
  const club = oneLine(clubName);
  const athlete = oneLine(athleteName);
  const extra = oneLine(note);

  return {
    subject: accepted ? `${club} accepted your contact request` : `${club} declined your contact request`,
    text: [
      accepted
        ? `${club} accepted your request about ${athlete}. The athlete's full name and the club's contact details are now visible in the Requests tab.`
        : `${club} declined your request about ${athlete}.`,
      ...(extra ? ['', `Note from the club: ${extra}`] : [])
    ].join('\n')
  };
}

/** Sent to the administrators when someone reports an athlete's profile. Safeguarding concerns are marked urgent. */
function reportEmail({ athleteName, clubName, category, details, reporter }) {
  const urgent = category === 'Safeguarding concern';
  return {
    subject: `${urgent ? 'URGENT: ' : ''}Report: ${oneLine(category)} (${oneLine(athleteName)})`,
    text: [
      `${oneLine(reporter?.username) || 'Someone'} (${oneLine(reporter?.role) || 'user'}) reported ${oneLine(athleteName)}${clubName ? ` of ${oneLine(clubName)}` : ''}.`,
      '',
      `Category: ${oneLine(category)}`,
      `Details: ${oneLine(details)}`,
      '',
      urgent
        ? 'This is a safeguarding concern. Please review it now: open ScoutConnect > Review > Reports, and hide the athlete from scouts if needed.'
        : 'Open ScoutConnect and go to Review > Reports to look into it.'
    ].join('\n')
  };
}

/** Sent to the person who made a report, once an administrator has dealt with it. */
function reportOutcomeEmail({ decision }) {
  return {
    subject: 'Your report has been reviewed',
    text: [
      'Thank you for your report. An administrator has reviewed it.',
      decision === 'resolve' ? 'Action was taken.' : 'No action was needed.',
      '',
      'For privacy, we cannot share further details.'
    ].join('\n')
  };
}

module.exports = { newRequestEmail, decisionEmail, scoutRequestEmail, scoutDecisionEmail, contactRequestEmail, contactResponseEmail, reportEmail, reportOutcomeEmail };
