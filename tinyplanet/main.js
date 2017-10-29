"use strict";

const REGL = require('regl');
const glMatrix = require('gl-matrix');
const Trackball = require('trackball-controller');
const quadtree = require('./quadtree');
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;


const meter = 1.568e-7;

main();

async function main() {

  const elevation_img = await loadImage('elevation.png');

  const elevation = (function() {
    const w = elevation_img.width;
    const h = elevation_img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(elevation_img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const pi = Math.PI;
    const twopi = pi * 2;

    return function(p) {
      p = vec3.normalize([], p);
      const y = p[0];
      const z = p[1]
      const x = p[2];
      const theta = Math.acos(z);
      const phi = Math.atan2(y,x);
      const i = clamp(Math.floor(w * (phi + pi)/twopi), 0, w - 1);
      const j = clamp(Math.floor(h * theta/pi), 0, h - 1);
      return meter * 32 * 8850 * data[(j * w + i) * 4 + 0]/255; // +0 for red, +1 for green, etc...
    }
  })();

  const color_img = await loadImage('earthcolor.png');

  const color = (function() {
    const w = color_img.width;
    const h = color_img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(color_img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const pi = Math.PI;
    const twopi = pi * 2;

    const temp = [];
    return function(p) {
      p = vec3.normalize(temp, p);
      const y = p[0];
      const z = p[1]
      const x = p[2];
      const theta = Math.acos(z);
      const phi = Math.atan2(y,x);
      const i = clamp(Math.floor(w * (phi + pi)/twopi), 0, w - 1);
      const j = clamp(Math.floor(h * theta/pi), 0, h - 1);
      return [
        data[(j * w + i) * 4 + 0]/255,
        data[(j * w + i) * 4 + 1]/255,
        data[(j * w + i) * 4 + 2]/255,
      ];
    }
  })();



  const sphere = [
    quadtree.node( // Positive Z
      [-1, -1,  1],
      [ 1, -1,  1],
      [ 1,  1,  1],
      [-1,  1,  1]
    ),
    quadtree.node( // Negagive Z
      [ 1, -1, -1],
      [-1, -1, -1],
      [-1,  1, -1],
      [ 1,  1, -1],
    ),
    quadtree.node( // Positive X
      [ 1, -1,  1],
      [ 1, -1, -1],
      [ 1,  1, -1],
      [ 1,  1,  1]
    ),
    quadtree.node( // Negative X
      [-1, -1, -1],
      [-1, -1,  1],
      [-1,  1,  1],
      [-1,  1, -1]
    ),
    quadtree.node( // Positive Y
      [-1,  1,  1],
      [ 1,  1,  1],
      [ 1,  1, -1],
      [-1,  1, -1]
    ),
    quadtree.node( // Negative Y
      [-1, -1, -1],
      [ 1, -1, -1],
      [ 1, -1,  1],
      [-1, -1,  1]
    )
  ]


  function getRequiredNodes(p) {
    const nodes = [];
    for (let root of sphere) {
      quadtree.traverse(root, function(node, depth) {
        const radius = vec3.distance(vec3.normalize([], node.c), vec3.normalize([], node.se));
        const dist = vec3.distance(p, vec3.normalize([], node.c));
        if (dist > radius * 8) {
          return false;
        }
        if (depth > 4) {
          nodes.push(node);
          return false;
        }
        return true;
      });
    }
    return nodes;
  }

  const terrainMeshes = {};
  const vertexCache = {};
  const colorCache = {};

  function getVertex(p) {
    if (!(p in vertexCache)) {
      vertexCache[p] = vec3.scale([], vec3.normalize([], p), elevation(p) + 1);
      // vertexCache[p] = vec3.scale([], vec3.normalize([], p), 1 + 10000 * meter * (2 * Math.random() - 1));
    }
    return vertexCache[p].slice();
  }


  function getColor(p) {
    if (!(p in colorCache)) {
      colorCache[p] = color(p);
      // vertexCache[p] = vec3.scale([], vec3.normalize([], p), 1 + 10000 * meter * (2 * Math.random() - 1));
    }
    return colorCache[p].slice();
  }


  function buildMesh(node) {
    const res = 8;
    const right = vec3.scale([], node.right, 2/res);
    const up = vec3.scale([], node.up, 2/res);
    const positions = [], colors = [];
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        let a = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 0));
        let b = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 1)), vec3.scale([], up, j + 0));
        let c = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 1)), vec3.scale([], up, j + 1));
        let d = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 1));
        positions.push(getVertex(a));
        positions.push(getVertex(b));
        positions.push(getVertex(c));
        positions.push(getVertex(a));
        positions.push(getVertex(c));
        positions.push(getVertex(d));
        colors.push(getColor(a));
        colors.push(getColor(b));
        colors.push(getColor(c));
        colors.push(getColor(a));
        colors.push(getColor(c));
        colors.push(getColor(d));
      }
    }
    const bc = [];
    for (let i = 0; i < positions.length/3; i++) {
      bc.push([1,0,0]);
      bc.push([0,1,0]);
      bc.push([0,0,1]);
    }
    return {
      positions: positions,
      colors: colors,
      bc: bc,
    }
  }

  function getMesh(node) {
    if (!(node.c in terrainMeshes)) {
      terrainMeshes[node.c] = buildMesh(node);
    }
    return terrainMeshes[node.c];
  }

  const canvas = document.getElementById('render-canvas');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const regl = REGL({
    canvas: canvas,
  });

  const render = regl({
    vert: `
      precision highp float;
      attribute vec3 position;
      attribute vec3 color;
      attribute vec3 bc;
      uniform mat4 model, view, projection;
      varying vec3 vBC, vColor;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        vBC = bc;
        vColor = color;
      }
    `,
    frag: `
      precision highp float;
      varying vec3 vBC, vColor;
      void main() {
        if (any(lessThan(vBC, vec3(0.01)))) {
          gl_FragColor = vec4(1,1,1, 1.0);
        } else {
          gl_FragColor = vec4(vColor, 1.0);
        }
      }
    `,
    attributes: {
      position: regl.prop('positions'),
      color: regl.prop('colors'),
      bc: regl.prop('bc'),
    },
    uniforms: {
      model: regl.prop('model'),
      view: regl.prop('view'),
      projection: regl.prop('projection'),
    },
    viewport: regl.prop('viewport'),
    count: regl.prop('count'),
    cull: {
      enable: true,
      face: 'back',
    },
  });

  const cam = SphereFPSCam([0,1.03,0], [0,0,-1]);
  cam.lookUp(-0.25);
  cam.lookRight(12);

  const arrows = {
    up: false,
    down: false,
    left: false,
    right: false,
    shift: false,
  }

  window.addEventListener('keydown', function(e) {
    if (e.which === 16) arrows.shift = true;
    if (e.which === 38) arrows.up = true;
    if (e.which === 40) arrows.down = true;
    if (e.which === 37) arrows.left = true;
    if (e.which === 39) arrows.right = true;
  });

  window.addEventListener('keyup', function(e) {
    if (e.which === 16) arrows.shift = false;
    if (e.which === 38) arrows.up = false;
    if (e.which === 40) arrows.down = false;
    if (e.which === 37) arrows.left = false;
    if (e.which === 39) arrows.right = false;
  });


  const mapCanvas = document.getElementById('map');
  const mapCtx = mapCanvas.getContext('2d');

  function loop() {

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const speed = arrows.shift ? 10 : 1;

    if (arrows.up) {
      cam.moveForward(0.001 * speed);
    }

    if (arrows.down) {
      cam.moveForward(-0.001 * speed);
    }

    if (arrows.left) {
      cam.lookRight(-0.01 * speed);
    }

    if (arrows.right) {
      cam.lookRight(0.01 * speed);
    }

    let e = 1 + elevation(cam.getPosition());
    let delta = 100000 * meter + e - vec3.length(cam.getPosition());
    cam.moveUp(delta * 0.1);

    mapCanvas.width = window.innerWidth/4;
    mapCanvas.height = mapCanvas.width/2;
    mapCtx.drawImage(color_img, 0, 0, mapCanvas.width, mapCanvas.height);

    (function() {
      const pi = Math.PI;
      const twopi = 2 * pi;
      const w = mapCanvas.width;
      const h = mapCanvas.height;
      const p = vec3.normalize([], cam.getPosition());
      const y = p[0];
      const z = p[1]
      const x = p[2];
      const theta = Math.acos(z);
      const phi = Math.atan2(y,x);
      const i = clamp(Math.floor(w * (phi + pi)/twopi), 0, w - 1);
      const j = clamp(Math.floor(h * theta/pi), 0, h - 1);
      mapCtx.fillStyle='#FF0000';
      mapCtx.fillRect(i-4,j-4,9,9);
    })();


    const model = mat4.create();
    const view = cam.getView();
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, 0.001, 10);

    const nodes = getRequiredNodes(cam.getPosition());

    const meshes = [];

    for (let node of nodes) {
      meshes.push(getMesh(node));
    }

    regl.clear({
      color: [110/255,163/255,209/255,1],
      depth: 1,
    });

    for (let mesh of meshes) {
      render({
        model: model,
        view: view,
        projection: projection,
        viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
        positions: mesh.positions,
        colors: mesh.colors,
        bc: mesh.bc,
        count: mesh.positions.length
      });
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

}


