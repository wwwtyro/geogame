"use strict";


const tilebelt = require('@mapbox/tilebelt');
const mat4 = require('gl-matrix').mat4;
const vec3 = require('gl-matrix').vec3;
const vec2 = require('gl-matrix').vec2;
const REGL = require('regl');
const MercatorCam = require('./mercator-cam');


main();


async function main() {
  const canvas = document.getElementById('render-canvas');

  let cam = MercatorCam([-112.350699, 36.184939], 1000, 0, 0);

  // setInterval(function() {
  //   localStorage.setItem('camData', JSON.stringify(cam.dump()));
  // }, 1000);

  function handleMouseMove(e) {
    cam.lookUp(e.movementY * -0.001);
    cam.lookRight(e.movementX * 0.001);
  };

  document.addEventListener('pointerlockchange', function() {
    if (document.pointerLockElement === canvas) {
      canvas.addEventListener('mousemove', handleMouseMove);
    } else {
      canvas.removeEventListener('mousemove', handleMouseMove);
    }
  });

  canvas.addEventListener('click', function() {
    canvas.requestPointerLock();
  });

  const keyboard = {
    up: false,
    down: false,
    left: false,
    right: false,
    shift: false,
    ascend: false,
    descend: false,
  }

  window.addEventListener('keydown', function(e) {
    if (e.which === 69) keyboard.ascend = true;
    if (e.which === 81) keyboard.descend = true;
    if (e.which === 16) keyboard.shift = true;
    if (e.which === 87) keyboard.up = true;
    if (e.which === 83) keyboard.down = true;
    if (e.which === 65) keyboard.left = true;
    if (e.which === 68) keyboard.right = true;
  });

  window.addEventListener('keyup', function(e) {
    if (e.which === 69) keyboard.ascend = false;
    if (e.which === 81) keyboard.descend = false;
    if (e.which === 16) keyboard.shift = false;
    if (e.which === 87) keyboard.up = false;
    if (e.which === 83) keyboard.down = false;
    if (e.which === 65) keyboard.left = false;
    if (e.which === 68) keyboard.right = false;
  });

  const regl = REGL({
    canvas: canvas,
    extensions: ['OES_texture_float'],
  });

  const mesh = buildMesh();
  mesh.mesh = regl.buffer(mesh.mesh);
  mesh.bc = regl.buffer(mesh.bc);

  const fbHeightmap = regl.framebuffer({
    width: 512,
    height: 512,
    depth: false,
    stencil: false,
    depthstencil: false,
    colorFormat: 'rgba',
    colorType: 'float',
    colorCount: 1,
    depthTexture: false
  });

  const cHeightmap = regl({
    vert: `
    precision highp float;
    attribute vec2 position;
    attribute vec2 uv;
    uniform vec2 translation;
    varying vec2 vUV;
    void main() {
      gl_Position = vec4(position + translation, 0, 1);
      vUV = uv;
    }
    `,
    frag: `
    precision highp float;
    uniform sampler2D texture;
    varying vec2 vUV;
    void main() {
      vec3 c = texture2D(texture, vUV).rgb * 255.0;
      float h = ((c.r * 256.0 + c.g + c.b/256.0) - 32768.0);
      gl_FragColor = vec4(h,h,h,1);
    }
    `,
    attributes: {
      position: [-0.5,-0.5, 0.5,-0.5, 0.5,0.5, -0.5,-0.5, 0.5,0.5, -0.5,0.5],
      uv: [0,0, 1,0, 1,1, 0,0, 1,1, 0,1],
    },
    uniforms: {
      translation: regl.prop('translation'),
      texture: regl.prop('texture'),
    },
    viewport: regl.prop('viewport'),
    framebuffer: regl.prop('destination'),
    count: 6,
  });

  const cTerrain = regl({
    vert: `
    precision highp float;
    attribute vec3 position, bc;
    uniform mat4 model, view, projection;
    uniform sampler2D tHeightmap;
    uniform vec2 offset;
    varying vec3 vBC;
    void main() {
      float elevation = texture2D(tHeightmap, vec2(0.5)).r;
      float height = texture2D(tHeightmap, offset + position.xz + 0.5).r;
      vec3 p = vec3(offset.x + position.x, height - elevation, offset.y + position.z);
      gl_Position = projection * view * model * vec4(p, 1);
      vBC = bc;
    }
    `,
    frag: `
    precision highp float;
    varying vec3 vBC;
    void main() {
      if (any(lessThan(vBC, vec3(0.05)))) {
        gl_FragColor = vec4(1,0,1,1);
      } else {
        gl_FragColor = vec4(0,0,0,1);
      }
    }
    `,
    attributes: {
      position: regl.prop('position'),
      bc: regl.prop('bc'),
    },
    uniforms: {
      model: regl.prop('model'),
      view: regl.prop('view'),
      projection: regl.prop('projection'),
      tHeightmap: regl.prop('heightmap'),
      offset: regl.prop('offset'),
    },
    viewport: regl.prop('viewport'),
    count: regl.prop('count'),
  });

  const tileCache = {};
  const tilesInFlight = {};

  function loop() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const zoom = 8;

    const speed = keyboard.shift ? 0.01/zoom : 0.001/zoom;

    if (keyboard.ascend) {
      cam.moveUp(speed * 10000);
    }

    if (keyboard.descend) {
      cam.moveUp(speed * -10000);
    }

    if (keyboard.up) {
      cam.moveForward(speed);
    }

    if (keyboard.down) {
      cam.moveForward(-speed);
    }

    if (keyboard.left) {
      cam.moveRight(-speed);
    }

    if (keyboard.right) {
      cam.moveRight(speed);
    }

    const playerLonLat = cam.getLonLat();

    const centerTile = tilebelt.pointToTile(playerLonLat[0], playerLonLat[1], zoom);
    // console.log(centerTile);

    const tileFraction = tilebelt.pointToTileFraction(playerLonLat[0], playerLonLat[1], zoom);
    // console.log(tileFraction);

    const neededTiles = [];
    const radius = 1;
    for (let x = centerTile[0] - radius; x <= centerTile[0] + radius; x++) {
      for (let y = centerTile[1] - radius; y <= centerTile[1] + radius; y++) {
        neededTiles.push([x, y, centerTile[2]]);
      }
    }

    neededTiles.sort(function(a, b) {
      return (Math.abs(centerTile[0] - a[0]) + Math.abs(centerTile[1] - a[1])) -
        (Math.abs(centerTile[0] - b[0]) + Math.abs(centerTile[1] - b[1]));
    });

    for (let t of neededTiles) {
      if (t in tileCache) continue;
      if (t in tilesInFlight) continue;
      tilesInFlight[t] = true;
      requestTileImage(t, function(tt, image) {
        console.log(tt);
        delete tilesInFlight[tt];
        tileCache[tt] = {
          texture: regl.texture({data: image, flipY: true, mag: 'linear', min: 'linear'}),
          tile: tt,
        }
      });
    }

    function needTile(tile) {
      for (let nt of neededTiles) {
        if (tile.toString() === nt.toString()) {
          return true;
        }
      }
      return false;
    }

    // clean up old tiles
    for (let t of Object.keys(tileCache)) {
      let tile = tileCache[t];
      if (!needTile(tile.tile)) {
        tile.texture.destroy();
        delete tileCache[tile.tile];
      }
    }

    // console.log(neededTiles);

    const fx = tileFraction[0] - Math.floor(centerTile[0]);
    const fy = 1.0 - (tileFraction[1] - Math.floor(centerTile[1]));
    document.getElementById('info').innerText = `${centerTile}, ${fy}`;
    let translation = [0.5 - fx, 0.5 - fy];
    regl.clear({
      color: [0,0,0.25,1],
      depth: 1,
    });
    for (let nt of neededTiles) {
      if (nt in tileCache) {
        const tile = tileCache[nt];
        const offset = [
          tile.tile[0] - centerTile[0],
          centerTile[1] - tile.tile[1]
        ];
        cHeightmap({
          translation: vec2.add([], offset, translation),
          texture: tileCache[nt].texture,
          viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
          destination: fbHeightmap,
        });
      }
    }

    const model = mat4.fromTranslation([], [0, -1 - cam.getPosition()[1], 0]);
    const scale = (Math.cos(playerLonLat[1] * Math.PI/180) * 2*Math.PI*6378137)/(256 * Math.pow(2,zoom));
    mat4.scale(model, model, [256*scale, 10, 256*scale]);
    const view = cam.getView(true);
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, 1, 256*scale);

    regl.clear({
      color: [0,0,0.25,1],
      depth: 1,
    });



    cTerrain({
      position: mesh.mesh,
      bc: mesh.bc,
      offset: [Math.round(fx * 256)/512, Math.round(fy * 256)/512],
      model: model,
      view: view,
      projection: projection,
      heightmap: fbHeightmap,
      viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
      count: mesh.count,
    });
    requestAnimationFrame(loop);
  }

  loop();

}

