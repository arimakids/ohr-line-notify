const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // ===== 空室待ち =====
  router.get('/vacancy', (req, res) => {
    const { hotel_id, status } = req.query;
    let sql = 'SELECT * FROM vacancy_waitlist WHERE 1=1';
    const params = [];
    if (hotel_id) { sql += ' AND hotel_id = ?'; params.push(hotel_id); }
    if (status)   { sql += ' AND status = ?';   params.push(status); }
    sql += ' ORDER BY registered_at DESC';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/vacancy', (req, res) => {
    const { hotel_id, hotel_name, room_type, check_in_date, user_name, line_id } = req.body;
    if (!hotel_id || !check_in_date || !user_name || !line_id) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }
    const result = db.prepare(`INSERT INTO vacancy_waitlist
      (hotel_id, hotel_name, room_type, check_in_date, user_name, line_id)
      VALUES (?,?,?,?,?,?)`)
    .run(hotel_id, hotel_name, room_type, check_in_date, user_name, line_id);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // ===== キャンセル待ち =====
  router.get('/cancel', (req, res) => {
    const { hotel_id, status } = req.query;
    let sql = 'SELECT * FROM cancel_waitlist WHERE 1=1';
    const params = [];
    if (hotel_id) { sql += ' AND hotel_id = ?'; params.push(hotel_id); }
    if (status)   { sql += ' AND status = ?';   params.push(status); }
    sql += ' ORDER BY registered_at DESC';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/cancel', (req, res) => {
    const { hotel_id, hotel_name, room_type, check_in_date, user_name, line_id } = req.body;
    if (!hotel_id || !check_in_date || !user_name || !line_id) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }
    const result = db.prepare(`INSERT INTO cancel_waitlist
      (hotel_id, hotel_name, room_type, check_in_date, user_name, line_id)
      VALUES (?,?,?,?,?,?)`)
    .run(hotel_id, hotel_name, room_type, check_in_date, user_name, line_id);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  return router;
};
