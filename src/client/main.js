"use strict";

const REGL = require('regl');
const glMatrix = require('gl-matrix');
const Sphere = require('./sphere');
const rti = require('ray-triangle-intersection');
const sprintf = require('sprintf').sprintf;
const Howl = require('howler').Howl;
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;
const QuadSphere = require('../common/quadsphere');
const constants = require('../common/constants');
const SphereFPSCam = require('./sphere-fps-cam');

const meshWorker = new Worker('bundled-worker.js');
let requiredNodes = [];
let cam;

main();

async function main() {
  const ws = new WebSocket(`ws://${location.hostname + (location.port ? ':'+location.port : '')}`);
  ws.onopen = function() {
    setInterval(function() {
      if (cam === undefined) return;
      ws.send(JSON.stringify({
        type: 'location', 
        position: cam.position,
        theta: cam.theta,
        phi: cam.phi,
      }));
    }, 100);
  };

  const players = {};

  ws.onmessage = function(e) {
    const data = JSON.parse(e.data);
    if (data.type === 'enter') {
      console.log(`${data.id} has joined the game.`);
      players[data.id] = {
        current: { position: [1000000,0,0], theta: 0, phi: 0 },
        target: { position: [1000000,0,0], theta: 0, phi: 0 },
      };
    }
    if (data.type === 'exit') {
      console.log(`${data.id} has left the game.`);
      delete players[data.id];
    }
    if (data.type === 'location') {
      if (data.id in players) {
        players[data.id].target.position = data.position;
        players[data.id].target.theta = data.theta;
        players[data.id].target.phi = data.phi;
      }
    }
  };

  const soundSteps = [];
  for (let i = 1; i <= 7; i++) {
    soundSteps.push(new Howl({
      src: `step-0${i}.wav`,
    }));
  }
  soundSteps.lastPlay = -Infinity;

  const soundWind = new Howl({
    src: 'wind.mp3',
    html5: true,
    volume: 1.0,
    loop: true,
    autoplay: true,
  });

  const soundGrunt = new Howl({
    src: 'grunt.wav',
    html5: true,
    volume: 0.5,
  });

  const soundJump = new Howl({
    src: 'jump.wav',
    html5: true,
    volume: 0.5,
  });

  const texture_img = await loadImage('texture.png');
  const color_img = await loadImage('earthcolor.jpg');
  const face_img = await loadImage('face.png');
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

  function getElevation(p) {
    let nf, mesh = null, depth = constants.maxDepth;
    while (!mesh ) {
      nf = qs.pointToNodeFraction(p, depth);
      mesh = meshes[nf.node.id];
      depth -= 1;
      if (depth === -1) return 0.0;
    }
    const heightmap = meshes[nf.node.id].heightmap;
    let x0 = Math.floor((constants.nodeResolution - 1) * nf.fraction[0]);
    let y0 = Math.floor((constants.nodeResolution - 1) * nf.fraction[1]);
    const a = heightmap[constants.nodeResolution * (y0 + 0) + (x0 + 0)];
    const b = heightmap[constants.nodeResolution * (y0 + 0) + (x0 + 1)];
    const c = heightmap[constants.nodeResolution * (y0 + 1) + (x0 + 1)];
    const d = heightmap[constants.nodeResolution * (y0 + 1) + (x0 + 0)];
    const va = [x0 + 0, y0 + 0, a];
    const vb = [x0 + 1, y0 + 0, b];
    const vc = [x0 + 1, y0 + 1, c];
    const vd = [x0 + 0, y0 + 1, d];
    const pf = [nf.fraction[0] * (constants.nodeResolution - 1), nf.fraction[1] * (constants.nodeResolution - 1), 10000];
    let pt = rti([], pf, [0,0,-1], [va,vb,vc]);
    pt = pt || rti([], pf, [0,0,-1], [va,vc,vd]);
    return pt[2];
  }

  function getNegativeGradient(p) {
    let {forward, right, up, view} = SphereFPSCam(p, 0, 0);
    const e0 = getElevation(p);
    const ef = getElevation(vec3.add([], p, vec3.scale([], forward, 0.01)));
    const er = getElevation(vec3.add([], p, vec3.scale([], right, 0.01)));
    const df = (ef - e0) / 0.01;
    const dr = (er - e0) / 0.01;
    const fs = vec3.scale([], forward, -df);
    const rs = vec3.scale([], right, -dr);
    return vec3.normalize([], vec3.add([], fs, rs));
  }

  setInterval(function() {
    if (cam.position.some(a => isNaN(a))) throw "Cam NaN";
    requiredNodes = getRequiredNodes(cam.position);
    // console.log(`Required nodes count: ${requiredNodes.length}`);
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
    cam.phi += e.movementY * -0.001;
    cam.phi = Math.min(Math.max(-0.999 * Math.PI/2, cam.phi), 0.999 * Math.PI/2);
    cam.theta -= e.movementX * 0.001;
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

  const charSphere = Sphere(32);
  charSphere.positions = regl.buffer(charSphere.positions);
  charSphere.uvs = regl.buffer(charSphere.uvs);  

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
  });

  const faceTexture = regl.texture({
    data: face_img,
    min: 'mipmap',
    mag: 'linear',
    wrap_s: 'repeat',
    wrap_t: 'repeat',
  });

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
        gl_Position.z = log2(max(1000.0, 1.0 + gl_Position.w)) * Fcoef - 1.0;
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
        float l = clamp(dot(vNormal, light), 0.0, 1.0);
        gl_FragColor = vec4(vColor * l * n, 1);
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

  const renderTexturedSphere = regl({
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
        gl_FragColor = vec4(c.rgb, 1);
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
      texture: regl.prop('texture'),
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

  const camData = JSON.parse(localStorage.camData || "{}");
  cam = {
    position: camData.position || [-4772871.832154342,3759742.5922662276,-1945180.8136176735],
    theta: camData.theta || -9.487000000000005,
    phi: camData.phi || -0.07499999999999693,
    acceleration: [0,0,0],
    velocity: [0,0,0],
    previouslyAirborne: false,
  };

  setInterval(function() {
    localStorage.setItem('camData', JSON.stringify({
      position: cam.position,
      theta: cam.theta,
      phi: cam.phi,
    }));
  }, 1000);

  const keyboard = {
    up: false,
    down: false,
    left: false,
    right: false,
    shift: false,
    space: false,
  }

  window.addEventListener('keydown', function(e) {
    if (e.which === 32) keyboard.space = true;
    if (e.which === 16) keyboard.shift = true;
    if (e.which === 87) keyboard.up = true;
    if (e.which === 83) keyboard.down = true;
    if (e.which === 65) keyboard.left = true;
    if (e.which === 68) keyboard.right = true;
  });

  window.addEventListener('keyup', function(e) {
    if (e.which === 32) keyboard.space = false;
    if (e.which === 16) keyboard.shift = false;
    if (e.which === 87) keyboard.up = false;
    if (e.which === 83) keyboard.down = false;
    if (e.which === 65) keyboard.left = false;
    if (e.which === 68) keyboard.right = false;
  });


  function updatePhysics() {
    let {forward, right, up, view} = SphereFPSCam(cam.position, cam.theta, cam.phi);
    
    const nForward = vec3.normalize([], vec3.sub([], forward, vec3.scale([], up, vec3.dot(up, forward))));

    const speed = keyboard.shift ? constants.runSpeed : constants.walkSpeed;

    const acceleration = [0,0,0];

    let elevation = getElevation(cam.position);
    let altitude = vec3.length(cam.position) - (constants.earthRadius + elevation);
    
    const vForward = vec3.dot(cam.velocity, forward);
    const vRight = vec3.dot(cam.velocity, right);
    const runAcceleration = [0,0,0];
    const airborne = altitude > 1.62 + 0.1;
    const dt = 1/60;

    if (!airborne) {
      if (keyboard.up) {
        vec3.add(runAcceleration, runAcceleration, vec3.scale([], nForward, 16));
      } 
      
      if (keyboard.down) {
        vec3.add(runAcceleration, runAcceleration, vec3.scale([], nForward, -16));
      }

      if (keyboard.right) {
        vec3.add(runAcceleration, runAcceleration, vec3.scale([], right, 16));
      }
  
      if (keyboard.left) {
        vec3.add(runAcceleration, runAcceleration, vec3.scale([], right, -16));
      }

      const testV = vec3.add([], cam.velocity, vec3.scale([], runAcceleration, dt));
  
      if (vec3.length(testV) < speed * 1) {
        vec3.add(acceleration, acceleration, runAcceleration);
      }
  
      if (vec3.length(cam.velocity) > 0) {
        const runFriction = vec3.scale([], vec3.normalize([], cam.velocity), -16);
        if (vec3.length(runAcceleration) > 0) {
          const runDir = vec3.normalize([], runAcceleration);
          vec3.sub(runFriction, runFriction, vec3.scale([], runDir, vec3.dot(runFriction, runDir)));
        }
        vec3.add(acceleration, acceleration, runFriction);
        if (performance.now() - soundSteps.lastPlay > 1250/vec3.length(cam.velocity)) {
          const sound = soundSteps[Math.floor(Math.random() * soundSteps.length)]
          sound.volume(Math.random() * 0.05 + 0.05);
          sound.play();
          soundSteps.lastPlay = performance.now();
        }
      }
    }

    if (!airborne && keyboard.space) {
      vec3.add(acceleration, acceleration, vec3.scale([], up, 512 ));
      const sound = soundSteps[Math.floor(Math.random() * soundSteps.length)]
      sound.volume(0.5);
      sound.play();
      if (Math.random() < 0.5) soundJump.play();
    }

    if (!airborne && cam.previouslyAirborne) {
      const sound = soundSteps[Math.floor(Math.random() * soundSteps.length)]
      sound.volume(0.5);
      sound.play();
      if (Math.random() < 0.5) soundGrunt.play();
    }

    cam.previouslyAirborne = airborne;

    // Add gravity.
    vec3.add(acceleration, acceleration, vec3.scale([], up, -constants.g));
    
    // Euler step.
    vec3.add(cam.velocity, cam.velocity, vec3.scale([], acceleration, dt));
    vec3.add(cam.position, cam.position, vec3.scale([], cam.velocity, dt));
    
    // Constrain the camera to the surface. 
    const elevation2 = getElevation(cam.position);
    const altitude2 = vec3.length(cam.position) - (constants.earthRadius + elevation2);
    if (altitude2 < 1.72 && !keyboard.space) {
      cam.position = vec3.scale([], vec3.normalize([], cam.position), (constants.earthRadius + elevation2 + 1.62));
      const down = vec3.negate([], up);
      vec3.sub(cam.velocity, cam.velocity, vec3.scale([], down, vec3.dot(cam.velocity, down)));
    }

    if (!airborne && vec3.length(cam.velocity) < 2e-1) {
      cam.velocity = [0,0,0];
    }

  }

  function loop() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    updatePhysics();
    let elevation = getElevation(cam.position);
    let altitude = vec3.length(cam.position) - (constants.earthRadius + elevation);

    let {forward, right, up, view} = SphereFPSCam(cam.position, cam.theta, cam.phi);
    
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, -1, 1);

    regl.clear({
      color: [65/255,168/255,255/255,1],
      depth: 1,
    });

    
    (function() {
      const translation = vec3.sub([], [0,0,0], cam.position);
      const model = mat4.fromTranslation([], translation);
      mat4.scale(model, model, [constants.earthRadius, constants.earthRadius, constants.earthRadius]);
      renderTexturedSphere({
        model: model,
        view: view,
        projection: projection,
        viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
        positions: underSphere.positions,
        uvs: underSphere.uvs,
        count: underSphere.count,
        texture: earthTexture,
      });
    })();
    
    const fetchedMeshes = fetchMeshes(cam.position);
    
    fetchedMeshes.sort( (a, b) => a.node.id.length - b.node.id.length);
    for (let mesh of fetchedMeshes) {
      const translation = vec3.sub([], mesh.offset, cam.position);
      const model = mat4.fromTranslation([], translation);
      renderTerrain({
        model: model,
        view: view,
        projection: projection,
        light: vec3.normalize([], cam.position),
        viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
        positions: mesh.positions,
        normals: mesh.normals,
        uvs: mesh.uvs,
        noiseuvs: mesh.noiseuvs,
        count: mesh.count,
        texture: earthTexture,
      });
    }

    (function() {
      for (let id in players) {
        let player = players[id];
        vec3.add(player.current.position, player.current.position, vec3.scale([], vec3.sub([], player.target.position, player.current.position), 0.1));
        player.current.theta += 0.25 * (player.target.theta - player.current.theta);
        player.current.phi += 0.25 * (player.target.phi - player.current.phi);

        const playerView = SphereFPSCam(player.current.position, player.current.theta + Math.PI, -player.current.phi).view;
        const transform = mat4.invert([], playerView);
        const translation = mat4.fromTranslation([], vec3.sub([], player.current.position, cam.position));
        const model = mat4.mul([], translation, transform);
        renderTexturedSphere({
          model: model,
          view: view,
          projection: projection,
          viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
          positions: charSphere.positions,
          uvs: charSphere.uvs,
          count: charSphere.count,
          texture: faceTexture,
        });
      }
    })();

    cleanMeshes();

    const sAlt = sprintf('%.2f', altitude);
    const sVel = sprintf('%.2f', vec3.length(cam.velocity));
    document.getElementById('alt').innerText = `Altitude: ${sAlt} meters, ${sVel} m/s`;

    const inflightMeshes = Object.keys(meshesInFlight).length;
    document.getElementById('inflight-meshes').innerText = `Heightmaps in flight: ${inflightMeshes}`;
    const cachedMeshes = Object.keys(meshes).length;
    document.getElementById('cached-meshes').innerText = `Heightmaps cached: ${cachedMeshes}`;

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  document.getElementById('btn-grand-canyon').addEventListener('click', function() {
    cam.position = [-4772871.832154342,3759742.5922662276,-1945180.8136176735];
    cam.theta = -9.487000000000005;
    cam.phi = -0.07499999999999693;
    
  });
  document.getElementById('btn-mount-fuji').addEventListener('click', function() {
    cam.position = [3433157.340778073,3693343.218749532,-3911668.0304175606];
    cam.theta = -17.345000000000002;
    cam.phi = -0.2349999999999965;
    
  });
  document.getElementById('btn-half-dome').addEventListener('click', function() {
    cam.position = [-4387910.072484764,3906575.434746918,-2488367.502929643];
    cam.theta = -4.202000000000007;
    cam.phi = 0.08900000000000322;
    
  });
  document.getElementById('btn-mount-everest').addEventListener('click', function() {
    cam.position = [5630255.332315452,2997280.489363976,304577.6889533865];
    cam.theta = -3.4360000000000177;
    cam.phi = -0.07799999999999958;
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