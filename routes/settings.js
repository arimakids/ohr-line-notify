const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // GET /api/settings/delivery
  router.get('/delivery', (req, res) => {
    res.json(db.prepare('SELECT * FROM delivery_settings').all());
  });

  // PUT /api/settings/delivery/:id
  router.put('/delivery/:id', (req, res) => {
    const { status, hour, minute } = req.body;
    db.prepare('UPDATE delivery_settings SET status = ?, hour = ?, minute = ? WHERE id = ?')
      .run(status, hour, minute, req.params.id);
    res.json({ success: true });
  });

  return router;
};
