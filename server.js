const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// DB初期化
const db = new Database(path.join(__dirname, 'data.db'));
initDatabase(db);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ルート
app.use('/api/rooms',    require('./routes/rooms')(db));
app.use('/api/waitlist', require('./routes/waitlist')(db));
app.use('/api/notify',   require('./routes/notify')(db));
app.use('/api/batch',    require('./routes/batch')(db));
app.use('/api/settings', require('./routes/settings')(db));
app.use('/auth',         require('./routes/auth')(db));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`OHR LINE通知管理システム起動 → http://localhost:${PORT}`);
});

// ===== DB初期化 =====
function initDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id      TEXT NOT NULL,
      hotel_name    TEXT NOT NULL,
      room_type     TEXT NOT NULL,
      room_type_name TEXT NOT NULL,
      check_in_date TEXT NOT NULL,
      available     INTEGER DEFAULT 0,
      price         INTEGER DEFAULT 0,
      updated_at    TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(hotel_id, room_type, check_in_date)
    );

    CREATE TABLE IF NOT EXISTS vacancy_waitlist (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id      TEXT NOT NULL,
      hotel_name    TEXT NOT NULL,
      room_type     TEXT,
      check_in_date TEXT NOT NULL,
      user_name     TEXT NOT NULL,
      line_id       TEXT NOT NULL,
      registered_at TEXT DEFAULT (datetime('now', 'localtime')),
      status        TEXT DEFAULT 'waiting'
    );

    CREATE TABLE IF NOT EXISTS cancel_waitlist (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id      TEXT NOT NULL,
      hotel_name    TEXT NOT NULL,
      room_type     TEXT,
      check_in_date TEXT NOT NULL,
      user_name     TEXT NOT NULL,
      line_id       TEXT NOT NULL,
      registered_at TEXT DEFAULT (datetime('now', 'localtime')),
      status        TEXT DEFAULT 'waiting'
    );

    CREATE TABLE IF NOT EXISTS notify_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      notify_type    TEXT NOT NULL,
      hotel_name     TEXT NOT NULL,
      check_in_date  TEXT,
      recipient_name TEXT NOT NULL,
      line_id        TEXT NOT NULL,
      sent_at        TEXT DEFAULT (datetime('now', 'localtime')),
      status         TEXT DEFAULT 'sent'
    );

    CREATE TABLE IF NOT EXISTS delivery_settings (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      type   TEXT UNIQUE NOT NULL,
      name   TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      hour   INTEGER DEFAULT 18,
      minute INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS batch_settings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      schedule_day  TEXT DEFAULT '*',
      schedule_dow  TEXT DEFAULT '*',
      schedule_hour INTEGER DEFAULT 17,
      schedule_min  INTEGER DEFAULT 0,
      status        TEXT DEFAULT 'standby',
      last_start    TEXT,
      last_end      TEXT
    );
  `);

  // 初期データ
  const delCount = db.prepare('SELECT COUNT(*) as c FROM delivery_settings').get().c;
  if (delCount === 0) {
    const ins = db.prepare('INSERT INTO delivery_settings (type, name, status, hour, minute) VALUES (?,?,?,?,?)');
    ins.run('vacancy', '空室待ち配信',     'active', 18, 0);
    ins.run('cancel',  'キャンセル待ち配信', 'active', 17, 0);
  }

  const batchCount = db.prepare('SELECT COUNT(*) as c FROM batch_settings').get().c;
  if (batchCount === 0) {
    db.prepare(`INSERT INTO batch_settings
      (name, schedule_day, schedule_dow, schedule_hour, schedule_min, status, last_start, last_end)
      VALUES (?,?,?,?,?,?,?,?)`)
    .run('空室マスターデータ取得', '*', '*', 17, 0, 'standby',
         '2026-07-17 17:00:04', '2026-07-17 17:20:17');
  }

  // ダミーの空室データを入れる（初回のみ）
  const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms').get().c;
  if (roomCount === 0) {
    const insertRoom = db.prepare(`INSERT OR IGNORE INTO rooms
      (hotel_id, hotel_name, room_type, room_type_name, check_in_date, available, price)
      VALUES (?,?,?,?,?,?,?)`);
    loadSeedRooms(insertRoom);
  }

}

function loadSeedRooms(insertRoom) {
  const hotels = [
    { id:'FAN001', name:'FANTIC HOTEL 熱海' },
    { id:'FAN002', name:'FANTIC HOTEL 箱根' },
    { id:'FAN003', name:'FANTIC HOTEL 札幌' },
    { id:'FAN004', name:'FANTIC HOTEL 沖縄' },
  ];
  const types = [
    { code:'STD', name:'スタンダードルーム', price:38000 },
    { code:'DLX', name:'デラックスルーム',   price:55000 },
    { code:'STE', name:'スイートルーム',     price:88000 },
  ];

  const base = new Date('2026-07-18');
  for (let d = 0; d < 90; d++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + d);
    const dateStr = dt.toISOString().slice(0, 10);
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;

    for (const h of hotels) {
      for (const t of types) {
        // 土日・繁忙日は在庫少なめ or 0
        let avail = isWeekend ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 4) + 1;
        // 6ヶ月超は受付前（在庫-1で区別）
        const sixMonths = new Date('2026-07-17');
        sixMonths.setMonth(sixMonths.getMonth() + 6);
        if (dt > sixMonths) avail = -1;

        insertRoom.run(h.id, h.name, t.code, t.name, dateStr, avail, t.price + (isWeekend ? 10000 : 0));
      }
    }
  }
}

