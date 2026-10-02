function pathnameOf(url) {
  const raw = String(url || '/');
  const queryIndex = raw.indexOf('?');
  const hashIndex = raw.indexOf('#');
  let end = raw.length;
  if (queryIndex !== -1) end = Math.min(end, queryIndex);
  if (hashIndex !== -1) end = Math.min(end, hashIndex);
  const pathname = raw.slice(0, end);
  return pathname || '/';
}

function matchesMount(pathname, route) {
  if (route === '') return true;
  if (pathname.toLowerCase().slice(0, route.length) !== route.toLowerCase()) {
    return false;
  }
  const boundary = pathname.length > route.length ? pathname[route.length] : '';
  return boundary === '' || boundary === '/' || boundary === '.';
}

function finishRequest(res, error) {
  if (res.headersSent || res.writableEnded) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (error) {
    console.error('[vercel-router] unhandled provider error:', error?.stack || error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'proxy_error' }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not Found' }));
}

function createMountRouter() {
  const stack = [];

  const router = {
    use(path, handler) {
      let route = path;
      let fn = handler;
      if (typeof path !== 'string') {
        fn = path;
        route = '/';
      }
      if (typeof fn !== 'function') {
        throw new TypeError('router.use requires a middleware function');
      }
      if (route.endsWith('/')) route = route.slice(0, -1);
      stack.push({ route, handler: fn });
      return router;
    },

    handle(req, res, done) {
      const complete =
        typeof done === 'function' ? done : (error) => finishRequest(res, error);
      if (req.originalUrl == null) req.originalUrl = req.url;

      let index = 0;

      const dispatch = (error) => {
        if (res.writableEnded) return;

        const layer = stack[index++];
        if (!layer) {
          complete(error);
          return;
        }

        const originalUrl = req.url;
        const pathname = pathnameOf(originalUrl);
        if (!matchesMount(pathname, layer.route)) {
          dispatch(error);
          return;
        }

        if (layer.route !== '') {
          let remainder = originalUrl.slice(layer.route.length);
          if (!remainder.startsWith('/')) remainder = '/' + remainder;
          req.url = remainder;
        }

        const next = (nextError) => {
          req.url = originalUrl;
          dispatch(nextError);
        };

        const isErrorHandler = layer.handler.length >= 4;
        if (Boolean(error) !== isErrorHandler) {
          next(error);
          return;
        }

        try {
          const result = isErrorHandler
            ? layer.handler(error, req, res, next)
            : layer.handler(req, res, next);
          if (result && typeof result.then === 'function') {
            result.catch(next);
          }
        } catch (handlerError) {
          next(handlerError);
        }
      };

      dispatch();
    },
  };

  return router;
}

export { createMountRouter };
