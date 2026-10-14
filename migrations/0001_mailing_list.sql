CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  consent_at TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL UNIQUE
);