function buildMesh() {
  const size = 1.0;
  const hsize = size/2;
  const res = 256;
  const mesh = new Float32Array(res * res * 2 * 3 * 3);
  const bc = new Float32Array(res * res * 2 * 3 * 3);
  let index = 0;
  function insert(x, y, z, a, b, c) {
    mesh[index + 0] = x;
    mesh[index + 1] = y;
    mesh[index + 2] = z;
    bc[index + 0] = a;
    bc[index + 1] = b;
    bc[index + 2] = c;
    index += 3;
  }
  for (let i = 0; i < res; i++) {
    const x0 = size * (i + 0)/res;
    const x1 = size * (i + 1)/res;
    for (let j = 0; j < res; j++) {
      const z0 = size * (j + 0)/res;
      const z1 = size * (j + 1)/res;
      insert(x0 - hsize, 0, z0 - hsize, 1, 0, 0);
      insert(x1 - hsize, 0, z0 - hsize, 0, 1, 0);
      insert(x1 - hsize, 0, z1 - hsize, 0, 0, 1);
      insert(x0 - hsize, 0, z0 - hsize, 1, 0, 0);
      insert(x1 - hsize, 0, z1 - hsize, 0, 0, 1);
      insert(x0 - hsize, 0, z1 - hsize, 0, 1, 0);
    }
  }
  return {
    mesh: mesh,
    bc: bc,
    count: mesh.length/3,
  };
}

function llnsew2ll(lon, lat) {
  lon = lon.toLowerCase().split(' ').join('');
  lat = lat.toLowerCase().split(' ').join('');
  const ew = lon[lon.length - 1];
  const ns = lat[lat.length - 1];
  lon = parseFloat(lon.replace(ew,''));
  lat = parseFloat(lat.replace(ns,''));
  if (ew === 'w') {
    lon = -lon;
  }
  if (ns === 's') {
    lat = -lat;
  }
  return {
    lon: lon,
    lat: lat
  };
}

function loadImage(src) {
  return new Promise((resolve, reject, err) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function point2lonlat(p) {
  const pi = Math.PI;
  const twopi = 2 * pi;
  p = vec3.normalize([], p);
  const y = p[0];
  const z = p[1]
  const x = p[2];
  const theta = Math.acos(z);
  const phi = Math.atan2(y,x);
  return {
    lon: 360 * (phi + pi)/twopi,
    lat: 180 * theta/pi
  };
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function requestTileImage(tile, callback) {
  const url = `http://localhost:8080/elevation-tiles-prod/terrarium/${tile[2]}/${tile[0]}/${tile[1]}.png`;
  loadImage(url).then(function(image) {
    callback(tile, image);
  });
}
