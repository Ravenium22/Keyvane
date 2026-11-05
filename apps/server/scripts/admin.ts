/**
 * Administrative commands for self-hosted installations.
 *
 *   npm run admin -- create-user <email> <password>
 *   npm run admin -- reset-password <email> <new password>
 *   npm run admin -- list-users
 *   npm run admin -- stats [--days 7]     growth and reliability metrics (business plan, section 18)
 *   npm run admin -- maintenance          clean up expired sessions and old data now
 *   npm run admin -- setup-billing <email> create the project that sells Keyvane Cloud (operators only)
 */
import { countUsers, createUser, getUserByEmail, setPassword } from '../src/services/users.ts';
import { optimizeDatabase, runMaintenance } from '../src/services/maintenance.ts';
import { platformMetrics } from '../src/services/metrics.ts';
import { setupCloudBilling } from '../src/dev/cloud-billing-setup.ts';
import type { UserRow } from '../src/types.ts';
import { openContext, parseArgs } from './_context.ts';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, email, password] = positional;
const ctx = openContext();

try {
  switch (command) {
    case 'create-user': {
      if (!email || !password) throw new Error('Usage: create-user <email> <password>');
      const user = await createUser(ctx, { email, password });
      console.log(`Created ${user.email} (${user.id}).`);
      break;
    }
    case 'reset-password': {
      if (!email || !password) throw new Error('Usage: reset-password <email> <new password>');
      const user = getUserByEmail(ctx, email);
      if (!user) throw new Error(`No user with email ${email}.`);
      await setPassword(ctx, user.id, password);
      console.log(`Password updated for ${user.email}. Existing sessions were signed out.`);
      break;
    }
    case 'list-users': {
      const users = ctx.db.all<UserRow>('SELECT * FROM users ORDER BY created_at');
      console.log(`${countUsers(ctx)} user(s)`);
      for (const u of users) console.log(`  ${u.email.padEnd(36)} ${u.id}  created ${u.created_at.slice(0, 10)}`);
      break;
    }
    case 'maintenance': {
      const report = runMaintenance(ctx);
      optimizeDatabase(ctx);
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    case 'stats': {
      const days = Number(flags.days ?? 7) || 7;
      console.log(`Keyvane metrics · ${new Date().toISOString().slice(0, 10)} · window ${days} days\n`);
      for (const [label, value] of platformMetrics(ctx, days)) console.log(`  ${label.padEnd(48)} ${value}`);
      break;
    }
    case 'setup-billing': {
      // Creates the project that sells Keyvane Cloud on this instance (dogfooding).
      if (!email) throw new Error('Usage: setup-billing <owner email>');
      const owner = getUserByEmail(ctx, email);
      if (!owner) throw new Error(`No user with email ${email}. Create the account first.`);
      const result = setupCloudBilling(ctx, owner);
      console.log(`Created project "${result.project.name}" (${result.project.id}) with plans: ${result.plans.join(', ')}.

Next:
  1. In the dashboard, open the project, adjust the quotas in the "What each plan unlocks" matrix
     (products / active_licenses) and add your Stripe price IDs to the paid plans.
  2. Connect Stripe on the project's Stripe page (webhook URL + signing secret).
  3. Create a Stripe Payment Link per paid plan and set these environment variables:

     KEYVANE_BILLING_PROJECT=${result.project.id}
     KEYVANE_UPGRADE_LINKS=indie=https://buy.stripe.com/...,startup=https://buy.stripe.com/...
     KEYVANE_BILLING_PORTAL_URL=https://billing.stripe.com/p/login/...   (optional)
     KEYVANE_ENFORCE_PLAN_LIMITS=true                                    (when the beta ends)
`);
      break;
    }
    default:
      console.log('Commands: create-user <email> <password> | reset-password <email> <password> | list-users | stats [--days 7] | maintenance | setup-billing <email>');
      process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  ctx.db.close();
}
