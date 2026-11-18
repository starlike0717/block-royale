'use strict';
/**
 * 블록 로얄 (Block Royale) — 온라인 서버
 * 외부 패키지 없이 Node.js 기본 모듈(http, crypto, fs)만으로
 * 정적 파일 서빙 + WebSocket(RFC 6455) + 게임 방/매칭/봇을 처리합니다.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 6;
const QUICK_WAIT_MS = Number(process.env.QUICK_WAIT_MS) || 12000; // 빠른 매칭: 이 시간 뒤 봇으로 채움
const COUNTDOWN_S = Number(process.env.COUNTDOWN_S) || 3;
const PRESSURE_START_MS = 60000; // 60초 후부터 압박(전원에게 방해블록)
const PRESSURE_EVERY_MS = 10000;
const MATCH_MAX_MS = 5 * 60 * 1000; // 안전장치: 5분 지나면 점수순 종료
const MAX_MSG_BYTES = 4096;

// ───────────────────────── 정적 파일 ─────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400); return res.end('Bad request');
  }
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

// ───────────────────────── WebSocket (RFC 6455) ─────────────────────────
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();
let nextId = 1;

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.alive = true;
    this.closed = false;
    this.id = 'p' + (nextId++);
    this.name = '플레이어';
    this.room = null;
    this.fragments = null;
    this.msgCount = 0;
    this.msgWindow = Date.now();
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }
  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > MAX_MSG_BYTES * 4) return this.close(1009);
    while (true) {
      const frame = parseFrame(this.buf);
      if (frame === null) break; // 데이터 부족
      if (frame === false) return this.close(1002); // 프로토콜 오류
      this.buf = this.buf.subarray(frame.total);
      this.onFrame(frame);
      if (this.closed) return;
    }
  }
  onFrame(f) {
    switch (f.opcode) {
      case 0x0: // continuation
        if (!this.fragments) return this.close(1002);
        this.fragments.push(f.payload);
        if (f.fin) {
          const all = Buffer.concat(this.fragments);
          this.fragments = null;
          this.onText(all);
        }
        break;
      case 0x1: // text
        if (f.fin) this.onText(f.payload);
        else this.fragments = [f.payload];
        break;
      case 0x2: // binary: 사용 안 함
        break;
      case 0x8: this.close(1000); break;
      case 0x9: this.sendFrame(0xA, f.payload); break; // ping → pong
      case 0xA: this.alive = true; break; // pong
      default: this.close(1002);
    }
  }
  onText(buf) {
    if (buf.length > MAX_MSG_BYTES) return this.close(1009);
    // 간단한 속도 제한: 초당 40개
    const now = Date.now();
    if (now - this.msgWindow > 1000) { this.msgWindow = now; this.msgCount = 0; }
    if (++this.msgCount > 40) return;
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try { handleMessage(this, msg); } catch (e) { console.error('handle error', e); }
  }
  send(obj) { this.sendFrame(0x1, Buffer.from(JSON.stringify(obj))); }
  sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([header, payload])); } catch { /* ignore */ }
  }
  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    this.sendFrame(0x8, p);
    this.closed = true;
    try { this.socket.end(); } catch { /* ignore */ }
    this.onClose();
  }
  onClose() {
    this.closed = true;
    if (!clients.has(this)) return;
    clients.delete(this);
    leaveRoom(this);
    try { this.socket.destroy(); } catch { /* ignore */ }
  }
}

/** 프레임 파싱. 데이터 부족이면 null, 오류면 false */
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  if (b0 & 0x70) return false; // RSV 비트(확장) 미지원
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  if (!masked) return false; // 클라이언트 프레임은 반드시 마스킹
  let len = b1 & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(MAX_MSG_BYTES * 4)) return false;
    len = Number(big); off = 10;
  }
  if (opcode >= 0x8 && (len > 125 || !fin)) return false;
  if (buf.length < off + 4 + len) return null;
  const mask = buf.subarray(off, off + 4);
  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) payload[i] = buf[off + 4 + i] ^ mask[i & 3];
  return { fin, opcode, payload, total: off + 4 + len };
}

server.on('upgrade', (req, socket) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch { /* ignore */ }
  const key = req.headers['sec-websocket-key'];
  if (pathname !== '/ws' || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return socket.destroy();
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  const c = new Conn(socket);
  clients.add(c);
  c.send({ t: 'welcome', id: c.id });
});

