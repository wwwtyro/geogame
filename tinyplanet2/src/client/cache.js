"use strict";

module.exports = function(url_translator) {

  const cache = {};
  const inflight = {};

  function get(key) {
    if (key in cache) {
      cache[key].timestamp = performance.now();
      return cache[key].data;
    }
    if (stats().inflight >= 8) return false;
    if (key in inflight) return false;
    const url = url_translator(key);
    inflight[key] = true;
    fetch(url)
      .then(response => {
        delete inflight[key];
        return response.json();
      })
      .then(data => {
        cache[key] = {
          data: data,
          timestamp: performance.now(),
          key: key,
        };
      })
      .catch(err => console.log(err));
    return false;
  }


  function clean() {
    const keys = Object.keys(cache);
    if (keys.length === 0) return;
    const key = keys[Math.floor(Math.random() * keys.length)];
    if (performance.now() - cache[key].timestamp > 5000) {
      delete cache[key];
    }
  }


  function stats() {
    return {
      inflight: Object.keys(inflight).length,
      cached: Object.keys(cache).length,
    };
  }

  return {
    get: get,
    clean: clean,
    stats: stats,
  };

}
