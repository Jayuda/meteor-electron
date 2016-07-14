const EventEmitter = Npm.require('events');

serve = function(path, handler) {
  if (Package["iron:router"]){
    Package["iron:router"].Router.route(path, function(){
      handler(this.request, this.response, this.next);
    }, {where: "server"});
  } else if (Package["meteorhacks:picker"]){
    Package["meteorhacks:picker"].Picker.route(path, function(params, req, res, next){
      req.query = params.query;
      handler(req, res, next);
    });
  } else {
    WebApp.rawConnectHandlers.use(function(req, res, next){
      if (req._parsedUrl.query) {
        req.query = Npm.require('querystring').parse(req._parsedUrl.query);
      }
      if (req._parsedUrl.pathname === path) {
        handler(req, res, next);
      } else {
        next();
      }
    });
  }
};

serveDir = function(dir, handler){
  //path starts with dir
  if (Package["iron:router"]){
    Package["iron:router"].Router.route(dir + "/:stuff", function(){
      handler(this.request, this.response, this.next);
    }, {where: "server"});
  } else if (Package["meteorhacks:picker"]){
    Package["meteorhacks:picker"].Picker.route(dir + "/:stuff", function(params, req, res, next){
      req.query = params.query;
      handler(req, res, next);
    });
  } else {
    var regex = new RegExp("^" + dir);
    WebApp.rawConnectHandlers.use(function(req, res, next){
      if (regex.test(req.path)) {
        handler(req, res, next);
      } else {
        next();
      }
    });
  }
};

/**
 * Sends a HTTP response with the given parameters and ends it.
 *
 * @global
 * @param {Object} response - The HTTP response object.
 * @param {number} status - The HTTP status code (200, 206, 400,...).
 * @param {Object} [headers=null] - The headers to be sent with the response.
 * @param {string|Object} [body=null] - String or readable stream to be sent in the body.
 * @returns {Object} null
 * @since 0.1.4
 * @version 1.0.0
 */
sendResponse = function(response, status, headers, body) {
  headers = headers || null;
  body = body || null;
  if (headers) {
    response.writeHead(status, headers);
  } else {
    response.statusCode = status;
  }
  if (body instanceof EventEmitter && typeof body.read === 'function') { // readable stream
    body.on('open', function() {
      body.pipe(response);
    });
  } else if (_.isString(body)) {
    response.end(body);
  } else {
    response.end();
  }
  return null;
}