// 하트비트: 30초마다 ping, 응답 없으면 끊기
const heartbeat = setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.close(1001); continue; }
    c.alive = false;
    c.sendFrame(0x9, Buffer.alloc(0));
  }
}, 30000);

// ───────────────────────── 게임 방 ─────────────────────────
const rooms = new Map(); // code → Room
const BOT_NAMES = ['꼬마블록봇', '팡팡봇', '젤리봇', '로켓봇', '냥냥봇', '퍼즐왕봇', '번개봇', '말랑봇'];
const BOARD_RE = /^[0-9a-z]{64}$/;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(n) {
  if (typeof n !== 'string') return '플레이어';
  const s = n.replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, 12);
  return s || '플레이어';
}

class Room {
  constructor(isQuick) {
    this.code = makeCode();
    this.quick = isQuick;
    this.players = []; // {id, name, conn|null, bot|null, alive, score, board, place}
    this.state = 'lobby'; // lobby | countdown | playing | ended
    this.host = null;
    this.timers = [];
    this.startedAt = 0;
    this.createdAt = Date.now();
    this.placeCounter = 0;
    rooms.set(this.code, this);
    if (isQuick) this.timer(() => this.fillBotsAndStart(), QUICK_WAIT_MS);
  }
  timer(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; }
  interval(fn, ms) { const t = setInterval(fn, ms); this.timers.push(t); return t; }
  clearTimers() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }
  humans() { return this.players.filter((p) => p.conn); }
  broadcast(obj, exceptId) {
    for (const p of this.players) if (p.conn && p.id !== exceptId) p.conn.send(obj);
  }
  publicPlayers() {
    return this.players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, alive: p.alive, score: p.score }));
  }
  sendRoom() {
    this.broadcast({ t: 'room', code: this.code, quick: this.quick, host: this.host, state: this.state,
      players: this.publicPlayers(), waitMs: this.quick ? Math.max(0, QUICK_WAIT_MS - (Date.now() - this.createdAt)) : 0 });
  }
  add(conn) {
    const p = { id: conn.id, name: conn.name, conn, bot: null, alive: true, score: 0, board: '0'.repeat(64), place: 0 };
    this.players.push(p);
    conn.room = this;
    if (!this.host) this.host = conn.id;
    this.sendRoom();
    if (this.quick && this.players.length >= MAX_PLAYERS) this.startCountdown();
  }
  remove(conn) {
    const p = this.players.find((x) => x.id === conn.id);
    if (!p) return;
    conn.room = null;
    if (this.state === 'playing' && p.alive) {
      this.eliminate(p);
    }
    if (this.state === 'lobby' || this.state === 'countdown') {
      this.players = this.players.filter((x) => x !== p);
    } else {
      p.conn = null; // 순위표에 남겨둠
    }
    if (this.humans().length === 0) return this.destroy();
    if (this.host === p.id) this.host = this.humans()[0].id;
    if (this.state === 'countdown' && this.players.length < 2) {
      this.state = 'lobby';
      this.clearTimers();
      if (this.quick) this.timer(() => this.fillBotsAndStart(), QUICK_WAIT_MS);
    }
    this.sendRoom();
    this.broadcast({ t: 'left', id: p.id });
  }
  destroy() {
    this.clearTimers();
    for (const p of this.players) if (p.conn) p.conn.room = null;
    rooms.delete(this.code);
  }
  addBot() {
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || '봇' + crypto.randomInt(100);
    const p = { id: 'b' + (nextId++), name, conn: null, alive: true, score: 0, board: '0'.repeat(64), place: 0,
      bot: { skill: 0.5 + Math.random() * 0.5, danger: 0, cells: new Array(64).fill(0) } };
    this.players.push(p);
    return p;
  }
  fillBotsAndStart() {
    if (this.state !== 'lobby' || this.humans().length === 0) return;
    const want = Math.min(MAX_PLAYERS, Math.max(4, this.players.length));
    while (this.players.length < want) this.addBot();
    this.sendRoom();
    this.startCountdown();
  }
  startCountdown() {
    if (this.state !== 'lobby') return;
    if (this.players.length < 2) return;
    this.state = 'countdown';
    this.clearTimers();
    let s = COUNTDOWN_S;
    this.broadcast({ t: 'countdown', s });
    const iv = this.interval(() => {
      s--;
      if (s > 0) this.broadcast({ t: 'countdown', s });
      else { clearInterval(iv); this.start(); }
    }, 1000);
    this.sendRoom();
  }
  start() {
    this.state = 'playing';
    this.startedAt = Date.now();
    this.placeCounter = this.players.length;
    for (const p of this.players) { p.alive = true; p.score = 0; p.place = 0; p.board = '0'.repeat(64); }
    const seed = crypto.randomInt(1, 2 ** 31 - 1);
    this.broadcast({ t: 'start', seed, players: this.publicPlayers() });
    for (const p of this.players) if (p.bot) this.runBot(p);
    // 압박: 60초 후부터 10초마다 모두에게 방해 블록(점점 증가)
    this.timer(() => {
      let wave = 1;
      this.interval(() => {
        const n = Math.min(6, wave++);
        for (const p of this.players) if (p.alive) this.giveGarbage(p, n, null);
        this.broadcast({ t: 'pressure', n });
      }, PRESSURE_EVERY_MS);
    }, PRESSURE_START_MS);
    this.timer(() => this.endByScore(), MATCH_MAX_MS);
    this.sendRoom();
  }
  runBot(p) {
    const tick = () => {
      if (this.state !== 'playing' || !p.alive) return;
      const b = p.bot;
      // 점수 증가 + 가끔 공격
      p.score += Math.floor(10 + Math.random() * 40 * b.skill);
      // 블록 일부를 채우고 가끔 줄 지우기 흉내
      for (let i = 0; i < 3; i++) b.cells[crypto.randomInt(64)] = 1 + crypto.randomInt(7);
      if (Math.random() < 0.45 * b.skill) {
        const row = crypto.randomInt(8);
        for (let c = 0; c < 8; c++) b.cells[row * 8 + c] = 0;
        b.danger = Math.max(0, b.danger - 2);
        if (Math.random() < 0.5) {
          const target = this.pickTarget(p);
          if (target) this.giveGarbage(target, 1 + crypto.randomInt(2), p);
        }
      }
      b.danger += 0.35;
      p.board = b.cells.map((v) => v.toString(36)).join('');
      this.broadcast({ t: 'opp', id: p.id, board: p.board, score: p.score });
      const filled = b.cells.filter(Boolean).length;
      if (filled > 52 || Math.random() < b.danger / 120) { this.eliminate(p); return; }
      this.timer(tick, 1800 + Math.random() * 2500);
    };
    this.timer(tick, 1500 + Math.random() * 1500);
  }
  pickTarget(from) {
    const alive = this.players.filter((p) => p.alive && p.id !== from.id);
    if (!alive.length) return null;
    // 1등을 노리는 경향 + 랜덤
    if (Math.random() < 0.5) return alive.reduce((a, b) => (b.score > a.score ? b : a));
    return alive[crypto.randomInt(alive.length)];
  }
  giveGarbage(target, n, from) {
    if (!target.alive) return;
    if (target.bot) {
      target.bot.danger += n * 0.8;
      for (let i = 0; i < n; i++) target.bot.cells[crypto.randomInt(64)] = 8;
    } else if (target.conn) {
      target.conn.send({ t: 'garbage', n, from: from ? from.id : null, fromName: from ? from.name : '⚡압박' });
    }
    if (from) this.broadcast({ t: 'attackfx', from: from.id, to: target.id, n });
  }
  eliminate(p) {
    if (!p.alive || this.state !== 'playing') return;
    p.alive = false;
    p.place = this.placeCounter--;
    this.broadcast({ t: 'eliminated', id: p.id, place: p.place, score: p.score });
    const alive = this.players.filter((x) => x.alive);
    if (alive.length <= 1 || this.players.filter((x) => x.alive && x.conn).length === 0) {
      // 남은 사람(들)은 점수 순으로 순위 결정: 낮은 점수부터 뒤쪽 등수를 채움
      alive.sort((a, b) => a.score - b.score);
      for (const a of alive) { a.alive = false; a.place = this.placeCounter--; }
      this.end();
    }
  }
  endByScore() {
    if (this.state !== 'playing') return;
    const alive = this.players.filter((x) => x.alive).sort((a, b) => a.score - b.score);
    for (const a of alive) { a.alive = false; a.place = this.placeCounter--; }
    this.end();
  }
  end() {
    this.state = 'ended';
    this.clearTimers();
    // 순위 보정: place가 1부터 연속되도록
    const ranking = [...this.players].sort((a, b) => a.place - b.place)
      .map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, score: p.score, place: p.place }));
    this.broadcast({ t: 'end', ranking });
    // 같은 방에서 다시 하기 위해 로비로 되돌림 (봇·나간 사람 정리)
    this.timer(() => {
      this.players = this.players.filter((p) => p.conn);
      if (this.players.length === 0) return this.destroy();
      if (!this.players.find((p) => p.id === this.host)) this.host = this.players[0].id;
      for (const p of this.players) { p.alive = true; p.score = 0; p.place = 0; }
      this.state = 'lobby';
      this.createdAt = Date.now();
      if (this.quick) {
        // 빠른 매칭 방은 끝나면 해산 → 클라이언트가 다시 매칭
        for (const p of this.players) p.conn.room = null;
        this.players = [];
        return this.destroy();
      }
      this.sendRoom();
    }, 1500);
  }
}

