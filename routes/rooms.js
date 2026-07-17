const express = require('express');
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });

module.exports = function(db) {
  const router = express.Router();

  // GET /api/rooms?hotel_id=&date_from=&date_to=
  router.get('/', (req, res) => {
    const { hotel_id, date_from, date_to } = req.query;
    let sql = 'SELECT * FROM rooms WHERE 1=1';
    const params = [];
    if (hotel_id)  { sql += ' AND hotel_id = ?';       params.push(hotel_id); }
    if (date_from) { sql += ' AND check_in_date >= ?'; params.push(date_from); }
    if (date_to)   { sql += ' AND check_in_date <= ?'; params.push(date_to); }
    sql += ' ORDER BY check_in_date, hotel_id, room_type';
    res.json(db.prepare(sql).all(...params));
  });

  // GET /api/rooms/hotels — ホテル一覧
  router.get('/hotels', (req, res) => {
    const rows = db.prepare('SELECT DISTINCT hotel_id, hotel_name FROM rooms ORDER BY hotel_id').all();
    res.json(rows);
  });

  // POST /api/rooms/import — CSVインポート
  router.post('/import', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });

    const text = req.file.buffer.toString('utf-8');
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    const insert = db.prepare(`INSERT OR REPLACE INTO rooms
      (hotel_id, hotel_name, room_type, room_type_name, check_in_date, available, price, updated_at)
      VALUES (?,?,?,?,?,?,?,datetime('now','localtime'))`);

    const importMany = db.transaction((rows) => {
      let count = 0;
      for (const line of rows) {
        const cols = line.split(',').map(c => c.trim());
        if (cols.length < 6) continue;
        const row = {};
        headers.forEach((h, i) => row[h] = cols[i]);
        insert.run(
          row.hotel_id, row.hotel_name, row.room_type,
          row.room_type_name, row.check_in_date,
          parseInt(row.available_rooms ?? row.available ?? 0),
          parseInt(row.price ?? 0)
        );
        count++;
      }
      return count;
    });

    const count = importMany(lines.slice(1).filter(l => l.trim()));

    // バッチの最終実行時刻を更新
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ');
    db.prepare(`UPDATE batch_settings SET last_start = ?, last_end = ? WHERE id = 1`)
      .run(now, now);

    res.json({ success: true, imported: count });
  });

  return router;
};
