const express = require('express');
const https   = require('https');
const qs      = require('querystring');

module.exports = function(db) {
  const router = express.Router();

  const CLIENT_ID     = process.env.LINE_LOGIN_CHANNEL_ID;
  const CLIENT_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET;
  const CALLBACK_URL  = process.env.LINE_CALLBACK_URL || 'https://ohr-line-notify.onrender.com/auth/line/callback';

  // ── LINE Login 開始 ────────────────────────────────────────
  // GET /auth/line?type=cancel&hotelId=OHR001&hotelName=...&roomType=STD&date=2026-07-19
  router.get('/line', (req, res) => {
    const { type, hotelId, hotelName, roomType, date } = req.query;

    // stateに登録情報を詰め込む（base64url）
    const state = Buffer.from(JSON.stringify({ type, hotelId, hotelName, roomType, date }))
                        .toString('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     CLIENT_ID,
      redirect_uri:  CALLBACK_URL,
      state,
      scope: 'profile openid',
    });

    res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
  });

  // ── LINE コールバック ───────────────────────────────────────
  // GET /auth/line/callback?code=...&state=...
  router.get('/line/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect('/confirm.html?status=cancel');
    }

    try {
      // stateデコード
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());

      // アクセストークン取得
      const tokenRes = await httpPost('https://api.line.me/oauth2/v2.1/token', {
        grant_type:    'authorization_code',
        code,
        redirect_uri:  CALLBACK_URL,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      });

      if (!tokenRes.access_token) {
        throw new Error('token取得失敗: ' + JSON.stringify(tokenRes));
      }

      // プロフィール取得（userId, displayName）
      const profile = await httpGet('https://api.line.me/v2/profile', tokenRes.access_token);
      const lineUserId    = profile.userId;
      const displayName   = profile.displayName;

      const { type, hotelId, hotelName, roomType, date } = stateData;

      // waitlistに登録
      if (type === 'cancel') {
        db.prepare(`INSERT INTO cancel_waitlist
          (hotel_id, hotel_name, room_type, check_in_date, user_name, line_id)
          VALUES (?,?,?,?,?,?)`)
          .run(hotelId, hotelName || '', roomType || 'ALL', date, displayName, lineUserId);
      } else {
        // vacancy / preopen 両方ともvacancy_waitlist
        db.prepare(`INSERT INTO vacancy_waitlist
          (hotel_id, hotel_name, room_type, check_in_date, user_name, line_id)
          VALUES (?,?,?,?,?,?)`)
          .run(hotelId, hotelName || '', roomType || 'ALL', date, displayName, lineUserId);
      }

      const redirectParams = new URLSearchParams({
        status:  'ok',
        type:    type || '',
        hotel:   hotelName || '',
        date:    date || '',
        name:    displayName,
      });
      res.redirect(`/confirm.html?${redirectParams}`);

    } catch (err) {
      console.error('LINE callback error:', err);
      res.redirect('/confirm.html?status=error');
    }
  });

  return router;
};

// ── HTTP helpers（依存ゼロ）────────────────────────────────────

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data    = qs.stringify(body);
    const urlObj  = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(JSON.parse(buf)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(JSON.parse(buf)));
    });
    req.on('error', reject);
    req.end();
  });
}
