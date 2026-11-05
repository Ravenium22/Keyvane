import type { Ctx } from '../types.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Emails "sent" while NODE_ENV=test, for assertions. */
export const testOutbox: Mail[] = [];

/**
 * Sends transactional email through Resend when RESEND_API_KEY is set. Otherwise the
 * message is written to the server log, which is enough for local development and for
 * self-hosters who read their logs.
 */
export async function sendMail(ctx: Ctx, mail: Mail): Promise<{ delivered: boolean; via: 'resend' | 'log' | 'test' }> {
  if (ctx.config.env === 'test') {
    testOutbox.push(mail);
    return { delivered: true, via: 'test' };
  }
  const key = ctx.config.mail.resendApiKey;
  if (!key) {
    console.log(`[keyvane] email to ${mail.to} (set RESEND_API_KEY to deliver it)\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return { delivered: false, via: 'log' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ctx.config.mail.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[keyvane] email delivery failed (${res.status}): ${await res.text()}`);
      return { delivered: false, via: 'resend' };
    }
    return { delivered: true, via: 'resend' };
  } catch (err) {
    console.error('[keyvane] email delivery failed:', err);
    return { delivered: false, via: 'resend' };
  }
}
