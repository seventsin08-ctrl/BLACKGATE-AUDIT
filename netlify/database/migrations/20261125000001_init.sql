-- BlackGate Audit: initial schema. Never edit after deploy; add new migrations instead.
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('superadmin','staff')),
  staff_code TEXT UNIQUE,
  position TEXT NOT NULL DEFAULT '',
  responsibilities TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_file TEXT,
  totp_secret_enc TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_codes JSONB NOT NULL DEFAULT '[]',
  dashboard_layout JSONB,
  joined_at DATE NOT NULL DEFAULT CURRENT_DATE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_superadmin ON users ((role)) WHERE role = 'superadmin';

CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip TEXT, user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_events (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT, success BOOLEAN NOT NULL, reason TEXT,
  ip TEXT, user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_events_ip ON login_events(ip, created_at);
CREATE INDEX login_events_user ON login_events(username, created_at);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, mime TEXT NOT NULL, size INT NOT NULL, name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platforms (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, name TEXT NOT NULL,
  profile_name TEXT NOT NULL DEFAULT '', profile_url TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platforms_user ON platforms(user_id);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform_id INT REFERENCES platforms(id) ON DELETE SET NULL,
  url TEXT NOT NULL, url_norm TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', campaign TEXT NOT NULL DEFAULT '',
  posted_on DATE NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  screenshot_file TEXT REFERENCES files(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','duplicate')),
  duplicate_of INT, review_note TEXT NOT NULL DEFAULT '',
  verified_by INT, verified_at TIMESTAMPTZ
);
CREATE INDEX posts_user_date ON posts(user_id, posted_on);
CREATE INDEX posts_norm ON posts(url_norm);

CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '',
  platform_id INT REFERENCES platforms(id) ON DELETE SET NULL,
  service TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  acquired_on DATE NOT NULL DEFAULT CURRENT_DATE,
  confirmed_at TIMESTAMPTZ, confirmed_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX clients_user ON clients(user_id);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('initial','remaining')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_file TEXT REFERENCES files(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by INT, verified_at TIMESTAMPTZ, review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_client ON payments(client_id);

CREATE TABLE tips (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  received_on DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_file TEXT REFERENCES files(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','released')),
  verified_by INT, verified_at TIMESTAMPTZ, released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bonuses (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL DEFAULT '',
  awarded_by INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awarded' CHECK (status IN ('awarded','released')),
  released_at TIMESTAMPTZ, payout_ref TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commissions (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  rate_percent NUMERIC(6,2) NOT NULL DEFAULT 10,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','eligible','approved','released','void')),
  eligible_at TIMESTAMPTZ, approved_by INT, approved_at TIMESTAMPTZ,
  released_by INT, released_at TIMESTAMPTZ,
  payout_method TEXT NOT NULL DEFAULT '', payout_ref TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  assigned_to INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by INT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal','official')),
  group_id TEXT, parent_id INT REFERENCES tasks(id) ON DELETE CASCADE,
  deadline TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  category TEXT NOT NULL DEFAULT '',
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  platform_id INT REFERENCES platforms(id) ON DELETE SET NULL,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly')),
  requires_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_text TEXT NOT NULL DEFAULT '', evidence_file TEXT REFERENCES files(id) ON DELETE SET NULL,
  checklist JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','under_review','completed','overdue','cancelled')),
  review_note TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ, verified_at TIMESTAMPTZ, verified_by INT,
  reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_user ON tasks(assigned_to, status);

CREATE TABLE note_folders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','work')),
  title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  checklist JSONB NOT NULL DEFAULT '[]',
  folder_id INT REFERENCES note_folders(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT FALSE, archived BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  task_id INT REFERENCES tasks(id) ON DELETE SET NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notes_user ON notes(user_id);

CREATE TABLE audits (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audit_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','correction_requested')),
  manual JSONB NOT NULL DEFAULT '{}',
  snapshot JSONB,
  revision INT NOT NULL DEFAULT 1,
  submitted_at TIMESTAMPTZ, reviewed_by INT, reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, audit_date)
);
CREATE TABLE audit_revisions (
  id SERIAL PRIMARY KEY,
  audit_id INT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  revision INT NOT NULL, status TEXT NOT NULL,
  manual JSONB NOT NULL, snapshot JSONB,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL, body TEXT NOT NULL,
  recipients INT[],
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, read_at);

CREATE TABLE activity_logs (
  id SERIAL PRIMARY KEY,
  actor_id INT, actor_name TEXT,
  action TEXT NOT NULL, target_type TEXT, target_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}', ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_created ON activity_logs(created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY, value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
