const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const vec3 = require('gl-matrix').vec3;
const tilebelt = require('@mapbox/tilebelt');

const QuadSphere = require('../common/quadsphere');
const constants = require('../common/constants');

const qs = new QuadSphere(constants.earthRadius);

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

let a = [];
for (let i = 0; i < 65536; i++) {
  a.push(Math.random());
}

app.get('/bintest', function (req, res) {
  res.type('octet-stream');
  res.write(new Buffer(new Float32Array(a).buffer), 'binary');
  res.end(null, 'binary');
});



app.get('/node/:id', async function(req, res) {
  if (req.params.id.length !== 14) {
    console.log('Incorrect node depth, assploding.');
    return;
  }
  const node = qs.nodeFromId(req.params.id);

  const resolution = 256;
  const neededTiles = {};
  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      let q = node._transformUnitCube([node.sw[0] + node.size * i/resolution, node.sw[1] + node.size * j/resolution]);
      q = vec3.normalize([], q);
      const ll = pointToLonLat(q);
      const tile = tilebelt.pointToTile(ll.lon, ll.lat, 13);
      neededTiles[tile] = tile;
    }
  }

  const gp = require('get-pixels');

  function loadTile(tile) {
    return new Promise(function(resolve, reject) {
      gp(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${tile[2]}/${tile[0]}/${tile[1]}.png`, function(err, pixels) {
        if (err) {
          reject(err);
        }
        resolve(pixels);
      });
    });
  }

  const promises = {};
  for (let key of Object.keys(neededTiles)) {
    promises[key] = loadTile(neededTiles[key]);
  }

  const pixels = {};
  for (let key of Object.keys(promises)) {
    pixels[key] = await promises[key];
  }

  const values = [];
  const rgbs = [];
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      let q = node._transformUnitCube([node.sw[0] + node.size * i/resolution, node.sw[1] + node.size * j/resolution]);
      q = vec3.normalize([], q);
      const ll = pointToLonLat(q);
      const tile = tilebelt.pointToTileFraction(ll.lon, ll.lat, 13);
      const tf = [tile[0] - Math.floor(tile[0]), tile[1] - Math.floor(tile[1])];
      tf[0] = Math.floor(tf[0] * 256);
      tf[1] = Math.floor(tf[1] * 256);
      const key = tile.map(a => Math.floor(a));
      const r = pixels[key].get(tf[0], tf[1], 0);
      const g = pixels[key].get(tf[0], tf[1], 1);
      const b = pixels[key].get(tf[0], tf[1], 2);
      rgbs.push([r,g,b]);
      const e = Math.max(0, (r * 256 + g + b / 256) - 32768);
      values.push(e);
    }
  }

  res.write(new Buffer(new Float32Array(values).buffer), 'binary');
  res.end(null, 'binary');


  
});

if (process.env.DEBUG) {
  const reload = require('reload');
  reload(app);
}

server.listen(8080, function listening() {
  console.log('Listening on %d', server.address().port);
});


function pointToLonLat(p) {
  const pi = Math.PI;
  const twopi = 2 * pi;
  p = vec3.normalize([], p);
  const y = p[0];
  const z = p[1]
  const x = p[2];
  const theta = Math.acos(z);
  const phi = Math.atan2(y,x);
  return {
    lon: 360 * (phi + pi)/twopi - 180,
    lat: 90 - 180 * theta/pi
  };
}
