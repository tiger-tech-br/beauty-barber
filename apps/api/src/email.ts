import { settings } from './config.js';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function mailConfigured() { return Boolean(settings.resendApiKey && settings.resendFrom); }

export async function sendTransactionalEmail(input: {
  to: string; subject: string; html: string; idempotencyKey: string;
}) {
  if (!settings.resendApiKey || !settings.resendFrom) throw new Error('RESEND_NOT_CONFIGURED');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey
    },
    body: JSON.stringify({ from: settings.resendFrom, to: [input.to], subject: input.subject, html: input.html }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`RESEND_SEND_FAILED_${response.status}`);
}
