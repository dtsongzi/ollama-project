import express from 'express';
import cors from 'cors';
import multer from 'multer';
// 使用Node.js内置的fetch API，避免node-fetch的兼容性问题
// import fetch from 'node-fetch';
import xlsx from 'xlsx';
import mammoth from 'mammoth';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import pool from './db.js';

const OLLAMA_CHAT_URL = 'http://localhost:11434/api/generate';
const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';
const DEFAULT_MODEL = 'deepseek-r1:8b';
const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret';
const TOKEN_TTL = '7d';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB per attachment
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const sanitizeUser = user => {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
};

async function getUserByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0];
}

async function getUserById(id) {
  const [rows] = await pool.query('SELECT id, email, created_at, updated_at FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0];
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.id);
    if (!user) {
      return res.status(401).json({ error: '用户不存在或已注销' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('身份验证失败', err.message);
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

const EXCEL_MIME_KEYWORDS = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const WORD_MIME_KEYWORDS = ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

function isExcelFile(file = {}) {
  const lowerName = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  return (
    EXCEL_MIME_KEYWORDS.some(keyword => mime.includes(keyword)) ||
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls')
  );
}

function isWordFile(file = {}) {
  const lowerName = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  return (
    WORD_MIME_KEYWORDS.some(keyword => mime.includes(keyword)) ||
    lowerName.endsWith('.docx') ||
    lowerName.endsWith('.doc')
  );
}

function parseExcelBuffer(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetsText = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const csv = xlsx.utils.sheet_to_csv(sheet, { FS: '\t' }).trim();
    return `表：${name}\n${csv || '(空表)'}`;
  });
  return sheetsText.join('\n\n');
}

async function parseWordBuffer(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value?.trim() || '';
}

async function saveHistory({ userId, prompt, model, result, thinking, attachments }) {
  if (!userId) return;
  try {
    await pool.query(
      `INSERT INTO histories (user_id, prompt, result, thinking, model, attachments)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, prompt, result, thinking, model, JSON.stringify(attachments || [])]
    );
  } catch (err) {
    console.warn('保存历史失败', err.message);
  }
}

app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(OLLAMA_TAGS_URL, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`标签接口返回${response.status}`);
    }
    const data = await response.json();
    const models =
      data?.models?.map(item => item?.name).filter(Boolean) || [];
    if (!models.includes(DEFAULT_MODEL)) {
      models.unshift(DEFAULT_MODEL);
    }
    res.json({ models: Array.from(new Set(models)), defaultModel: DEFAULT_MODEL });
  } catch (err) {
    console.warn('获取模型列表失败，返回默认集合', err.message);
    res.json({ models: [DEFAULT_MODEL], defaultModel: DEFAULT_MODEL, error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码为必填项' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }

    const existing = await getUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: '该邮箱已注册' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [normalizedEmail, passwordHash]
    );
    const user = await getUserById(result.insertId);
    const token = createToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('注册失败', err);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码为必填项' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await getUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const token = createToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('登录失败', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

app.get('/api/history', authenticate, async (req, res) => {
  console.log('获取历史', req.user);
  try {
    const [rows] = await pool.query(
      'SELECT * FROM histories WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    console.log('获取历史', rows);
    res.json({
      history: rows.map(item => ({
        id: item.id,
        prompt: item.prompt,
        result: item.result,
        thinking: item.thinking,
        model: item.model,
        attachments: item.attachments ? JSON.parse(JSON.stringify(item.attachments)) : [],
        createdAt: item.created_at,
        updatedAt: item.updated_at
      }))
    });
  } catch (err) {
    console.error('获取历史失败', err);
    res.status(500).json({ error: '获取历史失败' });
  }
});

/**
 * Converts uploaded files into textual context blocks for the LLM.
 * Tries Excel/Word parsing first, then UTF-8 fallback, and finally Base64.
 */
async function buildFileContext(files = []) {
  const blocks = await Promise.all(files.map(async file => {
    if (isExcelFile(file)) {
      try {
        const excelText = parseExcelBuffer(file.buffer);
        if (excelText && excelText.trim().length > 0) {
          return `文件: ${file.originalname}\n${excelText}`;
        }
      } catch (err) {
        console.warn(`解析Excel失败: ${file.originalname}`, err.message);
      }
    }

    if (isWordFile(file)) {
      try {
        const wordText = await parseWordBuffer(file.buffer);
        if (wordText.length > 0) {
          return `文件: ${file.originalname}\n${wordText}`;
        }
      } catch (err) {
        console.warn(`解析Word失败: ${file.originalname}`, err.message);
      }
    }

    try {
      const utf8Content = file.buffer.toString('utf-8');
      const safeContent = utf8Content.replace(/[\u0000-\u001F]+/g, ' ').trim();
      if (safeContent.length > 0) {
        return `文件: ${file.originalname}\n${safeContent}`;
      }
    } catch (err) {
      console.warn(`读取文本附件失败: ${file.originalname}`, err.message);
    }

    const base64 = file.buffer.toString('base64');
    return `文件: ${file.originalname}\n(无法解析为文本，以下为Base64)\n${base64}`;
  }));

  return blocks;
}

app.post('/api/query', authenticate, upload.array('files'), async (req, res) => {
  try {
    const { prompt, model } = req.body;
    const files = req.files || [];
    const shouldStream = req.query.stream === 'true';
    const attachmentsMeta = files.map(file => ({
      name: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    }));

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'prompt不能为空' });
    }

    console.log('收到请求: ', { model: model || DEFAULT_MODEL, promptPreview: `${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}` });

    const fileContexts = await buildFileContext(files);
    console.log('附件解析完成: ', fileContexts.map((block, idx) => ({
      index: idx,
      length: block.length,
      name: files[idx]?.originalname
    })));

    const userContent = [
      prompt,
      ...fileContexts
    ].join('\n\n');

    const upstreamController = new AbortController();
    req.on('close', () => upstreamController.abort());

    const ollamaResponse = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        stream: shouldStream,
        prompt: userContent,
      }),
      signal: upstreamController.signal
    });

    if (!ollamaResponse.ok) {
      const text = await ollamaResponse.text();
      return res.status(ollamaResponse.status).json({
        error: '调用Ollama失败',
        details: text
      });
    }

    if (shouldStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      const decoder = new TextDecoder();
      let buffer = '';
      let thinking = '';
      let finalText = '';
      const flushChunk = parsed => {
        const payload = {
          type: parsed?.done ? 'done' : 'chunk',
          text: parsed?.response || '',
          thinking: thinking,
          model: parsed?.model || model || DEFAULT_MODEL,
          total_duration_ms: parsed?.total_duration ? parsed.total_duration / 1e6 : undefined
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      for await (const chunk of ollamaResponse.body) {
        buffer += decoder.decode(chunk, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (!parsed.done) {
              const preview = parsed.response?.slice(0, 60) || '';
              console.log('[Ollama流] parsed:', parsed);
              console.log('[Ollama流] chunk:', preview);
            } else {
              console.log('[Ollama流] done: ', {
                total_duration_ms: parsed.total_duration ? parsed.total_duration / 1e6 : undefined
              });
            }
            thinking += parsed?.thinking || '';
            finalText += parsed?.response || '';
            flushChunk(parsed);
          } catch (err) {
            console.warn('解析Ollama流失败', err.message, trimmed);
          }
        }
      }

      if (buffer.trim().length > 0) {
        try {
          const parsed = JSON.parse(buffer.trim());
          console.log('[Ollama流] final buffer');
          thinking += parsed?.thinking || '';
          finalText += parsed?.response || '';
          flushChunk(parsed);
        } catch (err) {
          console.warn('解析末尾Ollama流失败', err.message);
        }
      }

      await saveHistory({
        userId: req.user.id,
        prompt,
        model: model || DEFAULT_MODEL,
        result: finalText,
        thinking,
        attachments: attachmentsMeta
      });

      res.write('event: close\ndata: {}\n\n');
      return res.end();
    }

    const data = await ollamaResponse.json();

    const resultPayload = {
      result: data.response || data?.message?.content || '',
      thinking: data?.thinking || '',
      model: data?.model || model || DEFAULT_MODEL,
      total_duration_ms: data?.total_duration ? data.total_duration / 1e6 : undefined
    };

    await saveHistory({
      userId: req.user.id,
      prompt,
      model: resultPayload.model,
      result: resultPayload.result,
      thinking: resultPayload.thinking,
      attachments: attachmentsMeta
    });

    res.json(resultPayload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误', details: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

