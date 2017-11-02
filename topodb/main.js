'use strict';

const fs = require('fs');
const execSync = require('child_process').execSync;
const download = require('download');
const vec3 = require('gl-matrix').vec3
const getpixels = require('get-pixels');
const quadtree = require('../quadtree');

const PI = Math.PI;
const TIFSIZE = 10800;
const WIDTH = TIFSIZE*4;
const MAXWIDTH = WIDTH - 1e-11;
const HEIGHT = TIFSIZE*2;
const MAXHEIGHT = HEIGHT - 1e-11;
const TILESIZE = TIFSIZE;
const TILECOUNT = TIFSIZE/TILESIZE;
const NODERES = 32;
const EARTHRADIUS = 6371000;

let tileCache = {};

main();

async function main() {

  if (!fs.existsSync('tifs')){
    fs.mkdirSync('tifs');
  }

  const tifs = {
    'a1.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_A1_grey_geo.tif',
    'a2.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_A2_grey_geo.tif',
    'b1.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_B1_grey_geo.tif',
    'b2.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_B2_grey_geo.tif',
    'c1.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_C1_grey_geo.tif',
    'c2.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_C2_grey_geo.tif',
    'd1.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_D1_grey_geo.tif',
    'd2.tif': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_D2_grey_geo.tif',
  };

  for (let tif in tifs) {
    if (fs.existsSync(`tifs/${tif}`)) continue;
    console.log(`Downloading ${tif}...`)
    await download(tifs[tif], `tifs`, {filename: tif});
  }

  if (!fs.existsSync('pngs')){
    fs.mkdirSync('pngs');
  }

  for (let tif in tifs) {
    let key = tif.split('.')[0];
    if (fs.existsSync(`pngs/${key}_tile_1_1.png`)) continue;
    console.log(`Converting ${tif}...`);
    execSync(`convert tifs/${tif} -crop ${TILESIZE}x${TILESIZE} -set filename:tile "%[fx:page.x/${TILESIZE}+1]_%[fx:page.y/${TILESIZE}+1]" +repage +adjoin "pngs/${key}_tile_%[filename:tile].png"`);
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

  if (!fs.existsSync('tiles')){
    fs.mkdirSync('tiles');
  }

  for (let letter in letters) {
    const offx = letters[letter];
    for (let number in numbers) {
      const offy = numbers[number];
      const key = `${letter}${number}`;
      for (let tilex = 1; tilex <= TILECOUNT; tilex++) {
        for (let tiley = 1; tiley <= TILECOUNT; tiley++) {
          const source = `pngs/${letter}${number}_tile_${tilex}_${tiley}.png`;
          const x = (tilex - 1) * TILESIZE + offx;
          const y = (tiley - 1) * TILESIZE + offy;
          const dest = `tiles/tile_${x}_${y}.png`;
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

  if (!fs.existsSync('nodes')){
    fs.mkdirSync('nodes');
  }

  for (let x = 0; x < WIDTH; x += TILESIZE) {
    for (let y = 0; y < HEIGHT; y+= TILESIZE) {
      console.log(x, y);
      tileCache[[x,y]] = await loadTile(x, y);
    }
  }

  for (let root of sphere) {
    // tileCache = {};
    quadtree.traverse_async(root, async function(node, depth) {
      if (!fs.existsSync(`nodes/${node.id}`)) {
        console.log(`Storing node ${node.id}...`);
        await storeNode(node);
      }
      if (depth === 6) {
        return false;
      }
      return true;
    });
  }

}

async function storeNode(node) {
  const right = vec3.scale([], node.right, 2/NODERES);
  const up = vec3.scale([], node.up, 2/NODERES);
  const elevations = create2DArray(NODERES + 1, NODERES + 1);
  for (let i = 0; i <= NODERES; i++) {
    for (let j = 0; j <= NODERES; j++) {
      let e = await elevation(vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 0)));
      elevations[i][j] = Math.round(e);
    }
  }
  fs.writeFileSync(`nodes/${node.id}.json`, JSON.stringify({
    id: node.id,
    resolution: NODERES,
    elevations: elevations,
  }));
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
  const path = `tiles/tile_${x}_${y}.png`;
  return new Promise(function(resolve, reject) {
    getpixels(path, function cb(err, pixels) {
      // Might trim pixels down later if we're running out of memory.
      resolve(pixels);
    });
  });
}

async function elevation(p) {
  let pixel = getPixel(p);
  const offx = TILESIZE * Math.floor(pixel.x/TILESIZE);
  const offy = TILESIZE * Math.floor(pixel.y/TILESIZE);
  if (!([offx, offy] in tileCache)) {
    tileCache[[offx, offy]] = await loadTile(offx, offy);
  }
  const tile = tileCache[[offx, offy]];
  return 8848 * tile.get(Math.floor(pixel.x) - offx, Math.floor(pixel.y) - offy, 0)/255;
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
