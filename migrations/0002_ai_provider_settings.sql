ALTER TABLE users ADD COLUMN active_ai_provider TEXT NOT NULL DEFAULT 'default';
UPDATE ai_providers SET provider = 'custom' WHERE provider NOT IN ('gemini','groq','custom');
ALTER TABLE ai_providers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_providers ADD COLUMN status TEXT NOT NULL DEFAULT 'untested';
ALTER TABLE ai_providers ADD COLUMN key_hint TEXT;
ALTER TABLE ai_providers ADD COLUMN last_tested_at TEXT;
CREATE UNIQUE INDEX idx_ai_providers_user_provider ON ai_providers(user_id, provider);
