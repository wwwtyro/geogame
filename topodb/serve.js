"use strict";

const express = require('express');
const sqlite3 = require('better-sqlite3');

const app = express();

const db = new sqlite3('nodes.sqlite3');

app.get('/tile/:id', function(req, res) {
  const row = db.prepare(`SELECT node FROM nodes WHERE id=?`).get(req.params.id);
  res.send(row.node);
});

app.listen(process.argv[2] || true, function() {
  console.log('Listening');
})

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
});
