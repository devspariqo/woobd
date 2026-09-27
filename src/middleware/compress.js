/**
 * Response compression, without a dependency.
 *
 * `theme.css` is 103KB and `main.js` is 39KB before compression, and both are
 * render-blocking on every page. Gzip takes them to roughly a fifth of that and
 * Brotli to a sixth, which is the single largest thing that can be done for
 * time-to-first-paint on this site.
 *
 * Written by hand rather than pulled in as `compression`, because the project
 * deploys to shared hosting where every added dependency is another thing that
 * has to survive `npm install` on the server. Node's `zlib` is built in.
 *
 * The approach is the standard one: intercept the body, hold it, and decide
 * what to do with it once the length is known. That decision cannot be made
 * earlier - whether compressing helps depends on how big the response turned
 * out to be, and the headers may already have been written by then.
 */
'use strict';

const zlib = require('zlib');

/**
 * Types worth compressing.
 *
 * Text compresses by 70-85%; a JPEG or a WebP is already compressed and
 * running it through gzip makes it marginally larger while burning CPU on every
 * request. Only the text-ish types are listed, so anything unlisted passes
 * through untouched - which is the safe default.
 */
const COMPRESSIBLE = /^(?:text\/(?!event-stream)|application\/(?:json|javascript|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json)|image\/svg\+xml|font\/(?:ttf|otf))/i;

/** Below this, the compressed form can be larger than the original. */
const DEFAULT_THRESHOLD = 1024;

/**
 * How much of a response may be held in memory before compression is abandoned.
 *
 * Every page this site serves is far under this, so it only ever fires on a
 * genuinely large streamed body - a big export, say - where buffering the whole
 * thing to compress it would cost more than the bandwidth saves.
 */
const MAX_BUFFER = 2 * 1024 * 1024;

/** Append to an existing Vary header without duplicating a value. */
function appendVary(current, value) {
  const existing = String(current || '').trim();
  if (!existing) return value;
  const parts = existing.split(',').map((part) => part.trim().toLowerCase());
  if (parts.includes('*') || parts.includes(value.toLowerCase())) return existing;
  return `${existing}, ${value}`;
}

