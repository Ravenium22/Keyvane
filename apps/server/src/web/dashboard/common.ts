import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../../lib/errors.ts';
import { html, type HtmlChild } from '../../lib/html.ts';
import { getProjectForUser, listProjectsForUser } from '../../services/projects.ts';
import type { Actor, Ctx, UserRow } from '../../types.ts';
import { dashboardPage, type NavKey } from '../layout.ts';
import { consumeFlash, rememberProject, setFlash, userActor, type WebContext, type WebEnv } from '../session.ts';
import { emptyState } from '../ui.ts';

export function currentUser(c: WebContext): UserRow {
  const user = c.get('user');
  if (!user) throw new Error('requireUser middleware missing');
  return user;
}

export function actor(c: WebContext): Actor {
  return userActor(currentUser(c));
}

/** Loads `:projectId` and checks that the signed-in user is a member. */
export function projectMiddleware(ctx: Ctx): MiddlewareHandler<WebEnv> {
  return async (c, next) => {
    const user = currentUser(c);
    const projectId = c.req.param('projectId') ?? '';
    const project = getProjectForUser(ctx, projectId, user.id);
    if (!project) {
      return c.html(
        dashboardPage({
          ctx,
          user,
          project: null,
          projects: listProjectsForUser(ctx, user.id),
          active: null,
          title: 'Project not found',
          flash: null,
          content: html`<div class="card">${emptyState({
            icon: 'alert',
            title: 'This project does not exist or you do not have access to it.',
            text: 'Pick another project or create a new one.',
            action: html`<a class="btn btn-primary" href="/app">Go to my projects</a>`,
          })}</div>`,
        }).toString(),
        404,
      );
    }
    c.set('project', project);
    c.set('projects', listProjectsForUser(ctx, user.id));
    rememberProject(ctx, c, project.id);
    await next();
  };
}

export function base(c: WebContext): string {
  return `/app/p/${c.get('project').id}`;
}

export interface RenderOptions {
  active: NavKey | null;
  title: string;
  eyebrow?: HtmlChild;
  lead?: HtmlChild;
  actions?: HtmlChild;
  content: HtmlChild;
  status?: 200 | 404;
}

export async function render(ctx: Ctx, c: WebContext, opts: RenderOptions) {
  const flash = await consumeFlash(ctx, c);
  let project = null;
  try {
    project = c.get('project') ?? null;
  } catch {
    project = null;
  }
  const page = dashboardPage({
    ctx,
    user: currentUser(c),
    project,
    projects: project ? c.get('projects') : listProjectsForUser(ctx, currentUser(c).id),
    active: opts.active,
    title: opts.title,
    eyebrow: opts.eyebrow,
    lead: opts.lead,
    actions: opts.actions,
    flash,
    content: opts.content,
  });
  return c.html(page.toString(), opts.status ?? 200);
}

/**
 * Run a dashboard form action: on success flash + redirect (POST/redirect/GET),
 * on a user-facing error flash the message and go back to the form.
 */
export async function formAction(
  ctx: Ctx,
  c: WebContext,
  fn: () => string | void | Promise<string | void>,
  opts: { success: string; redirect: string; errorRedirect?: string },
) {
  try {
    const target = await fn();
    await setFlash(ctx, c, 'success', opts.success);
    return c.redirect(typeof target === 'string' ? target : opts.redirect, 303);
  } catch (err) {
    if (err instanceof ApiError) {
      await setFlash(ctx, c, 'error', err.message);
      return c.redirect(opts.errorRedirect ?? opts.redirect, 303);
    }
    throw err;
  }
}

export async function form(c: WebContext): Promise<Record<string, string>> {
  const body = await c.req.parseBody();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v;
  return out;
}

export function crumbs(...items: (string | [string, string])[]): HtmlChild {
  return items.map((item, i) => {
    const sep = i < items.length - 1 ? html`<span>/</span>` : '';
    return typeof item === 'string' ? html`<span>${item}</span>${sep}` : html`<a href="${item[1]}">${item[0]}</a>${sep}`;
  });
}
