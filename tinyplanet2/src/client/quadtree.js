'use strict';

const vec3 = require('gl-matrix').vec3;


function node(sw, se, ne, nw, id) {

  const q = {};
  q.sw = sw.slice();
  q.se = se.slice();
  q.nw = nw.slice();
  q.ne = ne.slice();

  q.right = vec3.scale([], vec3.sub([], q.se, q.sw), 0.5);
  q.up = vec3.scale([], vec3.sub([], q.nw, q.sw), 0.5);

  q.c = vec3.add([], vec3.add([], q.sw, q.right), q.up);
  q.n = vec3.add([], q.nw, q.right);
  q.s = vec3.add([], q.sw, q.right);
  q.e = vec3.add([], q.se, q.up);
  q.w = vec3.add([], q.sw, q.up);

  q.id = id === undefined ? '0' : id;

  return q;

}


function traverse(q, test, depth) {

  depth = depth === undefined ? 0 : depth;

  if (test(q, depth)) {
    traverse(node(q.sw, q.s, q.c, q.w, q.id + 'a'), test, depth + 1);
    traverse(node(q.s, q.se, q.e, q.c, q.id + 'b'), test, depth + 1);
    traverse(node(q.c, q.e, q.ne, q.n, q.id + 'c'), test, depth + 1);
    traverse(node(q.w, q.c, q.n, q.nw, q.id + 'd'), test, depth + 1);
  }

}


async function traverse_async(q, test, depth) {

  depth = depth === undefined ? 0 : depth;

  if (await test(q, depth)) {
    await traverse_async(node(q.sw, q.s, q.c, q.w, q.id + 'a'), test, depth + 1);
    await traverse_async(node(q.s, q.se, q.e, q.c, q.id + 'b'), test, depth + 1);
    await traverse_async(node(q.c, q.e, q.ne, q.n, q.id + 'c'), test, depth + 1);
    await traverse_async(node(q.w, q.c, q.n, q.nw, q.id + 'd'), test, depth + 1);
  }

}


module.exports = {
  node: node,
  traverse: traverse,
  traverse_async: traverse_async,
};