function findQuickRoom() {
  for (const r of rooms.values()) {
    if (r.quick && r.state === 'lobby' && r.players.length < MAX_PLAYERS) return r;
  }
  return new Room(true);
}

function leaveRoom(conn) {
  if (conn.room) conn.room.remove(conn);
}

function handleMessage(c, m) {
  const room = c.room;
  switch (m.t) {
    case 'hello':
      c.name = cleanName(m.name);
      break;
    case 'quick':
      leaveRoom(c);
      findQuickRoom().add(c);
      break;
    case 'create': {
      leaveRoom(c);
      new Room(false).add(c);
      break;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r || r.quick) return c.send({ t: 'error', msg: '방을 찾을 수 없어요. 코드를 확인해 주세요.' });
      if (r.state !== 'lobby') return c.send({ t: 'error', msg: '이미 게임이 시작된 방이에요.' });
      if (r.players.length >= MAX_PLAYERS) return c.send({ t: 'error', msg: '방이 꽉 찼어요 (최대 6명).' });
      if (room === r) return;
      leaveRoom(c);
      r.add(c);
      break;
    }
    case 'addbot':
      if (room && !room.quick && room.host === c.id && room.state === 'lobby' && room.players.length < MAX_PLAYERS) {
        room.addBot(); room.sendRoom();
      }
      break;
    case 'start':
      if (!room || room.host !== c.id || room.state !== 'lobby') return;
      if (room.players.length < 2) return c.send({ t: 'error', msg: '2명 이상이어야 시작할 수 있어요. 친구를 부르거나 봇을 추가하세요!' });
      room.startCountdown();
      break;
    case 'leave':
      leaveRoom(c);
      break;
    case 'state': {
      if (!room || room.state !== 'playing') return;
      const p = room.players.find((x) => x.id === c.id);
      if (!p || !p.alive) return;
      if (typeof m.board === 'string' && BOARD_RE.test(m.board)) p.board = m.board;
      const s = Number(m.score);
      if (Number.isFinite(s) && s >= p.score && s < 1e7) p.score = Math.floor(s);
      room.broadcast({ t: 'opp', id: p.id, board: p.board, score: p.score }, p.id);
      break;
    }
    case 'attack': {
      if (!room || room.state !== 'playing') return;
      const p = room.players.find((x) => x.id === c.id);
      if (!p || !p.alive) return;
      const n = Math.max(0, Math.min(8, Math.floor(Number(m.n) || 0)));
      if (!n) return;
      const target = room.pickTarget(p);
      if (target) room.giveGarbage(target, n, p);
      break;
    }
    case 'dead': {
      if (!room || room.state !== 'playing') return;
      const p = room.players.find((x) => x.id === c.id);
      if (!p) return;
      const s = Number(m.score);
      if (Number.isFinite(s) && s >= p.score && s < 1e7) p.score = Math.floor(s);
      room.eliminate(p);
      break;
    }
    case 'emote': {
      const EMOTES = ['👍', '😂', '😱', '🔥', '😎', '💖'];
      if (!room || !EMOTES.includes(m.e)) return;
      room.broadcast({ t: 'emote', id: c.id, e: m.e });
      break;
    }
    default:
      break;
  }
}

if (require.main === module) {
  server.listen(PORT, () => console.log(`🎮 블록 로얄 서버 실행 중: http://localhost:${PORT}`));
}

function shutdown() {
  clearInterval(heartbeat);
  for (const r of rooms.values()) r.destroy();
  for (const c of clients) c.close(1001);
  server.close();
}
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

module.exports = { server, rooms, clients, shutdown, parseFrame };
