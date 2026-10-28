// lib/notify.js

/**
 * Email sender backed by the Resend HTTP API (no extra dependency).
 * `send()` never throws: a mail outage or missing configuration must never fail the request that triggered it.
 * It resolves to { sent: true } | { skipped: reason } | { failed: true }.
 */
function createNotifier({ apiKey, from, fetchImpl = fetch, timeoutMs = 4000, logger = console }) {
  const enabled = Boolean(apiKey && from);

  return {
    enabled,
    async send({ to, subject, text }) {
      const recipients = [].concat(to ?? []).filter(Boolean);
      if (recipients.length === 0) return { skipped: 'no recipients' };
      if (!enabled) return { skipped: 'not configured' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: recipients, subject, text }),
          signal: controller.signal
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          logger.error(`Email not sent (Resend ${response.status}): ${detail.slice(0, 200)}`);
          return { failed: true, status: response.status };
        }
        return { sent: true };
      } catch (error) {
        logger.error(`Email not sent: ${error.name === 'AbortError' ? 'timed out' : error.message}`);
        return { failed: true };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

module.exports = { createNotifier };
