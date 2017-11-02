"use strict";

const REGL = require('regl');
const glMatrix = require('gl-matrix');
const Trackball = require('trackball-controller');
const quadtree = require('../quadtree');
const SphereFPSCam = require('./sphere-fps-cam');
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

const cache = require('./cache');

const earthRadius = 6371000; // meters

main();

async function main() {

  const nodeCache = cache(key => {
    return `nodes/${key}.json`;
  });

  const texture_img = await loadImage('texture.png');

  const color_img = await loadImage('earthcolor.jpg');

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


  function getTreeFace(p) {
    const pn = vec3.normalize([], p);
    const roots = [[0, [1,0,0]], [1, [-1,0,0]], [2, [0,1,0]], [3, [0,-1,0]], [4, [0,0,1]], [5, [0,0,-1]]];
    let maxi=0, maxv=-Infinity;
    for (let root of roots) {
      const dot = vec3.dot(pn, root[1]);
      if (dot > maxv) {
        maxv = dot;
        maxi = root[0];
      }
    }
    return sphere[maxi];
  }

  function unprojectPoint(p, face) {
    const pn = vec3.normalize([], p);
    let index = 0, alpha = 0;
    if (face.c[0] === 1) {index = 0; alpha = 1};
    if (face.c[0] === -1) {index = 0; alpha = -1};
    if (face.c[1] === 1) {index = 1; alpha = 1};
    if (face.c[1] === -1) {index = 1; alpha = -1};
    if (face.c[2] === 1) {index = 2; alpha = 1};
    if (face.c[2] === -1) {index = 2; alpha = -1};
    const dt = (alpha - p[index])/pn[index];
    return vec3.add([], p, vec3.scale([], pn, dt));
  }

  function getTreeNode(p, depth) {
    const root = getTreeFace(p);
    const pu = unprojectPoint(p, root);
    let rnode = null;
    quadtree.traverse(root, function(node, d) {
      const right = node.right;
      const up = node.up;
      const wpu = vec3.sub([], pu, node.w);
      if (vec3.dot(wpu, right) < 0) return false;
      const epu = vec3.sub([], pu, node.e);
      if (vec3.dot(epu, right) > 0) return false;
      const spu = vec3.sub([], pu, node.s);
      if (vec3.dot(spu, up) < 0) return false;
      const npu = vec3.sub([], pu, node.n);
      if (vec3.dot(npu, up) > 0) return false;
      if (d === depth) {
        rnode = node;
        return false;
      }
      return true;
    });
    return rnode;
  }

  function getElevation(p, depth) {
    depth = 5;
    const root = getTreeFace(p);
    const pu = unprojectPoint(p, root);
    const node = getTreeNode(p, depth);
    const enode = nodeCache.get(node.id);
    if (!enode) return 0;
    const res = enode.resolution;
    const right = node.right;
    const rightn = vec3.normalize([], node.right);
    const up = node.up;
    const upn = vec3.normalize([], node.up);
    const sw = node.sw;
    const swpu = vec3.sub([], pu, sw);
    const compright = vec3.dot(swpu, rightn)/(vec3.length(right) * 2);
    const compup = vec3.dot(swpu, upn)/(vec3.length(up) * 2);
    return 32.0 * enode.elevations[Math.round(compright * res)][Math.round(compup * res)];
  }

  function getAvailableNodes(p) {
    const nodes = [];
    for (let root of sphere) {
      quadtree.traverse(root, function(node, depth) {
        const radius = vec3.distance(
          vec3.scale([], vec3.normalize([], node.c), earthRadius),
          vec3.scale([], vec3.normalize([], node.se), earthRadius)
        );
        const dist = vec3.distance(p, vec3.scale([], vec3.normalize([], node.c), earthRadius));
        if (dist > radius * 8) {
          return false;
        }
        if (depth === 5) {
          const available = nodeCache.get(node.id);
          if (available) {
            nodes.push({
              node: node,
              enode: available,
            });
          }
          return false;
        }
        return true;
      });
    }
    return nodes;
  }

  const terrainMeshes = {};
  // const vertexCache = {};
  const colorCache = {};

  // function getVertex(p) {
  //   if (!(p in vertexCache)) {
  //     vertexCache[p] = vec3.scale([], vec3.normalize([], p), getElevation(p) + earthRadius);
  //   }
  //   return vertexCache[p].slice();
  // }


  function getColor(p) {
    if (!(p in colorCache)) {
      colorCache[p] = color(p);
    }
    return colorCache[p].slice();
  }


  function buildMesh(node, enode) {
    const res = 2;//enode.resolution;
    const right = vec3.scale([], node.right, 2/res);
    const up = vec3.scale([], node.up, 2/res);
    const positions = [], colors = [], normals = [], uvs = [];
    const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        let a = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 0));
        let b = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 1)), vec3.scale([], up, j + 0));
        let c = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 1)), vec3.scale([], up, j + 1));
        let d = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 1));

        const ma = vec3.scale([], vec3.normalize([], a), 32 * enode.elevations[i + 0][j + 0] + earthRadius);
        const mb = vec3.scale([], vec3.normalize([], b), 32 * enode.elevations[i + 1][j + 0] + earthRadius);
        const mc = vec3.scale([], vec3.normalize([], c), 32 * enode.elevations[i + 1][j + 1] + earthRadius);
        const md = vec3.scale([], vec3.normalize([], d), 32 * enode.elevations[i + 0][j + 1] + earthRadius);

        // const ma = vec3.scale([], vec3.normalize([], a), earthRadius);
        // const mb = vec3.scale([], vec3.normalize([], b), earthRadius);
        // const mc = vec3.scale([], vec3.normalize([], c), earthRadius);
        // const md = vec3.scale([], vec3.normalize([], d), earthRadius);

        positions.push(ma);
        positions.push(mb);
        positions.push(mc);
        positions.push(ma);
        positions.push(mc);
        positions.push(md);

        // window.a = ma;
        // window.b = mb;
        // window.c = mc;
        // window.d = md;
        // window.vec3 = vec3;
        // assplode;


        vec3.min(bounds.min, bounds.min, ma);
        vec3.min(bounds.min, bounds.min, mb);
        vec3.min(bounds.min, bounds.min, mc);
        vec3.min(bounds.min, bounds.min, md);
        vec3.max(bounds.max, bounds.max, ma);
        vec3.max(bounds.max, bounds.max, mb);
        vec3.max(bounds.max, bounds.max, mc);
        vec3.max(bounds.max, bounds.max, md);

        let ab = vec3.normalize([], vec3.sub([], mb, ma));
        let ac = vec3.normalize([], vec3.sub([], mc, ma));
        let n = vec3.cross([], ab, ac);
        normals.push(n);
        normals.push(n);
        normals.push(n);

        let ad = vec3.normalize([], vec3.sub([], md, ma));
        n = vec3.cross([], ac, ad);
        normals.push(n);
        normals.push(n);
        normals.push(n);

        const uva = [(i + 0) / res, (j + 0) / res];
        const uvb = [(i + 1) / res, (j + 0) / res];
        const uvc = [(i + 1) / res, (j + 1) / res];
        const uvd = [(i + 0) / res, (j + 1) / res];

        uvs.push(uva);
        uvs.push(uvb);
        uvs.push(uvc);
        uvs.push(uva);
        uvs.push(uvc);
        uvs.push(uvd);

        const ca = getColor(a);
        const cb = getColor(b);
        const cc = getColor(c);
        const cd = getColor(d);
        const cabc = vec3.scale([], vec3.add([], ca, vec3.add([], cb, cc)), 1/3);
        const cacd = vec3.scale([], vec3.add([], ca, vec3.add([], cc, cd)), 1/3);
        colors.push(cabc);
        colors.push(cabc);
        colors.push(cabc);
        colors.push(cacd);
        colors.push(cacd);
        colors.push(cacd);
      }
    }

    bounds.center = vec3.add([], bounds.min, vec3.scale([], vec3.sub([], bounds.max, bounds.min), 0.5));
    for (let i = 0; i < positions.length; i++) {
      vec3.sub(positions[i], positions[i], bounds.center);
    }

    // console.log(positions);
    // assplode;
    //
    const bc = [];
    for (let i = 0; i < positions.length/3; i++) {
      bc.push([1,0,0]);
      bc.push([0,1,0]);
      bc.push([0,0,1]);
    }

    return {
      offset: bounds.center,
      positions: regl.buffer(positions),
      colors: regl.buffer(colors),
      uvs: regl.buffer(uvs),
      normals: regl.buffer(normals),
      bc: regl.buffer(bc),
      count: positions.length,
    }
  }

  function getMesh(node, enode) {
    if (!(node.id in terrainMeshes)) {
      terrainMeshes[node.id] = buildMesh(node, enode);
    }
    return terrainMeshes[node.id];
  }

  const canvas = document.getElementById('render-canvas');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

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

  const regl = REGL({
    canvas: canvas,
  });

  const texture = regl.texture({
    data: texture_img,
    min: 'mipmap',
    mag: 'linear',
  });

  const render = regl({
    vert: `
      precision highp float;
      attribute vec3 position, normal, color, bc;
      attribute vec2 uv;
      uniform mat4 model, view, projection;
      varying vec3 vBC, vColor, vNormal;
      varying vec2 vUV;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        vBC = bc;
        vColor = color;
        vNormal = normal;//vec3(model * vec4(normal, 1));
        vUV = uv;
      }
    `,
    frag: `
      precision highp float;
      uniform sampler2D texture;
      uniform vec3 light;
      varying vec3 vBC, vColor, vNormal;
      varying vec2 vUV;
      void main() {
        float t = texture2D(texture, vUV).r;
        float l = 2.0 * clamp(dot(normalize(vNormal), normalize(light)), 0.25, 1.0);
        if (any(lessThan(vBC, vec3(0.01)))) {
          gl_FragColor = vec4(vColor * 0.5 * l, 1.0);
        } else {
          gl_FragColor = vec4(vColor * l * t * t, 1.0);
        }
      }
    `,
    attributes: {
      position: regl.prop('positions'),
      normal: regl.prop('normals'),
      uv: regl.prop('uvs'),
      color: regl.prop('colors'),
      bc: regl.prop('bc'),
    },
    uniforms: {
      model: regl.prop('model'),
      view: regl.prop('view'),
      projection: regl.prop('projection'),
      light: regl.prop('light'),
      texture: texture,
    },
    viewport: regl.prop('viewport'),
    count: regl.prop('count'),
    cull: {
      enable: true,
      face: 'back',
    },
  });

  const camData = JSON.parse(localStorage.getItem('camData')) || {
    position: [0,getElevation([0,1,0]) + 10 + earthRadius,0],
    forward: [0,0,-1]
  };
  const cam = SphereFPSCam(camData.position, camData.forward);
  cam.lookUp(-0.25);
  cam.lookRight(12);

  setInterval(function() {
    localStorage.setItem('camData', JSON.stringify(cam.dump()));
  }, 1000);

  const arrows = {
    up: false,
    down: false,
    left: false,
    right: false,
    shift: false,
  }

  window.addEventListener('keydown', function(e) {
    if (e.which === 16) arrows.shift = true;
    if (e.which === 87) arrows.up = true;
    if (e.which === 83) arrows.down = true;
    if (e.which === 65) arrows.left = true;
    if (e.which === 68) arrows.right = true;
  });

  window.addEventListener('keyup', function(e) {
    if (e.which === 16) arrows.shift = false;
    if (e.which === 87) arrows.up = false;
    if (e.which === 83) arrows.down = false;
    if (e.which === 65) arrows.left = false;
    if (e.which === 68) arrows.right = false;
  });


  const mapCanvas = document.getElementById('map');
  const mapCtx = mapCanvas.getContext('2d');

  function loop() {

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const speed = arrows.shift ? 10 : 1;

    if (arrows.up) {
      cam.moveForward(4000 * speed);
    }

    if (arrows.down) {
      cam.moveForward(-4000 * speed);
    }

    if (arrows.left) {
      cam.moveRight(-4000 * speed);
    }

    if (arrows.right) {
      cam.moveRight(4000 * speed);
    }

    let e = 100000 + earthRadius + getElevation(cam.getPosition());
    let delta = e - vec3.length(cam.getPosition());
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


    const view = cam.getView(true);
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, 10, 10000000);

    const nodes = getAvailableNodes(cam.getPosition());

    const meshes = [];

    for (let node of nodes) {
      meshes.push(getMesh(node.node, node.enode));
    }

    regl.clear({
      color: [110/255,163/255,209/255,1],
      depth: 1,
    });

    for (let mesh of meshes) {
      const translation = vec3.sub([], mesh.offset, cam.getPosition());
      const model = mat4.fromTranslation([], translation);
      render({
        model: model,
        view: view,
        projection: projection,
        viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
        positions: mesh.positions,
        normals: mesh.normals,
        uvs: mesh.uvs,
        colors: mesh.colors,
        bc: mesh.bc,
        light: vec3.normalize([], cam.getPosition()),
        count: mesh.count
      });
    }

    requestAnimationFrame(loop);
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
