"use strict";

const REGL = require('regl');
const glMatrix = require('gl-matrix');
const Trackball = require('trackball-controller');
const quadtree = require('../quadtree');
const SphereFPSCam = require('./sphere-fps-cam');
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

const meshWorker = new Worker('bundled-worker.js');

const cache = require('./cache');

const earthRadius = 6371000; // meters
const vScale = 1.0;

main();

async function main() {

  const nodeCache = cache(key => {
    var url = location.protocol+'//'+location.hostname+(location.port ? ':'+location.port: '');
    return `http://159.203.97.31/complete/${key}`;
  });

  const texture_img = await loadImage('texture.png');
  const color_img = await loadImage('earthcolor.jpg');

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
    depth = 9;
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
    return vScale * enode.elevations[Math.round(compright * res)][Math.round(compup * res)];
  }

  function getAvailableNodes(p) {
    const nodes = [];
    for (let root of sphere) {
      quadtree.traverse(root, function(node, depth) {
        const radius = Math.max(
          vec3.distance(
            vec3.scale([], vec3.normalize([], node.c), earthRadius),
            vec3.scale([], vec3.normalize([], node.se), earthRadius)
          ),
          vec3.distance(
            vec3.scale([], vec3.normalize([], node.c), earthRadius),
            vec3.scale([], vec3.normalize([], node.sw), earthRadius)
          )
        );
        const dist = vec3.distance(p, vec3.scale([], vec3.normalize([], node.c), earthRadius));
        if (dist > radius * 2) {
          const available = nodeCache.get(node.id);
          if (available) {
            nodes.push({
              node: node,
              enode: available,
            });
          }
          return false;
        }
        if (depth === 9) {
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
  const vertexCache = {};
  const colorCache = {};

  function getVertex(p) {
    if (!(p in vertexCache)) {
      vertexCache[p] = vec3.scale([], vec3.normalize([], p), getElevation(p) + earthRadius);
    }
    return vertexCache[p].slice();
  }


  function getColor(p) {
    if (!(p in colorCache)) {
      colorCache[p] = color(p);
    }
    return colorCache[p].slice();
  }

  const terrainMeshesInFlight = {};

  const workerQueue = [];

  meshWorker.onmessage = function(e) {
    workerQueue.push(e.data);
  }

  function getMesh(node, enode) {
    if (!(node.id in terrainMeshes)) {
      if (node.id in terrainMeshesInFlight) {
        return null;
      }
      if (Object.keys(terrainMeshesInFlight).length > 0) {
        return null;
      }
      terrainMeshesInFlight[node.id] = true;
      meshWorker.postMessage({
        node: node,
        enode: enode,
        vScale: vScale,
        earthRadius: earthRadius,
      });
      return null;
      // terrainMeshes[node.id] = buildMesh(node, enode);
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
    wrap: 'repeat',
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

      vec3 saturate(vec3 c, float delta) {
        float p = sqrt(c.r*c.r*0.299 + c.g*c.g*0.587 + c.b*c.b*0.114);
        return p + delta * (c - p);
      }

      void main() {
        float t = texture2D(texture, vUV).r;
        float l = 2.0 * clamp(dot(normalize(vNormal), normalize(light)), 0.25, 1.0);
        gl_FragColor = vec4(saturate(vColor * l * t * t, 1.0), 1.0);
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

  let altitude = 1000;
  const camData = JSON.parse(localStorage.camData || `{"position":[-4773693.901540027,3750099.5086902347,-1945974.1763553189],"forward":[0.6580729702777001,0.7146290914223565,-0.2371607629494012]}`);
  let cam = SphereFPSCam(camData.position, camData.forward);

  setInterval(function() {
    localStorage.setItem('camData', JSON.stringify(cam.dump()));
  }, 1000);

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


  const mapCanvas = document.getElementById('map');
  const mapCtx = mapCanvas.getContext('2d');

  function loop() {

    const data = workerQueue.pop();
    if (data) {
      delete terrainMeshesInFlight[data.node.id];
      terrainMeshes[data.node.id] = {
        offset: data.offset,
        positions: regl.buffer(data.positions),
        colors: regl.buffer(data.colors),
        uvs: regl.buffer(data.uvs),
        normals: regl.buffer(data.normals),
        bc: regl.buffer(data.bc),
        count: data.count,
      }
    }


    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const speed = keyboard.shift ? 1 : 0.1;

    if (keyboard.ascend) {
      altitude *= 1.1;
    }

    if (keyboard.descend) {
      altitude *= 0.9;
    }

    altitude = Math.min(Math.max(altitude, 1), 1000000);

    if (keyboard.up) {
      cam.moveForward(speed * altitude);
    }

    if (keyboard.down) {
      cam.moveForward(-speed * altitude);
    }

    if (keyboard.left) {
      cam.moveRight(-speed * altitude);
    }

    if (keyboard.right) {
      cam.moveRight(speed * altitude);
    }

    let e = altitude + earthRadius + getElevation(cam.getPosition());
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
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, 1, 10000000);

    regl.clear({
      color: [65/255,168/255,255/255,1],
      depth: 1,
    });

    const nodes = getAvailableNodes(cam.getPosition());

    const meshes = [];

    for (let node of nodes) {
      meshes.push(getMesh(node.node, node.enode));
    }

    for (let mesh of meshes) {
      if (mesh === null) continue;
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

    document.getElementById('alt').innerText = `Altitude: ${Math.round(altitude)} meters`;

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  document.getElementById('btn-grand-canyon').addEventListener('click', function() {
    const tmpData = JSON.parse(`{"position":[-4773693.901540027,3750099.5086902347,-1945974.1763553189],"forward":[0.6580729702777001,0.7146290914223565,-0.2371607629494012]}`);
    cam = SphereFPSCam(tmpData.position, tmpData.forward);
    altitude = 1000;
  });
  document.getElementById('btn-mount-fuji').addEventListener('click', function() {
    const tmpData = JSON.parse(`{"position":[3415253.5791660026,3666853.214765183,-3937219.288570469],"forward":[0.32296984203460627,0.536401617569623,0.7797203253762426]}`);
    cam = SphereFPSCam(tmpData.position, tmpData.forward);
    altitude = 1000;
  });

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
