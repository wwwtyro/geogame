"use strict";

const REGL = require('regl');
const glMatrix = require('gl-matrix');
const Sphere = require('icosphere');
const QuadSphere = require('../common/quadsphere');
const constants = require('../common/constants');
const SphereFPSCam = require('./sphere-fps-cam');
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

const meshWorker = new Worker('bundled-worker.js');

const cache = require('./cache');

const vScale = 1.0;
const MAX_DEPTH = 9;

main();

async function main() {

  const nodeCache = cache(key => {
    var url = location.protocol+'//'+location.hostname+(location.port ? ':'+location.port: '');
    return `http://159.203.97.31/complete/${key}`;
  });

  const texture_img = await loadImage('texture.png');
  const color_img = await loadImage('earthcolor.jpg');

  const qs = QuadSphere(constants.earthRadius);

  function getRequiredNodes(p) {
    const maxDepth = 8;
    const nodes = [];
    qs.traverse(function(node, depth) {
      const radius = [node.sphere.sw, node.sphere.se, node.sphere.nw, node.sphere.ne]
        .map(a => vec3.distance(node.sphere.c, a))
        .reduce((a, b) => Math.max(a, b));
      const dist = vec3.distance(p, node.sphere.c);
      nodes.push(node);
      if (dist > radius + 10000 || depth === maxDepth) {
        return false;
      }
      return true;
    });
    return nodes;
  }

  const terrainMeshes = {};
  const terrainMeshesInFlight = {};
  const workerQueue = [];

  meshWorker.onmessage = function(e) {
    workerQueue.push(e.data);
  }

  function getMesh(node) {
    if (node.id in terrainMeshes) {
      terrainMeshes[node.id].timestamp = performance.now();
      return terrainMeshes[node.id];
    }
    if (node.id in terrainMeshesInFlight) {
      return null;
    }
    const nodeData = nodeCache.get(node.id);
    if (!nodeData) {
      return null;
    }
    if (Object.keys(terrainMeshesInFlight).length > 1) {
      return null;
    }
    terrainMeshesInFlight[node.id] = true;
    meshWorker.postMessage({
      node: qs.serializableNode(node),
      enode: nodeData,
      vScale: vScale,
    });
    return null;
  }

  function fetchMeshes(p) {
    const nodes = getRequiredNodes(p);
    nodes.sort(function(a, b) {
      const ca = vec3.scale([], vec3.normalize([], a.c), constants.earthRadius);
      const cb = vec3.scale([], vec3.normalize([], b.c), constants.earthRadius);
      const da = vec3.distance(p, ca);
      const db = vec3.distance(p, cb);
      return da - db;
    });
    const meshes = [];
    for (let node of nodes) {
      const mesh = getMesh(node);
      if (mesh) {
        meshes.push(mesh);
      }
    }
    return {
      meshes: meshes,
    }
  }

  function cleanMeshes(p) {
    const keys = Object.keys(terrainMeshes);
    if (keys.length < 300) return;
    keys.sort(function(a, b) {
      return terrainMeshes[a].timestamp - terrainMeshes[b].timestamp;
    });
    const key = keys[0];
    if (performance.now() - terrainMeshes[key].timestamp > 5000) {
      const m = terrainMeshes[key];
      m.positions.destroy();
      m.colors.destroy();
      m.uvs.destroy();
      m.normals.destroy();
      delete terrainMeshes[key];
    }
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
    extensions: ['EXT_frag_depth'],
  });

  const underSphere = Sphere(5);
  underSphere.uvs = [];
  for (const p of underSphere.positions) {
    const px = getUV(p);
    underSphere.uvs.push([px.x, px.y]);
  }
  underSphere.positions = regl.buffer(underSphere.positions);
  underSphere.uvs = regl.buffer(underSphere.uvs);
  underSphere.cells = regl.elements(underSphere.cells);

  const texture = regl.texture({
    data: texture_img,
    min: 'mipmap',
    mag: 'linear',
    wrap: 'repeat',
  });

  const earthTexture = regl.texture({
    data: color_img,
    min: 'mipmap',
    mag: 'linear',
    wrap_s: 'repeat',
    wrap_t: 'repeat',
  })

  const renderTerrain = regl({
    vert: `
      precision highp float;
      attribute vec3 position, normal, color;
      attribute vec2 uv;
      uniform mat4 model, view, projection;
      varying vec3 vColor, vNormal;
      varying vec2 vUV;
      varying float flogz;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        float Fcoef = 2.0 / log2(100000000.0 + 1.0);
        gl_Position.z = log2(max(1e-6, 1.0 + gl_Position.w)) * Fcoef - 1.0;
        vColor = color;
        vNormal = normal;//vec3(model * vec4(normal, 1));
        vUV = uv;
        flogz = 1.0 + gl_Position.w;
      }
    `,
    frag: `
      #extension GL_EXT_frag_depth : enable
      precision highp float;
      uniform sampler2D texture;
      uniform vec3 light;
      varying vec3 vColor, vNormal;
      varying vec2 vUV;
      varying float flogz;

      vec3 saturate(vec3 c, float delta) {
        float p = sqrt(c.r*c.r*0.299 + c.g*c.g*0.587 + c.b*c.b*0.114);
        return p + delta * (c - p);
      }

      void main() {
        float t = texture2D(texture, vUV).r;
        float l = 2.0 * clamp(dot(normalize(vNormal), normalize(light)), 0.25, 1.0);
        gl_FragColor = vec4(saturate(vColor * l * t * t, 1.0), 1.0);
        float Fcoef_half = 1.0 / log2(100000000.0 + 1.0);
        gl_FragDepthEXT = log2(flogz) * Fcoef_half;
      }
    `,
    attributes: {
      position: regl.prop('positions'),
      normal: regl.prop('normals'),
      uv: regl.prop('uvs'),
      color: regl.prop('colors'),
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
    depth: {
      enable: true,
    }
  });

  const renderEarth = regl({
    vert: `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 model, view, projection;
      varying vec2 vUV;
      varying float flogz;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        vUV = uv;
        float Fcoef = 2.0 / log2(100000000.0 + 1.0);
        gl_Position.z = log2(max(1e-6, 1.0 + gl_Position.w)) * Fcoef - 1.0;
        flogz = 1.0 + gl_Position.w;
      }
    `,
    frag: `
      #extension GL_EXT_frag_depth : enable
      precision highp float;
      uniform sampler2D texture;
      varying vec2 vUV;
      varying float flogz;

      void main() {
        vec4 c = texture2D(texture, vUV);
        gl_FragColor = vec4(2.0 * c.rgb, 1);
        float Fcoef_half = 1.0 / log2(100000000.0 + 1.0);
        gl_FragDepthEXT = log2(flogz) * Fcoef_half;
      }
    `,
    attributes: {
      position: regl.prop('positions'),
      uv: regl.prop('uvs'),
    },
    uniforms: {
      model: regl.prop('model'),
      view: regl.prop('view'),
      projection: regl.prop('projection'),
      texture: earthTexture,
    },
    viewport: regl.prop('viewport'),
    elements: regl.prop('cells'),
    cull: {
      enable: true,
      face: 'back',
    },
    depth: {
      enable: true,
    }
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
        node: data.node,
        offset: data.offset,
        positions: regl.buffer(data.positions),
        colors: regl.buffer(data.colors),
        uvs: regl.buffer(data.uvs),
        normals: regl.buffer(data.normals),
        count: data.count,
        timestamp: performance.now(),
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

    altitude = Math.min(Math.max(altitude, 1), 10000000);

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

    let e = altitude + constants.earthRadius;// + getElevation(cam.getPosition());
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
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, -1, 1);

    regl.clear({
      color: [65/255,168/255,255/255,1],
      depth: 1,
    });

    const meshes = fetchMeshes(cam.getPosition());

    // (function() {
    //   const translation = vec3.sub([], [0,0,0], cam.getPosition());
    //   const model = mat4.fromTranslation([], translation);
    //   mat4.scale(model, model, [constants.earthRadius, constants.earthRadius, constants.earthRadius]);
    //   renderEarth({
    //     model: model,
    //     view: view,
    //     projection: projection,
    //     viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
    //     positions: underSphere.positions,
    //     uvs: underSphere.uvs,
    //     cells: underSphere.cells,
    //   });
    // })();

    
    let lastDepth = -1;
    if (altitude < 700000) {
      meshes.meshes.sort((a,b)=>a.node.id.length - b.node.id.length);
      for (let mesh of meshes.meshes) {
        const depth = mesh.node.id.length;
        if (depth !== lastDepth) {
          regl.clear({ depth: 1, });
          lastDepth = depth;
        }
        const translation = vec3.sub([], mesh.offset, cam.getPosition());
        const model = mat4.fromTranslation([], translation);
        renderTerrain({
          model: model,
          view: view,
          projection: projection,
          viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
          positions: mesh.positions,
          normals: mesh.normals,
          uvs: mesh.uvs,
          colors: mesh.colors,
          light: vec3.normalize([], cam.getPosition()),
          count: mesh.count
        });
      }
    }

    nodeCache.clean();
    cleanMeshes();

    document.getElementById('alt').innerText = `Altitude: ${Math.round(altitude)} meters`;

    const nodeStats = nodeCache.stats();
    document.getElementById('inflight-nodes').innerText = `Nodes in flight: ${nodeStats.inflight}`;
    document.getElementById('cached-nodes').innerText = `Nodes cached: ${nodeStats.cached}`;

    const inflightMeshes = Object.keys(terrainMeshesInFlight).length;
    document.getElementById('inflight-meshes').innerText = `Meshes in flight: ${inflightMeshes}`;
    const cachedMeshes = Object.keys(terrainMeshes).length;
    document.getElementById('cached-meshes').innerText = `Meshes cached: ${cachedMeshes}`;

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

function getUV(p) {
  const PI = Math.PI;
  p = vec3.normalize([], p);
  const y = p[0];
  const z = p[1]
  const x = p[2];
  const theta = Math.acos(z);
  const phi = Math.atan2(y,x);
  const px = (phi + PI)/(2 * PI);
  const py = theta / PI;
  return {
    x: clamp(px, 0, 1.0),
    y: clamp(py, 0, 1.0),
  };
}
