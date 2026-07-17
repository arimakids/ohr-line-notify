const express = require('express');
const https   = require('https');

module.exports = function(db) {
  const router = express.Router();
  const TOKEN  = process.env.LINE_MESSAGING_TOKEN;

  // ── 実際のLINE push送信 ──────────────────────────────────────

  // POST /api/notify/vacancy  { hotel_id, check_in_date }
  // 空室待ちユーザーに一斉プッシュ（空室発生時に呼ぶ）
  router.post('/vacancy', async (req, res) => {
    const { hotel_id, check_in_date } = req.body;
    const users = db.prepare(
      `SELECT * FROM vacancy_waitlist WHERE hotel_id=? AND check_in_date=? AND status='waiting'`
    ).all(hotel_id, check_in_date);

    if (users.length === 0) return res.json({ sent: 0 });

    const room = db.prepare(
      `SELECT * FROM rooms WHERE hotel_id=? AND check_in_date=? AND available > 0 LIMIT 1`
    ).get(hotel_id, check_in_date);

    let sent = 0, failed = 0;
    for (const user of users) {
      try {
        await pushMessage(TOKEN, user.line_id, vacancyMessages(room || user));
        db.prepare(`UPDATE vacancy_waitlist SET status='notified' WHERE id=?`).run(user.id);
        db.prepare(`INSERT INTO notify_history (notify_type, hotel_name, check_in_date, recipient_name, line_id)
          VALUES (?,?,?,?,?)`).run('空室待ち', user.hotel_name, user.check_in_date, user.user_name, user.line_id);
        sent++;
      } catch (e) {
        console.error('push error vacancy:', e.message);
        failed++;
      }
    }
    res.json({ sent, failed });
  });

  // POST /api/notify/cancel  { hotel_id, check_in_date }
  // キャンセル待ちユーザーに一斉プッシュ（キャンセル発生時に呼ぶ）
  router.post('/cancel', async (req, res) => {
    const { hotel_id, check_in_date } = req.body;
    const users = db.prepare(
      `SELECT * FROM cancel_waitlist WHERE hotel_id=? AND check_in_date=? AND status='waiting'`
    ).all(hotel_id, check_in_date);

    if (users.length === 0) return res.json({ sent: 0 });

    const room = db.prepare(
      `SELECT * FROM rooms WHERE hotel_id=? AND check_in_date=? LIMIT 1`
    ).get(hotel_id, check_in_date);

    let sent = 0, failed = 0;
    for (const user of users) {
      try {
        await pushMessage(TOKEN, user.line_id, cancelMessages(room || user));
        db.prepare(`UPDATE cancel_waitlist SET status='notified' WHERE id=?`).run(user.id);
        db.prepare(`INSERT INTO notify_history (notify_type, hotel_name, check_in_date, recipient_name, line_id)
          VALUES (?,?,?,?,?)`).run('キャンセル待ち', user.hotel_name, user.check_in_date, user.user_name, user.line_id);
        sent++;
      } catch (e) {
        console.error('push error cancel:', e.message);
        failed++;
      }
    }
    res.json({ sent, failed });
  });

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

// ── メッセージ定義 ────────────────────────────────────────────

function vacancyMessages(r) {
  return [{ type: 'text', text: [
    '🎉 空室が出ました！',
    '',
    `🏨 ${r.hotel_name}`,
    `📅 ${r.check_in_date}（チェックイン）`,
    '',
    'ご希望のお部屋をお早めにご予約ください。',
    '※先着順となります',
  ].join('\n') }];
}

function cancelMessages(r) {
  return [{ type: 'text', text: [
    '🔔 キャンセルが出ました！',
    '',
    `🏨 ${r.hotel_name}`,
    `📅 ${r.check_in_date}（チェックイン）`,
    '',
    'ご希望のお部屋をお早めにご予約ください。',
    '※先着順となります',
  ].join('\n') }];
}

// ── LINE Messaging API push helper ───────────────────────────

function pushMessage(token, to, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ to, messages });
    const req  = https.request({
      hostname: 'api.line.me',
      path:     '/v2/bot/message/push',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`LINE API ${res.statusCode}: ${buf}`));
        else resolve(JSON.parse(buf || '{}'));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
