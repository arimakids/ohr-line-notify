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

  // ダミーの待機リストデータ
  const vCount = db.prepare('SELECT COUNT(*) as c FROM vacancy_waitlist').get().c;
  if (vCount === 0) loadSeedWaitlist(db);
}

function loadSeedRooms(insertRoom) {
  const hotels = [
    { id:'OHR001', name:'FANTIC HOTEL 熱海' },
    { id:'OHR002', name:'FANTIC HOTEL 箱根' },
    { id:'OHR003', name:'FANTIC HOTEL 札幌' },
    { id:'OHR004', name:'FANTIC HOTEL 沖縄' },
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

function loadSeedWaitlist(db) {
  const vIns = db.prepare(`INSERT INTO vacancy_waitlist
    (hotel_id, hotel_name, room_type, check_in_date, user_name, line_id, registered_at, status)
    VALUES (?,?,?,?,?,?,?,?)`);
  vIns.run('OHR001','FANTIC HOTEL 熱海','STD','2027-01-01','田中 花子','@tanaka_h','2026-06-01 10:22','waiting');
  vIns.run('OHR001','FANTIC HOTEL 熱海','DLX','2027-01-01','山田 太郎','@yamada_t','2026-06-01 11:05','waiting');
  vIns.run('OHR002','FANTIC HOTEL 箱根','STD','2027-01-02','鈴木 一郎','@suzuki_i','2026-05-30 14:18','notified');
  vIns.run('OHR002','FANTIC HOTEL 箱根','STD','2027-01-02','佐藤 美咲','@sato_m',  '2026-05-31 09:44','waiting');
  vIns.run('OHR003','FANTIC HOTEL 札幌','DLX','2027-01-03','伊藤 健司','@ito_k',   '2026-06-02 08:30','waiting');

  const cIns = db.prepare(`INSERT INTO cancel_waitlist
    (hotel_id, hotel_name, room_type, check_in_date, user_name, line_id, registered_at, status)
    VALUES (?,?,?,?,?,?,?,?)`);
  cIns.run('OHR001','FANTIC HOTEL 熱海','STD','2026-07-19','田中 花子','@tanaka_h','2026-06-01 10:22','waiting');
  cIns.run('OHR001','FANTIC HOTEL 熱海','DLX','2026-07-19','山田 太郎','@yamada_t','2026-06-01 11:05','waiting');
  cIns.run('OHR002','FANTIC HOTEL 箱根','STD','2026-07-20','鈴木 一郎','@suzuki_i','2026-05-30 14:18','waiting');
  cIns.run('OHR003','FANTIC HOTEL 札幌','STD','2026-07-19','伊藤 健司','@ito_k',   '2026-06-02 08:30','notified');
}
