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
