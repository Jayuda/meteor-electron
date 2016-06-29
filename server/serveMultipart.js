const fs = Npm.require('fs');
const url = Npm.require('url');
const path = Npm.require('path');
const parseRange = Npm.require('range-parser');
const sprintf = Npm.require('sprintf-js').sprintf;
const ss = Npm.require('stream-stream');
const Readable = Npm.require('stream').Readable;

function sendResponse(response, status, headers, readable) {
  headers = headers || null;
  readable = readable || null;
  if (headers) {
    response.writeHead(status, headers);
  } else {
    response.statusCode = status;
  }
  if (readable) {
    readable.on('open', function() {
      readable.pipe(response);
    });
  } else {
    response.end();
  }
  return null;
}

// See http://stackoverflow.com/questions/12755997/how-to-create-streams-from-string-in-node-js/22085851#22085851
function stringReader(text) {
  var s = new Readable();
  s._read = function noop() {};
  s.push(text);
  s.push(null);
  return s;
}

/**
 * Serves multipart/byteranges requests (RFC2616, RFC7233).
 *
 * @see Content-Range: https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.16
 * @see Range: https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.35.1
 * @see Multipart/byteranges: https://www.w3.org/Protocols/rfc2616/rfc2616-sec19.html#sec19.2
 * @see Range Requests (RFC7233): https://tools.ietf.org/html/rfc7233
 * @see Partially based on http://www.codeproject.com/Articles/813480/HTTP-Partial-Content-In-Node-js by Robert Vandenberg Huang, licensed under CPOL v1.2
 * @see Licensed under CPOL v1.2 (http://www.codeproject.com/info/cpol10.aspx)
 */
serveMultipart = function() {
  // If serving partial/differential downloads of AppImage from Meteor...
  if (DOWNLOAD_URLS[Platform.LINUX]
    && DOWNLOAD_URLS[Platform.LINUX][LinuxFormat.APPIMAGE]
    && DOWNLOAD_URLS[Platform.LINUX][LinuxFormat.APPIMAGE].lastIndexOf(ROOT_URL, 0) === 0
  ) {
    const appImageRoute = DOWNLOAD_URLS[Platform.LINUX][LinuxFormat.APPIMAGE].replace(ROOT_URL, '');
    serve(appImageRoute, function(req, res, next) {
      // Check method
      if (req.method !== 'GET') { // forbidden method
        return sendResponse(res, 405, {'Allow': 'GET'}); // 405 'Method Not Allowed'
      }

      // Check requested file
      const filepath = path.join(PARTIALS_ROOT_PATH, url.parse(req.url, true, true).pathname.split('/').join(path.sep));
      const filestat = fs.statSync(filepath);
      const fileext = path.extname(filepath).toLowerCase();
      const mimeType = MimeTypes[fileext] || 'application/octet-stream';
      if (!fs.existsSync(filepath)) { // requested file does not exist
        return sendResponse(res, 404); // 404 'Not Found'
      }

      // Check requested range
      if (!req.headers.range) { // if no range provided in header, return file directly
        return sendResponse(res, 200, { // 200 'OK'
            'Accept-Ranges': 'bytes',
            'Content-Length': filestat.size,
            'Content-Type': mimeType
          }, fs.createReadStream(filepath));
      }

      var range = parseRange(filestat.size, req.headers.range);
      console.log('***range:', range);
      if (_.isEmpty(range)) {
        return sendResponse(res, 204); // 204 'No Content'
      } else if (range === -2) { // malformed header string
        return sendResponse(res, 400); // 400 'Bad Request'
      } else if (range === -1) { // unsatisfiable range
        return sendResponse(res, 416, {'Content-Range': 'bytes */' + filestat.size}); // 416 'Requested Range Not Satisfiable'
      } else if (range.length > 0 && range.type === 'bytes') {
        // 'chunked' is the default value for partial content, but AppImage uses zsync,
        // which requires explicitly avoiding it (see http://zsync.moria.org.uk/server)
        const transferEncoding = fileext.substr(1) === LinuxFormat.APPIMAGE.toLowerCase() ? '' : 'chunked';
        console.log('***file extension:', fileext, fileext.substr(1), LinuxFormat.APPIMAGE, fileext.substr(1) === LinuxFormat.APPIMAGE, transferEncoding);
        const commonHeaders = {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          'Transfer-Encoding': transferEncoding,
        };
        if (range.length === 1) { // unique chunk
          const r = range[0];
          return sendResponse(res, 206, _.defaults({ // 206 'Partial Content'
              'Content-Length': (r.start === r.end) ? 0 : (r.end - r.start + 1),
              'Content-Range': sprintf('bytes %s-%s/%s', r.start, r.end, filestat.size),
              'Content-Type': mimeType,
            }, commonHeaders), fs.createReadStream(filepath, r));
        } else { // multiple chunks
          // Pre-calc header for each chunk and content length
          // See http://stackoverflow.com/questions/18315787/http-1-1-response-to-multiple-range
          const bodyHeaders = _.map(range, function(r, index) {
            return sprintf("%1$s--%2$s%1$sContent-Type: %3$s%1$sContent-Range: bytes %4$s-%5$s/%6$s%1$s%1$s",
              CRLF, MULTIPART_BOUNDARY, mimeType, r.start, r.end, filestat.size);
          });
          const multipartEnding = sprintf("%s--%s--", CRLF, MULTIPART_BOUNDARY);
          var contentLength = _.reduce(bodyHeaders, function(sum, header, index) {
            const rangeLength = (range[index].start === range[index].end)
              ? 0 : (range[index].end - range[index].start + 1);
            return sum + Buffer.byteLength(header) + rangeLength;
          }, 0);
          contentLength += Buffer.byteLength(multipartEnding);
          res.writeHead(206, _.defaults({ // 206 'Partial Content'
            'Content-Type': 'multipart/byteranges; boundary=' + MULTIPART_BOUNDARY,
            'Content-Length': contentLength,
          }, commonHeaders));

          // Send all chunks in order
          var stream = ss();
          _.each(range, function(r, index) {
            stream.write(stringReader(bodyHeaders[index]));
            stream.write(fs.createReadStream(filepath, r));
          });
          stream.write(stringReader(multipartEnding));
          stream.end();
          stream.pipe(res);
        }
      }
    });
  }
}
