const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();

app.use(express.static('static'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server: server });

wss.on('connection', function connection(ws, req) {
  console.log('New connection from', req.connection.remoteAddress);
  ws.on('close', function close() {
    console.log('Connection closed from', req.connection.remoteAddress);
  });
});


if (process.env.DEBUG) {
  const reload = require('reload');
  reload(app);
}

server.listen(8080, function listening() {
  console.log('Listening on %d', server.address().port);
});
