"use strict";

const REGL = require('regl');
const mat4 = require('gl-matrix').mat4;
const vec3 = require('gl-matrix').vec3;
const Trackball = require('trackball-controller');
const Box = require('geo-3d-box');
const normals = require('normals');


main();

const texres = 512;

async function main() {

  const elevation_img = await loadImage('elevation.png');
  const color_img = await loadImage('earthcolor.png');

  const elevation = (function() {
    const w = texres * 4;
    const h = texres * 2;
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
      // iso sphere coords crap ugh
      const y = p[0];
      const z = p[1]
      const x = p[2];
      const theta = Math.acos(z);
      const phi = Math.atan2(y,x);
      const i = clamp(Math.floor(w * (phi + pi)/twopi), 0, w - 1);
      const j = clamp(Math.floor(h * theta/pi), 0, h - 1);
      return data[(j * w + i) * 4 + 0]; // +0 for red, +1 for green, etc...
    }
  })();

  const color = (function() {
    const w = texres * 4;
    const h = texres * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(color_img, 0, 0, w, h);
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
      return [
        data[(j * w + i) * 4 + 0]/255,
        data[(j * w + i) * 4 + 1]/255,
        data[(j * w + i) * 4 + 2]/255,
      ];
    }
  })();

  const canvas = document.getElementById('render-canvas');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  var trackball = new Trackball(canvas, {
    onRotate: loop,
    drag: 0.01
  });
  trackball.spin(13,0);

  const regl = REGL({
    canvas: canvas,
    extensions: ['OES_element_index_uint']
  });

  const box = Box({
    size: [1,1,1],
    segments: [texres,texres,texres]
  });

  box.colors = [];
  for (let i = 0; i < box.positions.length; i++) {
    const d = 0.05 * elevation(box.positions[i])/255;
    box.positions[i] = vec3.scale([], vec3.normalize([], box.positions[i]), d + 1.0);
    box.colors.push(color(box.positions[i]));
  }

  box.normals = normals.vertexNormals(box.cells, box.positions, 0);

  const render = regl({
    vert: `
      precision highp float;
      attribute vec3 position;
      attribute vec3 color;
      attribute vec3 normal;
      uniform mat4 model, view, projection;
      varying vec3 vColor, vNormal;
      varying float vHeight;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        vNormal = vec3(model * vec4(normal, 1));
        vColor = color;
        vHeight = length(position);
      }
    `,
    frag: `
      precision highp float;
      varying vec3 vColor, vNormal;
      varying float vHeight;
      void main() {
        float d = clamp(dot(normalize(vNormal), normalize(vec3(1,1,2))), 0.0, 1.0);
        float i = 0.0;
        if (vHeight < 1.000001) {
          i = clamp(dot(normalize(vNormal), normalize(vec3(1,1,2))), 0.0, 1.0);
        }
        gl_FragColor = vec4(vColor * d + pow(i, 8.0) * 0.5, 1.0);
      }
    `,
    attributes: {
      position: box.positions,
      color: box.colors,
      normal: box.normals,
    },
    uniforms: {
      model: regl.prop('model'),
      view: regl.prop('view'),
      projection: regl.prop('projection'),
    },
    viewport: regl.prop('viewport'),
    elements: box.cells,
  });

  function loop() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const model = trackball.rotation;
    const view = mat4.lookAt([], [0, 0, 32], [0, 0, 0], [0,1,0]);
    const projection = mat4.perspective([], Math.PI/32, canvas.width/canvas.height, 0.1, 1000);

    regl.clear({
      color: [0,0,0,0],
      depth: 1,
    });

    render({
      model: model,
      view: view,
      projection: projection,
      viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
    });

  }

  requestAnimationFrame(loop);

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
