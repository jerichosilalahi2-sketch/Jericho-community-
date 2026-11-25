require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const crypto = require('crypto');
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const sessions = new Map(); // demo-friendly in-memory OAuth session store; use a secure persistent session store for production
const models = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.0-flash').split(',').map(x => x.trim()).filter(Boolean);

function getOAuth() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) return null;
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}
function getGoogleAuth(req) {
  const token = req.headers['x-drive-session'];
  if (!token || !sessions.has(token)) return null;
  const oauth = getOAuth();
  if (!oauth) return null;
  oauth.setCredentials(sessions.get(token));
  return oauth;
}

app.get('/api/status', (_req, res) => res.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY), driveConfigured: Boolean(getOAuth()) }));

app.post('/api/ai', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini belum dikonfigurasi. Tambahkan GEMINI_API_KEY di file .env.' });
  const { mode, prompt, history = [], settings = {} } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'Tuliskan pertanyaan atau materi terlebih dahulu.' });
  const system = {
    learn: 'Kamu adalah tutor pendidikan Indonesia yang sangat jelas dan akurat. Jelaskan materi dari dasar sampai inti, gunakan heading, contoh sehari-hari, rumus dan arti simbol bila relevan, contoh soal dengan langkah, kesalahan umum, ringkasan, dan evaluasi. Gunakan Markdown. Jangan mengarang fakta. Jika topik fisika seperti momentum dan impuls, jelaskan p=mv dan I=FΔt serta hubungan impuls dengan perubahan momentum dengan benar.',
    quiz: 'Kamu adalah pembuat latihan soal untuk siswa Indonesia. Pahami instruksi bebas pengguna. Buat soal sesuai materi, jumlah, tingkat, dan jenis yang diminta. Kembalikan HANYA JSON valid dengan bentuk {"title":"...","questions":[{"question":"...","type":"single|multi|short","options":["..."],"answer":0,"explanation":"..."}]}. Untuk single answer gunakan answer berupa indeks angka; multi gunakan array indeks; short gunakan jawaban teks. Default 10 soal pilihan ganda jika pengguna tidak menentukan. Pastikan pilihan dan kunci akurat.',
    master: 'Kamu adalah Master, guru AI senior yang bijaksana, ramah, sabar, berpengalaman, dan ahli mengajar. Jawab dalam bahasa Indonesia yang mudah dipahami siswa. Berikan penjelasan bertahap, contoh bila membantu, dan jangan menghakimi. Gunakan konteks percakapan.',
  };
  const instruction = system[mode] || system.master;
  const contents = [];
  for (const item of history.slice(-12)) {
    if (!item || !['user','model'].includes(item.role) || !item.text) continue;
    contents.push({ role: item.role, parts: [{ text: String(item.text).slice(0, 6000) }] });
  }
  contents.push({ role: 'user', parts: [{ text: `${instruction}\n\nPermintaan siswa: ${prompt}\nPengaturan: ${JSON.stringify(settings)}` }] });
  let lastError = 'Layanan AI sedang sibuk.';
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 35000);
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ contents, generationConfig: { temperature: mode === 'quiz' ? 0.35 : 0.65, maxOutputTokens: 7000 } })
        });
        clearTimeout(timeout);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastError = data?.error?.message || `Gemini merespons dengan status ${response.status}`;
          if (response.status === 429 || response.status >= 500) { await new Promise(r => setTimeout(r, 700 * (attempt + 1))); continue; }
          break;
        }
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
        if (text) return res.json({ text, model });
        lastError = 'AI mengirim jawaban kosong.';
      } catch (e) {
        clearTimeout(timeout); lastError = e.name === 'AbortError' ? 'Permintaan terlalu lama. Coba lagi.' : 'Koneksi ke AI terganggu.';
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  res.status(502).json({ error: lastError, retryable: true });
});

app.get('/auth/google', (req, res) => {
  const oauth = getOAuth();
  if (!oauth) return res.status(503).send('Google OAuth belum dikonfigurasi. Isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GOOGLE_REDIRECT_URI pada .env.');
  const state = crypto.randomBytes(18).toString('hex');
  // State is temporary and tied to this browser via a short-lived cookie.
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 5 * 60 * 1000 });
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/drive.file'], state });
  res.redirect(url);
});
app.get('/auth/google/callback', async (req, res) => {
  const oauth = getOAuth();
  if (!oauth) return res.redirect('/?drive=not-configured');
  try {
    const { code, error, state } = req.query;
    const cookieState = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('oauth_state='))?.split('=').slice(1).join('=');
    if (error || !code) return res.redirect('/?drive=cancelled');
    if (!state || !cookieState || String(state) !== decodeURIComponent(cookieState)) return res.status(400).send('OAuth state tidak cocok. Silakan mulai ulang koneksi Google Drive.');
    res.setHeader('Set-Cookie', 'oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    const { tokens } = await oauth.getToken(String(code));
    const sessionId = crypto.randomBytes(24).toString('hex');
    sessions.set(sessionId, tokens);
    // For a compact starter, hand session id to the app once. Production should use secure httpOnly server sessions.
    res.redirect('/?drive=connected&session=' + encodeURIComponent(sessionId));
  } catch (e) { console.error('OAuth callback:', e.message); res.redirect('/?drive=error'); }
});
app.post('/api/drive/doc', async (req, res) => {
  const auth = getGoogleAuth(req);
  if (!auth) return res.status(401).json({ error: 'Google Drive belum terhubung. Hubungkan akun Google terlebih dahulu.' });
  const { title, content } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'Judul dan isi catatan wajib diisi.' });
  try {
    const drive = google.drive({ version: 'v3', auth });
    const doc = await drive.files.create({ requestBody: { name: title, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,name,webViewLink' });
    const docs = google.docs({ version: 'v1', auth });
    await docs.documents.batchUpdate({ documentId: doc.data.id, requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] } });
    res.json({ ok: true, name: doc.data.name, url: doc.data.webViewLink || `https://docs.google.com/document/d/${doc.data.id}/edit` });
  } catch (e) { console.error('Drive upload:', e.message); res.status(502).json({ error: 'Catatan gagal disimpan ke Drive. Periksa izin Google Drive dan coba lagi.' }); }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Jericho Community berjalan di http://localhost:${port}`));
