"use strict";

const REGL = require('regl');
const mat4 = require('gl-matrix').mat4;
const vec3 = require('gl-matrix').vec3;
const constants = require('../common/constants');
const QuadSphere = require('../common/quadsphere.js');
const SphereFPSCam = require('./sphere-fps-cam');

const socket = new WebSocket('ws://localhost:8080');

const qs = QuadSphere(constants.earthRadius);
const cam = SphereFPSCam(vec3.scale([], vec3.normalize([], [0,0,1]), constants.earthRadius + 0), [1,0,0]);

const t0 = performance.now();
function getNodes(p) {
  const maxDepth = 20;
  const nodes = [];
  qs.traverse(function(node, depth) {
    const radius = [node.sphere.sw, node.sphere.se, node.sphere.nw, node.sphere.ne]
      .map(a => vec3.distance(node.sphere.c, a))
      .reduce((a, b) => Math.max(a, b));
    const dist = vec3.distance(p, node.sphere.c);
    if (dist > radius + 100 || depth === maxDepth) {
      nodes.push(node);
      return false;
    }
    return true;
  });
  return nodes;
}
console.log(performance.now() - t0);

const playerPosition = cam.getPosition();

const nodes = getNodes(playerPosition);

const canvas = document.getElementById('render-canvas');

canvas.width = 1024;//canvas.clientWidth;
canvas.height = 1024;//canvas.clientHeight;

const regl = REGL({
  canvas: canvas,
  extensions: ['OES_texture_float', 'OES_texture_float_linear'],
});

const fhm = fakeHeightmap(32);

function getHeightfields(nodes) {
  const heightFields = [];
  for (const node of nodes) {
    heightFields.push({
      heightmap: fhm,
      sw: node.cube.sw,
      right: node.cube.right,
      up: node.cube.up, 
      node: node,
      rgb: [Math.random(), Math.random(), Math.random()],
    });
  }
  return heightFields;
}

const heightfields = getHeightfields(nodes);

const heightfieldMesh = generateHeightfieldMesh(1);

const renderHeightmap = regl({
  vert: `
    precision highp float;
    attribute vec2 position;
    uniform float size;
    uniform vec3 sw, right, up;
    uniform mat4 model, view, projection;
    varying vec2 vUV;
    void main() {
      vec3 p = normalize(sw + size * right * position.x + size * up * position.y) * ${constants.earthRadius}.0;
      gl_Position = projection * view * model * vec4(p, 1);
      vUV = position;
    }
  `,
  frag: `
    precision highp float;
    uniform sampler2D heightmap;
    uniform vec3 color;
    varying vec2 vUV;
    void main() {
      float h = texture2D(heightmap, vUV).a;      
      gl_FragColor = vec4(h*color, 1);
    }
  `,
  attributes: {
    position: regl.prop('positions'),
  },
  uniforms: {
    model: regl.prop('model'),
    view: regl.prop('view'),
    projection: regl.prop('projection'),
    heightmap: regl.prop('heightmap'),
    sw: regl.prop('sw'),
    right: regl.prop('right'),
    up: regl.prop('up'),
    size: regl.prop('size'),
    color: regl.prop('color'),
  },
  viewport: regl.prop('viewport'),
  count: regl.prop('count'),
  depth: {
    enable: false,
  },
  cull: {
    enable: false,
    face: 'back',
  },
});

console.log(heightfields.length);

function loop() {
  const model = mat4.create();
  // const view = mat4.lookAt([], [0, constants.earthRadius + 1000, 0], [0, constants.earthRadius + 0, 0], [0,0,-1]);
  const view = mat4.lookAt([], [0, 0, constants.earthRadius + 1000000], [0, 0, 0], [0,1,0]);
  // const s = (Math.sin(performance.now() * 0.001) + 1) * 1000000 + 1000;
  const s = canvas.width/32 * (Math.PI * 0.5 * 6378137)*Math.pow(0.5, 20);
  const projection = mat4.ortho([], -s, s, -s, s, -s, 100000000);
  heightfields.sort( (a, b) => a.node.id.length - b.node.id.length);
  for (const heightfield of heightfields) {
    // if (heightfield.node.id === 'pz-') {
    //   console.log(heightfield);
    //   assplode;
    // }
    if (!heightfield.node.id.startsWith('pz')) continue;
    // if (heightfield.node.id.length > 8) continue;
    // console.log(heightfield);
    // console.log(heightfieldMesh);
    renderHeightmap({
      model: model,
      view: view,
      projection: projection,
      positions: heightfieldMesh.mesh,
      count: heightfieldMesh.count,
      heightmap: heightfield.heightmap,
      sw: heightfield.sw,
      right: heightfield.right,
      up: heightfield.up,
      size: heightfield.node.size,
      color: heightfield.rgb,
      viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},  
    });
  }
  requestAnimationFrame(loop);
}

loop();


function fakeHeightmap(res) {
  const hm = new Float32Array(res * res);
  for (let i = 0; i < res * res; i++) {
    hm[i] = Math.random();
  }
  return regl.texture({
    width: res,
    height: res,
    data: hm,
    format: 'alpha',
    type: 'float',
    mag: 'linear',
    min: 'linear',
  });
}

function generateHeightfieldMesh(res) {
  const mesh = new Float32Array(res * res * 2 * 3 * 2);
  let index = 0;
  function insert(x, y) {
    mesh[index + 0] = x;
    mesh[index + 1] = y;
    index += 2;
  }
  for (let i = 0; i < res; i++) {
    const x0 = (i + 0)/res;
    const x1 = (i + 1)/res;
    for (let j = 0; j < res; j++) {
      const y0 = (j + 0)/res;
      const y1 = (j + 1)/res;
      insert(x0, y0);
      insert(x1, y0);
      insert(x1, y1);
      insert(x0, y0);
      insert(x1, y1);
      insert(x0, y1);
    }
  }
  return {
    mesh: regl.buffer(mesh),
    count: mesh.length/2,
    ogmesh: mesh,
  };
}