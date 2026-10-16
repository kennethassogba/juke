CREATE TABLE IF NOT EXISTS mailing_subscriptions (
  email TEXT NOT NULL COLLATE NOCASE,
  site TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  consent_text TEXT NOT NULL DEFAULT '',
  consent_version TEXT NOT NULL DEFAULT '',
  unsubscribe_token TEXT,
  locale TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (email, site)
);
CREATE INDEX IF NOT EXISTS mailing_site_date ON mailing_subscriptions(site,created_at);
CREATE INDEX IF NOT EXISTS mailing_token ON mailing_subscriptions(site,unsubscribe_token);
