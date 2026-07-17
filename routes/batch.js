const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // GET /api/batch — バッチ設定一覧
  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM batch_settings').all());
  });

  // PUT /api/batch/:id — バッチ設定更新
  router.put('/:id', (req, res) => {
    const { schedule_day, schedule_dow, schedule_hour, schedule_min, status } = req.body;
    db.prepare(`UPDATE batch_settings SET
      schedule_day = ?, schedule_dow = ?,
      schedule_hour = ?, schedule_min = ?, status = ?
      WHERE id = ?`)
    .run(schedule_day, schedule_dow, schedule_hour, schedule_min, status, req.params.id);
    res.json({ success: true });
  });

  // POST /api/batch/:id/run — 即時実行（CSVインポートを再実行するイメージ）
  router.post('/:id/run', (req, res) => {
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ');
    db.prepare('UPDATE batch_settings SET last_start = ?, status = ? WHERE id = ?')
      .run(now, 'running', req.params.id);

    // 処理を模擬（実際はCSVインポートや在庫チェックが入る）
    setTimeout(() => {
      const end = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ');
      db.prepare('UPDATE batch_settings SET last_end = ?, status = ? WHERE id = ?')
        .run(end, 'standby', req.params.id);
    }, 2000);

    res.json({ success: true, started_at: now });
  });

  return router;
};
