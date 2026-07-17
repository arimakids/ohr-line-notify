const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // 通知送信（1件）
  // POST /api/notify/send  { type: 'vacancy'|'cancel', id: number }
  router.post('/send', (req, res) => {
    const { type, id } = req.body;
    if (!type || !id) return res.status(400).json({ error: 'type と id が必要です' });

    const table = type === 'vacancy' ? 'vacancy_waitlist' : 'cancel_waitlist';
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: '登録者が見つかりません' });

    // ステータスを更新
    db.prepare(`UPDATE ${table} SET status = 'notified' WHERE id = ?`).run(id);

    // 通知履歴に追加
    const typeLabel = type === 'vacancy' ? '空室待ち' : 'キャンセル待ち';
    db.prepare(`INSERT INTO notify_history (notify_type, hotel_name, check_in_date, recipient_name, line_id)
      VALUES (?,?,?,?,?)`)
    .run(typeLabel, row.hotel_name, row.check_in_date, row.user_name, row.line_id);

    res.json({ success: true, message: `${row.user_name} にLINE通知を送信しました（デモ）` });
  });

  // 一括通知送信
  // POST /api/notify/send-all  { type: 'vacancy'|'cancel' }
  router.post('/send-all', (req, res) => {
    const { type } = req.body;
    if (!type) return res.status(400).json({ error: 'type が必要です' });

    const table = type === 'vacancy' ? 'vacancy_waitlist' : 'cancel_waitlist';
    const waiting = db.prepare(`SELECT * FROM ${table} WHERE status = 'waiting'`).all();
    if (waiting.length === 0) {
      return res.json({ success: true, sent: 0, message: '未通知の登録者はいません' });
    }

    const typeLabel = type === 'vacancy' ? '空室待ち' : 'キャンセル待ち';
    const insHistory = db.prepare(`INSERT INTO notify_history
      (notify_type, hotel_name, check_in_date, recipient_name, line_id)
      VALUES (?,?,?,?,?)`);

    const sendAll = db.transaction(() => {
      for (const row of waiting) {
        db.prepare(`UPDATE ${table} SET status = 'notified' WHERE id = ?`).run(row.id);
        insHistory.run(typeLabel, row.hotel_name, row.check_in_date, row.user_name, row.line_id);
      }
    });
    sendAll();

    res.json({ success: true, sent: waiting.length, message: `${waiting.length}名に一括送信しました（デモ）` });
  });

  // 通知履歴取得
  // GET /api/notify/history?type=&limit=50
  router.get('/history', (req, res) => {
    const { type, limit } = req.query;
    let sql = 'SELECT * FROM notify_history WHERE 1=1';
    const params = [];
    if (type) { sql += ' AND notify_type = ?'; params.push(type); }
    sql += ' ORDER BY sent_at DESC LIMIT ?';
    params.push(parseInt(limit) || 100);
    res.json(db.prepare(sql).all(...params));
  });

  return router;
};
