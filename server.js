const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

function findGame() {
  const candidates = [
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'yc-gta.html')
  ];
  for (const f of candidates) if (fs.existsSync(f)) return f;
  const htmlFile = fs.readdirSync(__dirname).find(f => f.endsWith('.html'));
  return htmlFile ? path.join(__dirname, htmlFile) : null;
}

const GAME = findGame();
console.log('Game file:', GAME || 'NOT FOUND');

const app = express();
app.use(express.json({ limit: '50kb' }));
if (GAME) app.use(express.static(path.dirname(GAME)));
app.get('/', (req, res) => {
  if (GAME) res.sendFile(GAME);
  else res.status(500).send('لم يتم العثور على ملف اللعبة (index.html) داخل المستودع');
});

// المساعد الذكي: يدعم Gemini (GEMINI_API_KEY) أو Claude (ANTHROPIC_API_KEY)
const SYSTEM_AI = 'أنت المساعد الذكي داخل لعبة مدينة YC City. تكلم بالعربي باختصار وبأسلوب ودّي. تساعد اللاعب بنصائح اللعب والمدينة (المحلات، البيوت، الوظائف، المطار، محطة البنزين، الجراج، المعرض).';
function cleanMsgs(list){return (Array.isArray(list)?list:[]).slice(-10).map(m=>({
  role: m.role==='assistant'?'assistant':'user',
  content: String(m.content||'').slice(0,500)})).filter(m=>m.content)}

async function askGemini(key, msgs){
  const contents = msgs.map(m=>({role: m.role==='assistant'?'model':'user', parts:[{text:m.content}]}));
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_AI }] },
      contents,
      generationConfig: { maxOutputTokens: 300 }
    })
  });
  const j = await r.json();
  if (!r.ok) return 'خطأ من Gemini: ' + ((j.error && j.error.message) || r.status);
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return parts.map(p => p.text || '').join('').trim() || 'ما قدرت أرد الحين، جرب مرة ثانية.';
}

async function askClaude(key, msgs){
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 300, system: SYSTEM_AI, messages: msgs })
  });
  const j = await r.json();
  if (!r.ok) return 'خطأ من Claude: ' + ((j.error && j.error.message) || r.status);
  return (j.content || []).map(c => c.text || '').join('').trim() || 'ما قدرت أرد الحين، جرب مرة ثانية.';
}

app.post('/api/ai', async (req, res) => {
  const GEM = process.env.GEMINI_API_KEY;
  const CLA = process.env.ANTHROPIC_API_KEY;
  if (!GEM && !CLA) return res.json({ reply: 'المساعد غير مفعّل بعد. صاحب السيرفر لازم يضيف GEMINI_API_KEY في إعدادات Render.' });
  const msgs = cleanMsgs(req.body && req.body.messages);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.json({ reply: 'اكتب سؤالك أولًا.' });
  try {
    const reply = GEM ? await askGemini(GEM, msgs) : await askClaude(CLA, msgs);
    res.json({ reply });
  } catch (e) {
    res.json({ reply: 'تعذّر الاتصال بالمساعد الحين.' });
  }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const players = {};

io.on('connection', (sock) => {
  sock.on('join', (d) => {
    d = d || {};
    players[sock.id] = {
      id: sock.id,
      name: String(d.name || 'لاعب').slice(0, 14),
      look: d.look || {},
      x: Number(d.x) || 0,
      z: Number(d.z) || 0,
      h: 0,
      sp: 0,
      inCar: false
    };
    sock.emit('players', Object.values(players));
    sock.broadcast.emit('players', [players[sock.id]]);
  });

  sock.on('state', (s) => {
    const p = players[sock.id];
    if (!p || !s) return;
    p.x = Number(s.x) || 0;
    p.z = Number(s.z) || 0;
    p.h = Number(s.h) || 0;
    p.sp = Number(s.sp) || 0;
    p.inCar = !!s.inCar;
    sock.broadcast.emit('state', { id: sock.id, x: p.x, z: p.z, h: p.h, sp: p.sp, inCar: p.inCar });
  });

  sock.on('chat', (t) => {
    const p = players[sock.id];
    if (!p) return;
    const text = String(t || '').slice(0, 120);
    if (!text) return;
    io.emit('chat', { name: p.name, text });
  });

  sock.on('disconnect', () => {
    delete players[sock.id];
    io.emit('leave', sock.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('YC City server running on port ' + PORT));
