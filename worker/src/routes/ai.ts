import { Hono } from 'hono';
import type { Env } from '../index';
import { REFUSAL, isRepoQuestion } from '../ai/guard';
import { answerRepoQuestion, type Answer, type ChatMsg, type Complete } from '../ai/engine';
import { fetchFile, fetchTree, selectFiles } from '../ai/context';
import { ProviderError, callPlatform, callProvider } from '../ai/provider';
import { resolveProvider } from '../ai/resolve';

const r = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
const bad = (m: string, code?: string) => ({ ok: false, error: m, ...(code ? { code } : {}) });

r.post('/ai/chat', async (c) => {
  const uid = c.get('userId'), db = c.env.DB;
  const b = await c.req.json<any>().catch(() => null);
  const repoId = Number(b?.repositoryId), msg = typeof b?.message === 'string' ? b.message.trim() : '';
  if (!Number.isInteger(repoId) || !msg || msg.length > 2000) return c.json(bad('repositoryId and message (max 2000 chars) required'), 400);

  const repo = await db.prepare('SELECT id, name, full_name, description, language, default_branch FROM repositories WHERE id = ? AND user_id = ?').bind(repoId, uid).first<any>();
  if (!repo) return c.json(bad('Repository not found'), 404);

  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM ai_messages m JOIN ai_conversations cv ON cv.id = m.conversation_id
    WHERE cv.user_id = ? AND m.role = 'user' AND m.created_at > datetime('now','-1 minute')`).bind(uid).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return c.json(bad('Too many questions. Please wait a minute.', 'rate_limited'), 429);

  // Context isolation: a conversation can only be continued inside the repository it was created for.
  let convId: number, history: ChatMsg[] = [];
  if (b.conversationId != null) {
    const cv = await db.prepare('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ? AND repository_id = ?').bind(Number(b.conversationId), uid, repo.id).first<{ id: number }>();
    if (!cv) return c.json(bad('Conversation not found for this repository'), 404);
    convId = cv.id;
    history = (await db.prepare('SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 10').bind(convId).all<ChatMsg>()).results.reverse();
  } else {
    const ins = await db.prepare('INSERT INTO ai_conversations (user_id, repository_id, title) VALUES (?,?,?) RETURNING id').bind(uid, repo.id, msg.slice(0, 60)).first<{ id: number }>();
    convId = ins!.id;
  }

  const paths = await fetchTree(repo.full_name, repo.default_branch ?? 'HEAD', c.env.GITHUB_TOKEN).catch(() => [] as string[]);
  let result: Answer, used = 'default';
  // Repository-only restriction is applied BEFORE any provider is resolved, so it holds identically for every provider.
  if (!isRepoQuestion(msg, { name: repo.name, paths, language: repo.language })) {
    result = { answer: REFUSAL, refused: true, sources: [] };
  } else {
    const res = await resolveProvider(c.env, uid);
    if ('error' in res) return c.json(bad(res.error, 'provider_unavailable'), res.status);
    used = res.kind === 'byok' ? res.provider : 'default';
    const files = await Promise.all(selectFiles(paths, msg).map(async (path) => ({ path, content: await fetchFile(repo.full_name, path, c.env.GITHUB_TOKEN) })));
    const complete: Complete = res.kind === 'byok'
      ? (m) => callProvider(res.cfg, m)
      : (m) => callPlatform(c.env.AI!, c.env.AI_MODEL, m);
    try {
      result = await answerRepoQuestion({
        question: msg, history, complete,
        ctx: { fullName: repo.full_name, name: repo.name, description: repo.description, language: repo.language, paths, files: files.filter((f) => f.content) },
      });
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'rate_limited') return c.json(bad('AI rate limit reached. Please try again later.', 'provider_rate'), 429);
      if (e instanceof ProviderError && e.code === 'invalid_key' && res.kind === 'byok') {
        await db.prepare("UPDATE ai_providers SET status = 'invalid_key' WHERE user_id = ? AND provider = ?").bind(uid, res.provider).run();
        return c.json(bad('Your AI provider rejected the API key. Update it or switch to Default AI in AI Settings.', 'provider_auth'), 502);
      }
      return c.json(bad('AI request failed. You can switch providers in AI Settings.', 'provider_unavailable'), 502);
    }
  }
  await db.batch([
    db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?,?,?)').bind(convId, 'user', msg),
    db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?,?,?)').bind(convId, 'assistant', result.answer),
    db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").bind(convId),
  ]);
  return c.json({ ok: true, data: { conversationId: convId, provider: used, ...result } });
});

r.get('/ai/conversations', async (c) => {
  const repoId = Number(c.req.query('repositoryId'));
  if (!Number.isInteger(repoId)) return c.json(bad('repositoryId required'), 400);
  const rows = await c.env.DB.prepare('SELECT id, title, updated_at FROM ai_conversations WHERE user_id = ? AND repository_id = ? ORDER BY updated_at DESC').bind(c.get('userId'), repoId).all();
  return c.json({ ok: true, data: rows.results });
});

r.get('/ai/conversations/:id', async (c) => {
  const cv = await c.env.DB.prepare('SELECT id, repository_id, title FROM ai_conversations WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.get('userId')).first();
  if (!cv) return c.json(bad('Not found'), 404);
  const m = await c.env.DB.prepare('SELECT role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY id').bind(c.req.param('id')).all();
  return c.json({ ok: true, data: { ...cv, messages: m.results } });
});

r.delete('/ai/conversations/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.get('userId')).run();
  return c.json({ ok: true });
});

export default r;