function pickEncoding(header) {
  const accept = String(header || '');
  // Brotli first. Every browser that advertises it supports it, and it beats
  // gzip at the same level on exactly the payloads this site serves.
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

/**
 * @param {{threshold?: number, level?: number}} [options]
 */
module.exports = function compress(options) {
  const threshold = (options && options.threshold) || DEFAULT_THRESHOLD;

  return function compression(req, res, next) {
    // A HEAD response has no body, and anything but a GET is a write path whose
    // response is small - not worth the CPU.
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const encoding = pickEncoding(req.headers['accept-encoding']);
    if (!encoding) return next();

    const originalWrite = res.write;
    const originalEnd = res.end;
    const originalWriteHead = res.writeHead;

    const chunks = [];
    let total = 0;
    // Set once the body has been handed to the real res.end, after which
    // further writes must go straight through.
    let finished = false;
    // Set when this response has been given up on and handed back to Node.
    let streaming = false;

    function collect(chunk, enc) {
      if (!chunk) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc || 'utf8');
      chunks.push(buffer);
      total += buffer.length;
    }

    /** True when the response as it stands is a candidate for compression. */
    function mayCompress() {
      const type = String(res.getHeader('Content-Type') || '');
      const cacheControl = String(res.getHeader('Cache-Control') || '');
      return (
        res.statusCode >= 200 &&
        res.statusCode !== 204 &&
        res.statusCode !== 304 &&
        COMPRESSIBLE.test(type) &&
        !/no-transform/i.test(cacheControl)
      );
    }

    /**
     * Stop buffering and let the response stream as Node intended.
     *
     * Two things need this. A type that was never going to be compressed - the
     * SQL backup download is `application/sql` - should not be held in memory
     * at all. And a compressible body that grows past the cap would otherwise
     * let a single large export buffer the whole thing before the client sees
     * a byte.
     *
     * Whatever has been buffered is written out first, in order, and the
     * originals are restored. Nothing has been sent yet at this point -
     * Content-Encoding is only ever set once compression has actually
     * succeeded - so the response is still completely intact.
     */
    function releaseStream() {
      if (streaming) return;
      streaming = true;

      res.writeHead = originalWriteHead;
      res.write = originalWrite;
      res.end = originalEnd;

      for (const buffered of chunks) originalWrite.call(res, buffered);
      chunks.length = 0;
      total = 0;
    }

    /**
     * Hold the status and headers instead of flushing them.
     *
     * Express and the `send` package used by express.static both call
     * writeHead. Letting the first of those through would send the headers
     * before the body length is known, and Content-Encoding could then never
     * be added.
     *
     * The real writeHead is restored before the body is handed over. That
     * restore is load-bearing: Node flushes headers from its own
     * _implicitHeader(), which calls `this.writeHead` - and if this stub were
     * still installed at that point, it would swallow the flush and the
     * response would go out with no headers at all, which the browser sees as
     * an empty reply rather than an error.
     */
    res.writeHead = function writeHead(statusCode, statusMessage, headers) {
      if (typeof statusCode === 'number') res.statusCode = statusCode;
      // The signature allows (status, headers) as well as (status, message, headers).
      const headerBag = headers || (statusMessage && typeof statusMessage === 'object' ? statusMessage : null);
      if (headerBag) {
        for (const key of Object.keys(headerBag)) {
          if (headerBag[key] !== undefined) res.setHeader(key, headerBag[key]);
        }
      }
      return res;
    };

    res.write = function write(chunk, enc, callback) {
      if (finished || streaming) return originalWrite.call(res, chunk, enc, callback);

      // A streaming response whose type can never be compressed - a file
      // download, an image, a PDF. Hand it straight back rather than holding
      // it in memory to reach the same conclusion at the end.
      if (!mayCompress()) {
        releaseStream();
        return originalWrite.call(res, chunk, enc, callback);
      }

      collect(chunk, typeof enc === 'string' ? enc : undefined);

      if (total > MAX_BUFFER) {
        releaseStream();
        return true;
      }

      // Backpressure is not signalled: the body is being buffered anyway, so
      // there is no consumer to be slow. Reporting `false` here would make
      // callers pause for no reason.
      if (typeof enc === 'function') enc();
      else if (typeof callback === 'function') callback();
      return true;
    };

    res.end = function end(chunk, enc, callback) {
      if (typeof chunk === 'function') {
        callback = chunk;
        chunk = null;
        enc = null;
      } else if (typeof enc === 'function') {
        callback = enc;
        enc = null;
      }

      // Already handed back to Node - this is just the last chunk.
      if (streaming) return originalEnd.call(res, chunk, enc, callback);

      collect(chunk, typeof enc === 'string' ? enc : undefined);
      finished = true;

      // Hand the real writeHead back before anything else. Node's implicit
      // header flush goes through `this.writeHead`, so leaving the stub in
      // place here would send a response with no headers.
      res.writeHead = originalWriteHead;

      // Something already flushed the headers - a handler that called
      // flushHeaders. Compressing now would throw, so the body goes out as it
      // was written.
      if (res.headersSent) return originalEnd.call(res, Buffer.concat(chunks), callback);

      const body = Buffer.concat(chunks);

      const worthIt = mayCompress() && body.length >= threshold;

      if (!worthIt) {
        if (!res.getHeader('Content-Length')) res.setHeader('Content-Length', String(body.length));
        return originalEnd.call(res, body, callback);
      }

      const run = encoding === 'br' ? zlib.brotliCompress : zlib.gzip;
      run(body, (err, compressed) => {
        if (err) {
          // Compression is an optimisation. If it fails, the uncompressed
          // response is still a correct one.
          res.removeHeader('Content-Encoding');
          res.setHeader('Content-Length', String(body.length));
          return originalEnd.call(res, body, callback);
        }

        res.setHeader('Content-Encoding', encoding);
        // The compressed length is not known until now, and a stale
        // Content-Length makes the browser hang waiting for bytes that never
        // arrive. Removing it lets Node chunk the response.
        res.removeHeader('Content-Length');
        // Tells any cache in the path that the body depends on the request's
        // Accept-Encoding, so a gzipped copy is never served to a client that
        // did not ask for one.
        res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'Accept-Encoding'));
        originalEnd.call(res, compressed, callback);
      });

      return res;
    };

    next();
  };
};