function SphereFPSCam(position, forward) {

  const pi = Math.PI;

  position = position.slice();
  forward = forward.slice();

  let right = [];
  let up = [];

  let phi = 0;

  normalize();

  function normalize() {
    up = vec3.normalize([], position);
    forward = vec3.normalize(forward, forward);
    vec3.cross(right, forward, up);
    vec3.cross(forward, up, right);
  }

  function lookRight(delta) {
    const rotAroundUp = mat4.rotate([], mat4.create(), -delta, up);
    vec3.transformMat4(forward, forward, rotAroundUp);
    normalize();
  }

  function lookUp(delta) {
    phi += delta;
    phi = Math.min(Math.max(-0.99 * pi/2, phi), 0.99 * pi/2);
  }

  function moveForward(delta) {
    vec3.add(position, position, vec3.scale([], forward, delta));
    normalize();
  }

  function moveUp(delta) {
    vec3.add(position, position, vec3.scale([], up, delta));
    normalize();
  }

  function getView() {
    normalize();
    const rotAroundRight = mat4.rotate([], mat4.create(), phi, right);
    const f = vec3.transformMat4([], forward, rotAroundRight);
    const center = vec3.add([], position, f);
    return mat4.lookAt([], position, center, up);
  }

  function getPosition() {
    return position.slice();
  }

  return {
    getView: getView,
    getPosition: getPosition,
    lookRight: lookRight,
    lookUp: lookUp,
    moveForward: moveForward,
    moveUp: moveUp,
  }

}


function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
