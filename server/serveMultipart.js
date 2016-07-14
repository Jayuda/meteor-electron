const fs = Npm.require('fs');
const url = Npm.require('url');
const path = Npm.require('path');
const parseRange = Npm.require('range-parser');
const sprintf = Npm.require('sprintf-js').sprintf;
const ss = Npm.require('stream-stream');
const Readable = Npm.require('stream').Readable;

/***
 * Creates a readable stream from a given text.
 * Useful for inserting the body headers for the partial chunks when request is
 * multipart/byteranges.
 *
 * @param {string} text - The text to be used as readable stream.
 * @return {Object} The readabla stream.
 * @see {@link http://stackoverflow.com/questions/12755997/how-to-create-streams-from-string-in-node-js/22085851#22085851|How to create streams from string in Node.js}
 * @since 0.1.4
 * @summary Creates a readable stream from a given text.
 * @version 1.0.0
 */
function stringReader(text) {
  var s = new Readable();
  s._read = function noop() {};
  s.push(text);
  s.push(null);
  return s;
}

/**
 * Serves multipart/byteranges requests (RFC2616, RFC7233).
 * Partially based on http://www.codeproject.com/Articles/813480/HTTP-Partial-Content-In-Node-js
 * by Robert Vandenberg Huang, licensed under CPOL v1.2
 *
 * @global
 * @see {@link https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.16|Content-Range (RFC2616)}
 * @see {@link https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.35.1|Range (RFC2616)}
 * @see {@link https://www.w3.org/Protocols/rfc2616/rfc2616-sec19.html#sec19.2|Multipart/byteranges (RFC2616)}
 * @see {@link https://tools.ietf.org/html/rfc7233|Range Requests (RFC7233)}
 * @see {@link http://www.codeproject.com/info/cpol10.aspx|CPOL v1.2 license}
 * @since 0.1.4
 * @summary Serves multipart/byteranges requests.
 * @version 1.0.0
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
      const filepath = path.join(MULTIPART_ROOT_PATH, url.parse(req.url, true, true).pathname.split('/').join(path.sep));
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
