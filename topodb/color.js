'use strict';

const fs = require('fs');
const execSync = require('child_process').execSync;
const download = require('download');
const vec3 = require('gl-matrix').vec3
const getpixels = require('get-pixels');
const quadtree = require('../quadtree');
const sqlite3 = require('better-sqlite3');

const PI = Math.PI;
const TIFSIZE = 10800;
const WIDTH = TIFSIZE*4;
const MAXWIDTH = WIDTH - 1e-11;
const HEIGHT = TIFSIZE*2;
const MAXHEIGHT = HEIGHT - 1e-11;
const TILESIZE = 10800;
const TILECOUNT = TIFSIZE/TILESIZE;
const NODERES = 32;
const EARTHRADIUS = 6371000;

let tileCache = {};

main();

async function main() {

  const db = new sqlite3('colors.sqlite3');
  db.prepare(`CREATE TABLE IF NOT EXISTS colors (id VARCHAR, node TEXT);`).run();
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idindex ON colors (id);`).run();
  db.pragma(`synchronous=OFF;`);

  if (!fs.existsSync('color_jpgs')){
    fs.mkdirSync('color_jpgs');
  }

  const jpgs = {
    'a1.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.A1.jpg',
    'a2.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.A2.jpg',
    'b1.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.B1.jpg',
    'b2.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.B2.jpg',
    'c1.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.C1.jpg',
    'c2.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.C2.jpg',
    'd1.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.D1.jpg',
    'd2.jpg': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x21600.D2.jpg',
  };

  for (let jpg in jpgs) {
    if (fs.existsSync(`color_jpgs/${jpg}`)) continue;
    console.log(`Downloading ${jpg}...`)
    await download(jpgs[jpg], `color_jpgs`, {filename: jpg});
  }

  if (!fs.existsSync('color_pngs')){
    fs.mkdirSync('color_pngs');
  }

  for (let jpg in jpgs) {
    let key = jpg.split('.')[0];
    if (fs.existsSync(`color_pngs/${key}_tile_1_1.jpg`)) continue;
    console.log(`Converting ${jpg}...`);
    execSync(`convert color_jpgs/${jpg} -crop ${TILESIZE}x${TILESIZE} -set filename:tile "%[fx:page.x/${TILESIZE}+1]_%[fx:page.y/${TILESIZE}+1]" +repage +adjoin "color_pngs/${key}_tile_%[filename:tile].jpg"`);
  }

  const letters = {
    a: TIFSIZE * 0,
    b: TIFSIZE * 1,
    c: TIFSIZE * 2,
    d: TIFSIZE * 3,
  };

  const numbers = {
    1: TIFSIZE * 0,
    2: TIFSIZE * 1,
  }

  if (!fs.existsSync('color_tiles')){
    fs.mkdirSync('color_tiles');
  }

  for (let letter in letters) {
    const offx = letters[letter];
    for (let number in numbers) {
      const offy = numbers[number];
      const key = `${letter}${number}`;
      for (let tilex = 1; tilex <= TILECOUNT; tilex++) {
        for (let tiley = 1; tiley <= TILECOUNT; tiley++) {
          const source = `color_pngs/${letter}${number}_tile_${tilex}_${tiley}.jpg`;
          const x = (tilex - 1) * TILESIZE + offx;
          const y = (tiley - 1) * TILESIZE + offy;
          const dest = `color_tiles/tile_${x}_${y}.jpg`;
          fs.copyFileSync(source, dest);
        }
      }
    }
  }

  const sphere = [
    quadtree.node( // Positive X
      [ 1, -1,  1],
      [ 1, -1, -1],
      [ 1,  1, -1],
      [ 1,  1,  1],
      'px-'
    ),
    quadtree.node( // Negative X
      [-1, -1, -1],
      [-1, -1,  1],
      [-1,  1,  1],
      [-1,  1, -1],
      'nx-'
    ),
    quadtree.node( // Positive Y
      [-1,  1,  1],
      [ 1,  1,  1],
      [ 1,  1, -1],
      [-1,  1, -1],
      'py-'
    ),
    quadtree.node( // Negative Y
      [-1, -1, -1],
      [ 1, -1, -1],
      [ 1, -1,  1],
      [-1, -1,  1],
      'ny-'
    ),
    quadtree.node( // Positive Z
      [-1, -1,  1],
      [ 1, -1,  1],
      [ 1,  1,  1],
      [-1,  1,  1],
      'pz-'
    ),
    quadtree.node( // Negative Z
      [ 1, -1, -1],
      [-1, -1, -1],
      [-1,  1, -1],
      [ 1,  1, -1],
      'nz-'
    )
  ];

  // if (!fs.existsSync('nodes')){
  //   fs.mkdirSync('nodes');
  // }

  // const db = new sqlite3.Database('nodes.sqlite3');
  // db.run(`CREATE TABLE IF NOT EXISTS foo (id VARCHAR, node TEXT);`);


  for (let x = 0; x < WIDTH; x += TILESIZE) {
    for (let y = 0; y < HEIGHT; y+= TILESIZE) {
      console.log('caching tile', x, y);
      tileCache[[x,y]] = await loadTile(x, y);
    }
  }

  for (let root of sphere) {
    // tileCache = {};
    quadtree.traverse_async(root, async function(node, depth) {
      return new Promise(async function(resolve, reject) {
        console.log(`Storing node ${node.id}...`);
        await storeNode(node, db);
        if (depth === 9) {
          resolve(false);
        }
        resolve(true);
      });
    });
  }

}

async function storeNode(node, db) {
  const right = vec3.scale([], node.right, 2/NODERES);
  const up = vec3.scale([], node.up, 2/NODERES);
  const colors = create2DArray(NODERES + 1, NODERES + 1);
  for (let i = 0; i <= NODERES; i++) {
    for (let j = 0; j <= NODERES; j++) {
      colors[i][j] = await color(vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 0)));
    }
  }
  const nodeson = JSON.stringify({
    id: node.id,
    resolution: NODERES,
    colors: colors,
  });
  db.prepare(`INSERT OR REPLACE INTO colors (id, node) VALUES (?, ?);`).run(node.id, nodeson);
}


function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}


function getPixel(p) {
  p = vec3.normalize([], p);
  const y = p[0];
  const z = p[1]
  const x = p[2];
  const theta = Math.acos(z);
  const phi = Math.atan2(y,x);
  const px = WIDTH * (phi + PI)/(2 * PI);
  const py = HEIGHT * theta / PI;
  return {
    x: clamp(px, 0, MAXWIDTH),
    y: clamp(py, 0, MAXHEIGHT)
  };
}

function loadTile(x, y) {
  const path = `color_tiles/tile_${x}_${y}.jpg`;
  return new Promise(function(resolve, reject) {
    getpixels(path, function cb(err, pixels) {
      // Might trim pixels down later if we're running out of memory.
      resolve(pixels);
    });
  });
}

async function color(p) {
  let pixel = getPixel(p);
  const offx = TILESIZE * Math.floor(pixel.x/TILESIZE);
  const offy = TILESIZE * Math.floor(pixel.y/TILESIZE);
  if (!([offx, offy] in tileCache)) {
    tileCache[[offx, offy]] = await loadTile(offx, offy);
  }
  const tile = tileCache[[offx, offy]];
  const red = tile.get(Math.floor(pixel.x) - offx, Math.floor(pixel.y) - offy, 0);
  const green = tile.get(Math.floor(pixel.x) - offx, Math.floor(pixel.y) - offy, 1);
  const blue = tile.get(Math.floor(pixel.x) - offx, Math.floor(pixel.y) - offy, 2);
  return [red, green, blue];
}


function create2DArray(width, height) {
  const arr = [];
  for (let i = 0; i < width; i++) {
    let inarr = [];
    arr.push(inarr);
    for (let j = 0; j < height; j++) {
      inarr.push(0);
    }
  }
  return arr;
}
