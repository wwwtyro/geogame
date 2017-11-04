"use strict";

const express = require('express');
const sqlite3 = require('better-sqlite3');
const cors = require('cors');

const app = express();

app.use(cors());

const db = new sqlite3('nodes.sqlite3');
const db_color = new sqlite3('colors.sqlite3');

app.get('/tile/:id', function(req, res, next) {
  const row = db.prepare(`SELECT node FROM nodes WHERE id=?`).get(req.params.id);
  res.send(row.node);
});

app.get('/complete/:id', function(req, res, next) {
  let node = db.prepare(`SELECT node FROM nodes WHERE id=?`).get(req.params.id);
  let color = db_color.prepare(`SELECT node FROM colors WHERE id=?`).get(req.params.id);
  node = JSON.parse(node.node);
  color = JSON.parse(color.node);
  res.send(JSON.stringify({
    id: node.id,
    resolution: node.resolution,
    elevations: node.elevations,
    color: color.colors,
  }));
});

app.listen(process.argv[2] || true, function() {
  console.log('Listening');
})

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
});
