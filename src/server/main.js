const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const vec3 = require('gl-matrix').vec3;
const tilebelt = require('@mapbox/tilebelt');
const sqlite3 = require('better-sqlite3');
const ndarray = require('ndarray');
const gp = require('get-pixels');
const uuid4 = require('uuid/v4');

const QuadSphere = require('../common/quadsphere');
const constants = require('../common/constants');

const emptyTile = ndarray(new Float32Array(256*256*4).fill(0), [256,256,4], [4,1024,1]);

const db = new sqlite3('nodes.sqlite3');
db.prepare(`CREATE TABLE IF NOT EXISTS nodes (id VARCHAR, node BLOB);`).run();
db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idindex ON nodes (id);`).run();
db.pragma(`synchronous=OFF;`);

const db_tiles = new sqlite3('tiles.sqlite3');
db_tiles.prepare(`CREATE TABLE IF NOT EXISTS tiles (id VARCHAR, tile BLOB, shape VARCHAR, stride VARCHAR);`).run();
db_tiles.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idindex ON tiles (id);`).run();
db_tiles.pragma(`synchronous=OFF;`);

const qs = new QuadSphere(constants.earthRadius);

const app = express();

app.use(express.static('static'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server: server });

const sockets = {};

wss.on('connection', function connection(ws, req) {
  console.log('New connection from', req.connection.remoteAddress);
  ws.__id = uuid4();
  for (let __id in sockets) {
    ws.send(JSON.stringify({
      type: 'enter',
      id: __id,
    }));
    const socket = sockets[__id];
    socket.send(JSON.stringify({
      type: 'enter',
      id: ws.__id,
    }));
  }
  sockets[ws.__id] = ws;
  ws.on('close', function close() {
    console.log('Connection closed from', req.connection.remoteAddress);
    delete sockets[ws.__id];
    for (let __id in sockets) {
      if (__id === ws.__id) continue;
      const socket = sockets[__id];
      socket.send(JSON.stringify({
        type: 'exit',
        id: ws.__id,
      }));
    }
  });
  ws.on('message', function(data) {
    data = JSON.parse(data);
    if (data.type === 'location') {
      for (let __id in sockets) {
        if (__id === ws.__id) continue;
        const socket = sockets[__id];
        socket.send(JSON.stringify({
          type: 'location',
          id: ws.__id,
          position: data.position,
          theta: data.theta,
          phi: data.phi,
        }));
      }
    }
  });
});


app.get('/node-json/:id', async function(req, res) {
  const values = await loadNode(req.params.id);
  const arr = new Float32Array(values);
  let index = 0;
  const arr2 = [];
  const resl = constants.nodeResolution;
  for (let i = 0; i < resl; i++) {
    const arri = [];
    arr2.push(arri);
    for (let j = 0; j < resl; j++) {
      arri.push(values[index]);
      index++;
    }
  }
  res.send(JSON.stringify(arr2));
});


app.get('/node/:id', async function(req, res) {
  console.log(req.params.id);
  const values = await loadNode(req.params.id);
  // Ship it to the user.
  res.write(values, 'binary');
  res.end(null, 'binary');
});

if (process.env.DEBUG) {
  const reload = require('reload');
  reload(app);
}

process.on('unhandledRejection', r => console.log(r));

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


