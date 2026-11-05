CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, github_id INTEGER NOT NULL UNIQUE,
  username TEXT NOT NULL, avatar_url TEXT, email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_repo_id INTEGER, owner TEXT NOT NULL, name TEXT NOT NULL, full_name TEXT NOT NULL,
  url TEXT NOT NULL, description TEXT, language TEXT, stars INTEGER DEFAULT 0, forks INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'public', default_branch TEXT, license TEXT, pushed_at TEXT,
  latest_commit_sha TEXT, previous_commit_sha TEXT, last_checked_at TEXT, last_seen_update_at TEXT,
  is_starred INTEGER NOT NULL DEFAULT 0, monitoring_enabled INTEGER NOT NULL DEFAULT 1,
  has_update INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, full_name));
CREATE INDEX idx_repos_user_pushed ON repositories(user_id, pushed_at DESC);
CREATE INDEX idx_repos_user_starred ON repositories(user_id, is_starred);
CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name));
CREATE TABLE folder_repositories (
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(folder_id, repository_id));
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, UNIQUE(user_id, name));
CREATE TABLE repository_tags (
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(repository_id, tag_id));
CREATE TABLE ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, encrypted_api_key TEXT, model TEXT, base_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL, title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_msgs_conv ON ai_messages(conversation_id);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE, type TEXT NOT NULL,
  title TEXT NOT NULL, message TEXT, is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_notif_user ON notifications(user_id, is_read, created_at DESC);
CREATE TABLE user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark', preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
