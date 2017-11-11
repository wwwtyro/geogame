"use strict";

const express = require('express');
const cors = require('cors');
const proxy = require('express-http-proxy');

const app = express();

app.use(cors());
app.use('/', proxy('s3.amazonaws.com', {
  https: true,
}));
app.use(cors());

// app.get('/:zoom/:x/:y', function(req, res, next) {
//   const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${req.params.zoom}/${req.params.x}/${req.params.y}.png`;
//   axios.get(url).then(function(response) {
//     res.send(response.data);
//   });
// });

app.listen(process.argv[2] || true, function() {
  console.log('Listening');
})

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
});
