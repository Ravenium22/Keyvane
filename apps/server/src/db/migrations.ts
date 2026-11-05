import type { Db } from './sqlite.ts';

/**
 * Append-only list of schema migrations. Never edit a migration that has shipped;
 * add a new one instead. Applied in order inside a transaction at startup.
 */
export const migrations: { id: string; sql: string }[] = [
  {
    id: '0001_initial',
    sql: /* sql */ `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id),
        stripe_webhook_secret TEXT,
        stripe_connected_at TEXT,
        stripe_last_event_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE project_members (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX project_members_user ON project_members(user_id);

      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('secret', 'publishable')),
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        token_plain TEXT,
        last_used_at TEXT,
        revoked_at TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX api_keys_project ON api_keys(project_id);

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        default_plan_id TEXT,
        cancellation_policy TEXT NOT NULL DEFAULT 'immediate'
          CHECK (cancellation_policy IN ('immediate', 'period_end')),
        grace_period_days INTEGER NOT NULL DEFAULT 7,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, key)
      );

      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        rank INTEGER NOT NULL DEFAULT 0,
        price_amount INTEGER,
        currency TEXT NOT NULL DEFAULT 'usd',
        billing_interval TEXT CHECK (billing_interval IN ('month', 'year', 'one_time')),
        max_activations INTEGER,
        stripe_price_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (product_id, key)
      );
      CREATE INDEX plans_project ON plans(project_id);

      CREATE TABLE features (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL CHECK (type IN ('boolean', 'metered')),
        reset_period TEXT NOT NULL DEFAULT 'month' CHECK (reset_period IN ('day', 'month', 'year', 'never')),
        unit TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (product_id, key)
      );

      CREATE TABLE plan_features (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1,
        limit_value INTEGER,
        PRIMARY KEY (plan_id, feature_id)
      );

      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        external_id TEXT,
        email TEXT,
        name TEXT,
        stripe_customer_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX customers_external ON customers(project_id, external_id) WHERE external_id IS NOT NULL;
      CREATE UNIQUE INDEX customers_stripe ON customers(project_id, stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
      CREATE INDEX customers_project ON customers(project_id, created_at);

      CREATE TABLE subscriptions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        provider TEXT NOT NULL DEFAULT 'stripe',
        provider_subscription_id TEXT NOT NULL,
        provider_customer_id TEXT,
        status TEXT NOT NULL,
        price_ids TEXT NOT NULL DEFAULT '[]',
        amount INTEGER,
        currency TEXT,
        billing_interval TEXT,
        interval_count INTEGER,
        current_period_start TEXT,
        current_period_end TEXT,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        cancel_at TEXT,
        canceled_at TEXT,
        ended_at TEXT,
        trial_end TEXT,
        past_due_since TEXT,
        livemode INTEGER NOT NULL DEFAULT 0,
        last_event_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, provider, provider_subscription_id)
      );
      CREATE INDEX subscriptions_customer ON subscriptions(customer_id);

      CREATE TABLE licenses (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES plans(id),
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
        key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
        source TEXT NOT NULL CHECK (source IN ('dashboard', 'api', 'stripe')),
        expires_at TEXT,
        max_activations INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        note TEXT,
        status_reason TEXT,
        status_changed_at TEXT,
        last_validated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX licenses_project ON licenses(project_id, created_at);
      CREATE INDEX licenses_customer ON licenses(customer_id);
      CREATE INDEX licenses_plan ON licenses(plan_id);
      CREATE UNIQUE INDEX licenses_subscription_product ON licenses(subscription_id, product_id)
        WHERE subscription_id IS NOT NULL;

      CREATE TABLE activations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL,
        name TEXT,
        ip TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE (license_id, fingerprint)
      );

      CREATE TABLE usage_counters (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL,
        feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        period_key TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (subject_id, feature_id, period_key)
      );

      CREATE TABLE usage_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL,
        customer_id TEXT,
        license_id TEXT,
        feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        period_key TEXT NOT NULL,
        idempotency_key TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX usage_events_idempotency ON usage_events(project_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX usage_events_subject ON usage_events(subject_id, created_at);

      CREATE TABLE webhook_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        type TEXT NOT NULL,
        livemode INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'ignored', 'failed')),
        message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL,
        event_created_at TEXT,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        UNIQUE (project_id, provider, provider_event_id)
      );
      CREATE INDEX webhook_events_project ON webhook_events(project_id, received_at);

      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        actor_label TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_logs_project ON audit_logs(project_id, created_at);
      CREATE INDEX audit_logs_target ON audit_logs(target_id);

      CREATE TABLE daily_stats (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        metric TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, day, metric)
      );
    `,
  },
  {
    id: '0002_password_resets',
    sql: /* sql */ `
      CREATE TABLE password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX password_resets_user ON password_resets(user_id);
    `,
  },
];

export function migrate(db: Db, now: () => Date = () => new Date()): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.all<{ id: string }>('SELECT id FROM schema_migrations').map((r) => r.id));
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', migration.id, now().toISOString());
    });
    ran.push(migration.id);
  }
  return ran;
}
