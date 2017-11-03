"use strict";

const express = require('express');
const sqlite3 = require('sqlite3');

const app = express();
const db = new sqlite3.Database('nodes.sqlite3');

app.get('/tile/:id', function(req, res) {
  db.get(`SELECT node FROM nodes WHERE id = '${req.params.id}'`, function(err, node) {
    if (!err) {
      if (node) {
        res.send(node.node)
      } else {
        res.send('No such node.')
      }
    } else {
      res.send(err);
    }
  });
});

app.listen(8001, function() {
  console.log('Listening');
})

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
});
