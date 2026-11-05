import type { Hono } from 'hono';
import { html } from '../../lib/html.ts';
import { oneOf } from '../../lib/validate.ts';
import { createApiKey, listApiKeys, revokeApiKey } from '../../services/api-keys.ts';
import type { ApiKeyType, Ctx } from '../../types.ts';
import type { WebContext, WebEnv } from '../session.ts';
import { badge, copyField, timeTag } from '../ui.ts';
import { actor, base, form, formAction, render } from './common.ts';
import { ApiError } from '../../lib/errors.ts';
import { setFlash } from '../session.ts';

export function mountKeys(app: Hono<WebEnv>, ctx: Ctx): void {
  const P = '/app/p/:projectId/api-keys';

  const page = (c: WebContext, created?: { token: string; name: string }) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const keys = listApiKeys(ctx, project.id);
    const table = (type: ApiKeyType) => {
      const rows = keys.filter((k) => k.type === type);
      if (rows.length === 0) return html`<div class="card-body muted small">No ${type} keys yet.</div>`;
      return html`<div class="table-wrap" style="border:0"><table class="table">
        <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows.map(
          (k) => html`<tr>
            <td><strong>${k.name}</strong>${k.revoked_at ? html` ${badge('revoked', 'red')}` : ''}</td>
            <td style="min-width:280px">${type === 'publishable' && k.token_plain && !k.revoked_at ? copyField(k.token_plain) : html`<span class="mono small">${k.token_prefix}</span>`}</td>
            <td class="small">${timeTag(k.created_at, now, 'date')}</td>
            <td class="small">${timeTag(k.last_used_at, now)}</td>
            <td class="right">${k.revoked_at
              ? ''
              : html`<form method="post" action="${b}/api-keys/${k.id}/revoke" class="inline-form" data-confirm="Revoke ${k.name}? Apps using it will stop working immediately."><button class="btn btn-danger btn-sm">Revoke</button></form>`}</td>
          </tr>`,
        )}</tbody></table></div>`;
    };
    return render(ctx, c, {
      active: 'keys',
      title: 'API keys',
      lead: 'Secret keys are for your server. Publishable keys can only validate and activate license keys, so they are safe to embed in desktop apps, CLIs and browsers.',
      content: html`
        ${created
          ? html`<div class="callout callout-success" style="margin-bottom:1.25rem">
              <p><strong>Your new secret key “${created.name}”.</strong> Copy it now. For your security, it will not be shown again.</p>
              ${copyField(created.token)}
              <p class="small" style="margin-top:.6rem">Store it as an environment variable, e.g. <code>KEYVANE_SECRET_KEY</code>. Never commit it or ship it in client code.</p>
            </div>`
          : ''}
        <div class="card card-flush" style="margin-bottom:1.25rem"><div class="card-header"><h2>Secret keys</h2>${badge('server-side only', 'red', { dot: false })}</div>${table('secret')}</div>
        <div class="card card-flush" style="margin-bottom:1.25rem"><div class="card-header"><h2>Publishable keys</h2>${badge('safe to embed', 'green', { dot: false })}</div>${table('publishable')}</div>
        <div class="card" style="max-width:640px"><div class="card-header"><h2>Create a key</h2></div><div class="card-body">
          <form method="post" action="${b}/api-keys" class="form">
            <div class="form-row">
              <div class="field"><label>Name</label><input aria-label="Name" name="name" maxlength="60" placeholder="Production server" required></div>
              <div class="field"><label>Type</label><select aria-label="Type" name="type"><option value="secret">Secret (server)</option><option value="publishable">Publishable (apps)</option></select></div>
            </div>
            <div class="form-actions"><button class="btn btn-primary">Create key</button></div>
          </form>
        </div></div>`,
    });
  };

  app.get(P, (c) => page(c));

  app.post(P, async (c) => {
    const body = await form(c);
    try {
      const type = oneOf<ApiKeyType>(body.type, 'type', ['secret', 'publishable'], { required: true }) as ApiKeyType;
      const { apiKey, token } = createApiKey(ctx, c.get('project').id, { type, name: body.name }, actor(c));
      if (type === 'secret') return page(c, { token, name: apiKey.name });
      await setFlash(ctx, c, 'success', 'Publishable key created.');
      return c.redirect(`${base(c)}/api-keys`, 303);
    } catch (err) {
      if (err instanceof ApiError) {
        await setFlash(ctx, c, 'error', err.message);
        return c.redirect(`${base(c)}/api-keys`, 303);
      }
      throw err;
    }
  });

  app.post(`${P}/:keyId/revoke`, async (c) => {
    return formAction(ctx, c, () => revokeApiKey(ctx, c.get('project').id, c.req.param('keyId'), actor(c)), {
      success: 'API key revoked.',
      redirect: `${base(c)}/api-keys`,
    });
  });
}
