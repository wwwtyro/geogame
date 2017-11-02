"use strict";

module.exports = function(url_translator) {

  const cache = {};
  const inflight = {};

  function get(key) {

    if (key in cache) {
      return cache[key].data;
    }

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
        console.log(cache[key]);
      })
      .catch(err => console.log(err));

    return false;

  }

  return {
    get: get,
  };

}
