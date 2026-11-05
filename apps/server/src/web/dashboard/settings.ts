import type { Hono } from 'hono';
import { badRequest } from '../../lib/errors.ts';
import { html } from '../../lib/html.ts';
import { deleteProject, renameProject } from '../../services/projects.ts';
import type { Ctx } from '../../types.ts';
import type { WebEnv } from '../session.ts';
import { copyField } from '../ui.ts';
import { actor, base, form, formAction, render } from './common.ts';

export function mountSettings(app: Hono<WebEnv>, ctx: Ctx): void {
  const P = '/app/p/:projectId/settings';

  app.get(P, (c) => {
    const project = c.get('project');
    const b = base(c);
    return render(ctx, c, {
      active: 'settings',
      title: 'Settings',
      lead: 'Project details. Team members and organizations are coming in the public beta.',
      content: html`<div class="stack-lg" style="max-width:720px">
        <div class="card"><div class="card-header"><h2>Project</h2></div><div class="card-body">
          <form method="post" action="${b}/settings" class="form">
            <div class="field"><label>Name</label><input aria-label="Name" name="name" required maxlength="80" value="${project.name}"></div>
            <div class="field"><span class="label">Project ID</span>${copyField(project.id)}</div>
            <div class="form-actions"><button class="btn btn-primary">Save</button></div>
          </form>
        </div></div>
        <div class="card danger-zone"><div class="card-header"><h2>Delete project</h2></div><div class="card-body">
          <p class="muted small">Permanently deletes the project with all of its products, customers, licenses, usage data, API keys and Stripe events. Apps using its keys stop working immediately.</p>
          ${project.role === 'owner'
            ? html`<form method="post" action="${b}/delete" class="form" data-confirm="Delete ${project.name} and all of its data? This cannot be undone.">
                <div class="field"><label>Type the project name to confirm</label><input aria-label="Type the project name to confirm" name="confirm" required autocomplete="off" placeholder="${project.name}"></div>
                <div class="form-actions"><button class="btn btn-danger">Delete project</button></div>
              </form>`
            : html`<p class="small">Only the project owner can delete it.</p>`}
        </div></div>
      </div>`,
    });
  });

  app.post(P, async (c) => {
    const body = await form(c);
    return formAction(ctx, c, () => renameProject(ctx, c.get('project').id, { name: body.name }, actor(c)), {
      success: 'Project saved.',
      redirect: `${base(c)}/settings`,
    });
  });

  app.post('/app/p/:projectId/delete', async (c) => {
    const body = await form(c);
    const project = c.get('project');
    return formAction(
      ctx,
      c,
      () => {
        if (project.role !== 'owner') throw badRequest('forbidden', 'Only the project owner can delete it.');
        if ((body.confirm ?? '').trim() !== project.name) throw badRequest('confirmation_mismatch', 'The name you typed does not match the project name.');
        deleteProject(ctx, project.id);
        return '/app';
      },
      { success: `Project “${project.name}” deleted.`, redirect: '/app', errorRedirect: `${base(c)}/settings` },
    );
  });
}
