import type { Context, Hono } from 'hono';
import { ApiError } from '../lib/errors.ts';
import { html } from '../lib/html.ts';
import { RateLimiter } from '../lib/rate-limit.ts';
import { clientIp } from '../lib/request.ts';
import { sendMail } from '../services/mailer.ts';
import { authenticate, checkPasswordResetToken, createPasswordReset, createUser, RESET_TOKEN_MINUTES, resetPasswordWithToken } from '../services/users.ts';
import type { Ctx } from '../types.ts';
import { authPage } from './layout.ts';
import { consumeFlash, endSession, safeNext, setFlash, startSession, type WebEnv } from './session.ts';

/** Count sign-ups as a Plausible goal without cookies or client-side scripts. */
function trackSignup(ctx: Ctx, c: Context): void {
  const domain = ctx.config.analytics.plausibleDomain;
  if (!domain || ctx.config.env === 'test') return;
  void fetch('https://plausible.io/api/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': c.req.header('user-agent') ?? 'unknown',
      'X-Forwarded-For': clientIp(c, ctx.config),
    },
    body: JSON.stringify({ name: 'Signup', url: `${ctx.config.publicUrl}/signup`, domain }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

export function mountAuth(app: Hono<WebEnv>, ctx: Ctx): void {
  const limiter = new RateLimiter(ctx.config.rateLimits.auth, 15 * 60_000, () => ctx.now().getTime());

  const limited = (c: Context) => !limiter.hit(`auth:${clientIp(c, ctx.config)}`).allowed;

  app.get('/login', async (c) => {
    if (c.get('user')) return c.redirect(safeNext(c.req.query('next')), 303);
    const next = safeNext(c.req.query('next'), '');
    const flash = await consumeFlash(ctx, c);
    return c.html(
      authPage(ctx, {
        title: 'Log in',
        heading: 'Welcome back',
        subheading: 'Log in to manage your products, plans and licenses.',
        flash,
        content: html`<form method="post" action="/login" class="form">
          ${next ? html`<input type="hidden" name="next" value="${next}">` : ''}
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required autofocus></div>
          <div class="field"><div class="row-between"><label for="password">Password</label><a class="small" href="/forgot-password">Forgot password?</a></div><input id="password" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn btn-primary btn-block" type="submit">Log in</button>
        </form>`,
        foot: ctx.config.signupsEnabled ? html`New to Keyvane? <a href="/signup">Create an account</a>` : '',
      }).toString(),
    );
  });

  app.post('/login', async (c) => {
    const form = await c.req.parseBody();
    const next = safeNext(typeof form.next === 'string' ? form.next : undefined);
    if (limited(c)) {
      await setFlash(ctx, c, 'error', 'Too many attempts. Please wait a few minutes and try again.');
      return c.redirect('/login', 303);
    }
    const user = await authenticate(ctx, String(form.email ?? ''), String(form.password ?? ''));
    if (!user) {
      await setFlash(ctx, c, 'error', 'Incorrect email or password.');
      return c.redirect(`/login${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`, 303);
    }
    startSession(ctx, c, user);
    return c.redirect(next, 303);
  });

  app.get('/signup', async (c) => {
    if (c.get('user')) return c.redirect('/app', 303);
    if (!ctx.config.signupsEnabled) return c.redirect('/login', 303);
    const flash = await consumeFlash(ctx, c);
    return c.html(
      authPage(ctx, {
        title: 'Create your account',
        heading: 'Create your account',
        subheading: 'Free during the public beta. No credit card required.',
        flash,
        content: html`<form method="post" action="/signup" class="form">
          <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
          <div class="field"><label for="name">Name <span class="optional">(optional)</span></label><input id="name" name="name" type="text" autocomplete="name" maxlength="100"></div>
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
          <button class="btn btn-primary btn-block" type="submit">Create account</button>
        </form>`,
        foot: html`Already have an account? <a href="/login">Log in</a>`,
      }).toString(),
    );
  });

  app.post('/signup', async (c) => {
    if (!ctx.config.signupsEnabled) return c.redirect('/login', 303);
    if (limited(c)) {
      await setFlash(ctx, c, 'error', 'Too many attempts. Please wait a few minutes and try again.');
      return c.redirect('/signup', 303);
    }
    const form = await c.req.parseBody();
    if (typeof form.website === 'string' && form.website.trim() !== '') {
      // Honeypot field filled in: almost certainly a bot. Do not create an account.
      await setFlash(ctx, c, 'info', 'Thanks! Check your details and try again.');
      return c.redirect('/signup', 303);
    }
    try {
      const user = await createUser(ctx, { email: form.email, password: form.password, name: form.name });
      startSession(ctx, c, user);
      trackSignup(ctx, c);
      return c.redirect('/app/projects/new?welcome=1', 303);
    } catch (err) {
      if (err instanceof ApiError) {
        await setFlash(ctx, c, 'error', err.message);
        return c.redirect('/signup', 303);
      }
      throw err;
    }
  });

  app.get('/forgot-password', async (c) => {
    const flash = await consumeFlash(ctx, c);
    return c.html(
      authPage(ctx, {
        title: 'Reset your password',
        heading: 'Reset your password',
        subheading: 'Enter your account email and we will send you a link to choose a new password.',
        flash,
        content: html`<form method="post" action="/forgot-password" class="form">
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required autofocus></div>
          <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
        </form>`,
        foot: html`Remembered it? <a href="/login">Log in</a>`,
      }).toString(),
    );
  });

  app.post('/forgot-password', async (c) => {
    if (limited(c)) {
      await setFlash(ctx, c, 'error', 'Too many attempts. Please wait a few minutes and try again.');
      return c.redirect('/forgot-password', 303);
    }
    const form = await c.req.parseBody();
    const email = String(form.email ?? '').trim();
    const reset = email ? createPasswordReset(ctx, email) : null;
    if (reset) {
      const link = `${ctx.config.publicUrl}/reset-password?token=${reset.token}`;
      await sendMail(ctx, {
        to: reset.user.email,
        subject: 'Reset your Keyvane password',
        text: `Someone asked to reset the password for your Keyvane account (${reset.user.email}).\n\nChoose a new password here (the link works once and expires in ${RESET_TOKEN_MINUTES} minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email. Your password stays the same.\n`,
      });
    }
    // Same answer whether or not the account exists.
    await setFlash(ctx, c, 'success', `If an account exists for ${email || 'that address'}, a reset link is on its way. It expires in ${RESET_TOKEN_MINUTES} minutes.`);
    return c.redirect('/login', 303);
  });

  app.get('/reset-password', async (c) => {
    const token = c.req.query('token') ?? '';
    const flash = await consumeFlash(ctx, c);
    const valid = !!checkPasswordResetToken(ctx, token);
    return c.html(
      authPage(ctx, {
        title: 'Choose a new password',
        heading: valid ? 'Choose a new password' : 'This link has expired',
        subheading: valid ? 'You will be signed out everywhere else.' : 'Reset links work once and expire after an hour.',
        flash,
        content: valid
          ? html`<form method="post" action="/reset-password" class="form">
              <input type="hidden" name="token" value="${token}">
              <div class="field"><label for="password">New password</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required autofocus><span class="hint">At least 8 characters.</span></div>
              <button class="btn btn-primary btn-block" type="submit">Save password</button>
            </form>`
          : html`<a class="btn btn-primary btn-block" href="/forgot-password">Send a new link</a>`,
      }).toString(),
    );
  });

  app.post('/reset-password', async (c) => {
    const form = await c.req.parseBody();
    const token = String(form.token ?? '');
    try {
      const user = await resetPasswordWithToken(ctx, token, form.password);
      startSession(ctx, c, user);
      await setFlash(ctx, c, 'success', 'Your password was changed.');
      return c.redirect('/app', 303);
    } catch (err) {
      if (err instanceof ApiError) {
        await setFlash(ctx, c, 'error', err.message);
        return c.redirect(`/reset-password?token=${encodeURIComponent(token)}`, 303);
      }
      throw err;
    }
  });

  app.post('/logout', (c) => {
    endSession(ctx, c);
    return c.redirect('/', 303);
  });
}
