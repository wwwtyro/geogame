"use strict";

const REGL = require('regl');
const glMatrix = require('gl-matrix');
const Sphere = require('./sphere');
const QuadSphere = require('../common/quadsphere');
const constants = require('../common/constants');
const SphereFPSCam = require('./sphere-fps-cam');
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

const meshWorker = new Worker('bundled-worker.js');
let requiredNodes = [];

main();

async function main() {

  const texture_img = await loadImage('texture.png');
  const color_img = await loadImage('earthcolor.jpg');
  const qs = QuadSphere(constants.earthRadius);
  const meshes = {};
  const meshesInFlight = {};
  const canvas = document.getElementById('render-canvas');
  const regl = REGL({
    canvas: canvas,
    extensions: ['EXT_frag_depth'],
  });


  meshWorker.onmessage = function(e) {
    const d = e.data;
    delete meshesInFlight[d.id];
    meshes[d.id] = {
      node: qs.nodeFromId(d.id),
      offset: d.offset,
      count: d.count,
      positions: regl.buffer(new Float32Array(d.positions)),
      normals: regl.buffer(new Float32Array(d.normals)),
      uvs: regl.buffer(new Float32Array(d.uvs)),
      noiseuvs: regl.buffer(new Float32Array(d.noiseuvs)),
      heightmap: new Float32Array(d.heightmap),
      timestamp: performance.now(),
    }
  }

  function elevation(p) {
    let nf, mesh = null, depth = constants.maxDepth;
    while (!mesh ) {
      nf = qs.pointToNodeFraction(p, depth);
      mesh = meshes[nf.node.id];
      depth -= 1;
      if (depth === -1) return 0.0;
    }
    const heightmap = meshes[nf.node.id].heightmap;
    let x0 = Math.floor(constants.nodeResolution * nf.fraction[0]);
    let y0 = Math.floor(constants.nodeResolution * nf.fraction[1]);
    const a = heightmap[constants.nodeResolution * (y0 + 0) + (x0 + 0)];
    const b = heightmap[constants.nodeResolution * (y0 + 0) + (x0 + 1)];
    const c = heightmap[constants.nodeResolution * (y0 + 1) + (x0 + 1)];
    const d = heightmap[constants.nodeResolution * (y0 + 1) + (x0 + 0)];
    let e = [a,b,c,d].reduce((i,j) => Math.max(i,j));
    if (isNaN(e)) return a;
    return e;
  }

  setInterval(function() {
    requiredNodes = getRequiredNodes(cam.getPosition());
    console.log(`Required nodes count: ${requiredNodes.length}`);
  }, 1000);

  function getRequiredNodes(p) {
    p = vec3.scale([], vec3.normalize([], p), constants.earthRadius);
    const nodes = [];
    qs.traverse(function(node, depth) {
      const radius = [node.sphere.sw, node.sphere.se, node.sphere.nw, node.sphere.ne]
        .map(a => vec3.distance(node.sphere.c, a))
        .reduce((a, b) => Math.max(a, b));
      const dist = vec3.distance(p, node.sphere.c);
      const angular_diameter = 2 * Math.asin(radius/dist);
      if (dist < 0 || angular_diameter < Math.PI/2 || depth === constants.maxDepth) {
        nodes.push(node);
        return false;
      }
      return true;
    });
    const maxDepth = nodes.map(n => n.id.length).reduce((a,b) => Math.max(a,b));
    return nodes;
  }


  function getMesh(node) {
    if (node.id in meshes) {
      meshes[node.id].timestamp = performance.now();
      return meshes[node.id];
    }
    if (node.id in meshesInFlight) {
      return null;
    }
    if (Object.keys(meshesInFlight).length > 7) {
      return null;
    }
    meshesInFlight[node.id] = true;
    meshWorker.postMessage({id: node.id});
    return null;
  }

  function fetchMeshes(p) {
    const nodes = requiredNodes.slice();
    nodes.sort(function(a, b) {
      const ca = vec3.scale([], vec3.normalize([], a.cube.c), constants.earthRadius);
      const cb = vec3.scale([], vec3.normalize([], b.cube.c), constants.earthRadius);
      const da = greatCircleDistance(p, ca);
      const db = greatCircleDistance(p, cb);
      return da - db;
    });
    const fetched = [];
    for (let node of nodes) {
      const mesh = getMesh(node);
      if (mesh) {
        fetched.push(mesh);
      }
    }
    return fetched;
  }

  function cleanMeshes(p) {
    const keys = Object.keys(meshes);
    if (keys.length < 512) return;
    keys.sort(function(a, b) {
      return meshes[a].timestamp - meshes[b].timestamp;
    });
    const key = keys[0];
    if (performance.now() - meshes[key].timestamp > 5000) {
      const m = meshes[key];
      m.positions.destroy();
      m.normals.destroy();
      m.uvs.destroy();
      m.noiseuvs.destroy();
      delete meshes[key];
    }
  }

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

  const underSphere = Sphere(128);
  underSphere.positions = regl.buffer(underSphere.positions);
  underSphere.uvs = regl.buffer(underSphere.uvs);

  const noiseTexture = regl.texture({
    data: texture_img,
    min: 'mipmap',
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
      attribute vec3 position, normal;
      attribute vec2 uv, noiseuv;
      uniform mat4 model, view, projection;
      uniform sampler2D earthTexture;
      varying float vLogZ;
      varying vec3 vColor, vNormal;
      varying vec2 vNoiseUV;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        float Fcoef = 2.0 / log2(100000000.0 + 1.0);
        gl_Position.z = log2(max(1e-6, 1.0 + gl_Position.w)) * Fcoef - 1.0;
        vLogZ = 1.0 + gl_Position.w;
        vColor = texture2D(earthTexture, uv).rgb;
        vNormal = normal;
        vNoiseUV = noiseuv;
      }
    `,
    frag: `
      #extension GL_EXT_frag_depth : enable
      precision highp float;
      uniform vec3 light;
      uniform sampler2D noiseTexture;
      varying float vLogZ;
      varying vec3 vColor, vNormal;
      varying vec2 vNoiseUV;
      void main() {
        float n = texture2D(noiseTexture, vNoiseUV).r;
        float l = clamp(dot(vNormal, light), 0.25, 1.0);
        gl_FragColor = vec4(clamp(2.0 * vColor * l, 0.0, 1.0) * n, 1);
        float Fcoef_half = 1.0 / log2(100000000.0 + 1.0);
        gl_FragDepthEXT = log2(vLogZ) * Fcoef_half;
      }
    `,
    attributes: {
      uv: regl.prop('uvs'),
      noiseuv: regl.prop('noiseuvs'),
      position: regl.prop('positions'),
      normal: regl.prop('normals'),
    },
    uniforms: {
      model: regl.prop('model'),
      view: regl.prop('view'),
      projection: regl.prop('projection'),
      light: regl.prop('light'),
      earthTexture: earthTexture,
      noiseTexture: noiseTexture,
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
    count: regl.prop('count'),
    cull: {
      enable: true,
      face: 'back',
    },
    depth: {
      enable: true,
    }
  });

  const camData = JSON.parse(localStorage.camData || `{"altitude":1000,"camDump":{"position":[-4773693.901540027,3750099.5086902347,-1945974.1763553189],"forward":[0.6580729702777001,0.7146290914223565,-0.2371607629494012],"opts":{"phi":0}}}`);
  let altitude = camData.altitude || 1000;
  // const camData = JSON.parse(`{"position":[-4773693.901540027,3750099.5086902347,-1945974.1763553189],"forward":[0.6580729702777001,0.7146290914223565,-0.2371607629494012]}`);
  let cam = SphereFPSCam(camData.camDump.position, camData.camDump.forward, camData.camDump.opts);

  setInterval(function() {
    localStorage.setItem('camData', JSON.stringify({
      camDump: cam.dump(),
      altitude: altitude,
    }));
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


  function loop() {

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

    const ele = elevation(cam.getPosition());
    let e = altitude + constants.earthRadius + ele;
    let delta = e - vec3.length(cam.getPosition());
    cam.moveUp(delta * 0.1);


    const view = cam.getView(true);
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, -1, 1);

    regl.clear({
      color: [65/255,168/255,255/255,1],
      depth: 1,
    });

    
    (function() {
      const translation = vec3.sub([], [0,0,0], cam.getPosition());
      const model = mat4.fromTranslation([], translation);
      mat4.scale(model, model, [constants.earthRadius, constants.earthRadius, constants.earthRadius]);
      renderEarth({
        model: model,
        view: view,
        projection: projection,
        viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
        positions: underSphere.positions,
        uvs: underSphere.uvs,
        count: underSphere.count,
      });
    })();
    
    const fetchedMeshes = fetchMeshes(cam.getPosition());
    
    if (altitude < 700000 || true) {
      fetchedMeshes.sort( (a, b) => a.node.id.length - b.node.id.length);
      for (let mesh of fetchedMeshes) {
        const translation = vec3.sub([], mesh.offset, cam.getPosition());
        const model = mat4.fromTranslation([], translation);
        renderTerrain({
          model: model,
          view: view,
          projection: projection,
          light: vec3.normalize([], cam.getPosition()),
          viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
          positions: mesh.positions,
          normals: mesh.normals,
          uvs: mesh.uvs,
          noiseuvs: mesh.noiseuvs,
          count: mesh.count,
        });
      }
    }

    cleanMeshes();

    document.getElementById('alt').innerText = `Altitude: ${Math.round(altitude)} meters`;

    const inflightMeshes = Object.keys(meshesInFlight).length;
    document.getElementById('inflight-meshes').innerText = `Heightmaps in flight: ${inflightMeshes}`;
    const cachedMeshes = Object.keys(meshes).length;
    document.getElementById('cached-meshes').innerText = `Heightmaps cached: ${cachedMeshes}`;

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
  document.getElementById('btn-half-dome').addEventListener('click', function() {
    const tmpData = JSON.parse(`{"position":[-4388737.000459448,3905540.419065803,-2489080.671623663],"forward":[-0.44682654443610614,0.06647549952156721,0.8921474357698098]}`);
    cam = SphereFPSCam(tmpData.position, tmpData.forward);
    altitude = 1000;
  });
  document.getElementById('btn-mount-everest').addEventListener('click', function() {
    const tmpData = JSON.parse(`{"position":[5630365.069495591,2997598.23949465,309110.51145426015],"forward":[0.10653175629126255,-0.09806507735329073,-0.9894615836429387]}`);
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


function greatCircleDistance(p0, p1) {
  p0 = vec3.normalize([], p0);
  p1 = vec3.normalize([], p1);
  const p0xp1 = vec3.cross([], p0, p1);
  const mp0xp1 = vec3.length(p0xp1);
  const p0dp1 = vec3.dot(p0, p1);
  return Math.atan2(mp0xp1, p0dp1) * constants.earthRadius;
}

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

function localurl(endpoint) {
  const url = location.protocol+'//'+location.hostname+(location.port ? ':'+location.port: '');
  return url + endpoint;
}