async function loadNode(id) {
  // Try to load the heightfield from the db.
  const stored = db.prepare(`SELECT node FROM nodes WHERE id=?`).get(id);
  // If we have it, ship it off and return.
  if (stored) {
    return stored.node;
  }
  // We didn't have it, so we're gonna build it. Let's keep track of how long it takes.
  const t0 = new Date().getTime();
  // Get the abstract node from the quadsphere by its ID.
  const node = qs.nodeFromId(id);
  // Get the resolution of the nodes (points along a single edge).
  const resolution = constants.nodeResolution;
  // Let's make a list of the tiles we need to build this heightmap.
  const neededTiles = {};
  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      let q = node._transformUnitCube([node.sw[0] + node.size * i/(resolution-1), node.sw[1] + node.size * j/(resolution-1)]);
      q = vec3.normalize([], q);
      const ll = pointToLonLat(q);
      const tile = tilebelt.pointToTile(ll.lon, ll.lat, node.mapdepth);
      neededTiles[tile] = tile;
    }
  }
  // Now let's make a list of the raw 256x256 heightmap info that we get from aws.
  const pixels = {};
  for (let key of Object.keys(neededTiles)) {
    try {
      // Try to load it, but if we fail, just use an empty tile.
      pixels[key] = await loadTile(neededTiles[key]);
    } catch (err) {
      // console.error(`Error loading tile ${neededTiles[key]}: ${err}`);
      pixels[key] = emptyTile;
    }
  }
  // Now let's build the heightmap. We'll need an array to store the height values in.
  const values = [];
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      let q = node._transformUnitCube([node.sw[0] + node.size * i/(resolution-1), node.sw[1] + node.size * j/(resolution-1)]);
      q = vec3.normalize([], q);
      const ll = pointToLonLat(q);
      const tile = tilebelt.pointToTileFraction(ll.lon, ll.lat, node.mapdepth);
      const tf = [tile[0] - Math.floor(tile[0]), tile[1] - Math.floor(tile[1])];
      tf[0] = Math.floor(tf[0] * 256);
      tf[1] = Math.floor(tf[1] * 256);
      const key = tile.map(a => Math.floor(a));
      try {
        const r = pixels[key].get(tf[0], tf[1], 0);
        const g = pixels[key].get(tf[0], tf[1], 1);
        const b = pixels[key].get(tf[0], tf[1], 2);
        const e = Math.max(0, (r * 256 + g + b / 256) - 32768);
        values.push(e);
      } catch (err) {
        console.error(`Error getting tile ${key} data: ${err}`);
        values.push(0);
      }
    }
  }
  // Insert the heightmap into the database.
  db.prepare(`INSERT OR REPLACE INTO nodes (id, node) VALUES (?, ?);`).run(node.id, new Buffer(new Float32Array(values).buffer));
  // Log how long it took to build the heightmap.
  console.log(`Prepared node in ${(new Date().getTime() - t0)/1000}s.`);
  return new Buffer(new Float32Array(values).buffer);
}


function loadTile(tile) {
  return new Promise(function(resolve, reject) {
    // If any of the tiles are negative, simply use the emptyTile.
    if (tile[0] < 0 || tile[1] < 0 || tile[2] < 0) {
      resolve(emptyTile);
      return
    }
    // If we have the tile in the db already. If so, return it.
    const stored = db_tiles.prepare(`SELECT * FROM tiles WHERE id=?`).get(tile.toString());
    if (stored) {
      console.log(`Loading tile ${tile}.`)
      resolve(ndarray(new Float32Array(stored.tile), JSON.parse(stored.shape), JSON.parse(stored.stride)));
      return;
    }
    // We'll have to get it from AWS.
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${tile[2]}/${tile[0]}/${tile[1]}.png`;
    console.log(`Downloading tile ${tile}: ${url}`)
    gp(url, function(err, pixels) {
      // Oops, there was some issue getting it from AWS. Let's just assume they didn't have that one and return the emptyTile.
      if (err) {
        console.log(`Error downloading tile ${tile}. Assuming empty tile.`)
        resolve(emptyTile);
        return;
      }
      // Great, we got it. Let's store it for the next time we need it.
      db_tiles.prepare(`INSERT OR REPLACE INTO tiles (id, tile, shape, stride) VALUES (?, ?, ?, ?);`)
        .run(tile.toString(), new Buffer(pixels.data), JSON.stringify(pixels.shape), JSON.stringify(pixels.stride));
      // And ship it back.
      resolve(pixels);
    });
  });
}
