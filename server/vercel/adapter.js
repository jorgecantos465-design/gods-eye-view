const BODY_REHYDRATED = Symbol('gev.vercel.body');

function bodyToBuffer(body, contentType = '') {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');

  if (
    /application\/x-www-form-urlencoded/i.test(String(contentType)) &&
    body &&
    typeof body === 'object' &&
    !Array.isArray(body)
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      }
    }
    return Buffer.from(params.toString(), 'utf8');
  }

  return Buffer.from(JSON.stringify(body ?? {}), 'utf8');
}

function rehydrateBody(req) {
  if (!req || req.body === undefined || req.body === null) return req;
  if (req[BODY_REHYDRATED]) return req;
  req[BODY_REHYDRATED] = true;

  const buffer = bodyToBuffer(
    req.body,
    req.headers?.['content-type'] ?? req.headers?.['Content-Type'] ?? '',
  );

  req[Symbol.asyncIterator] = function asyncIterator() {
    let consumed = false;
    return {
      next() {
        if (consumed) return Promise.resolve({ value: undefined, done: true });
        consumed = true;
        return Promise.resolve({ value: buffer, done: false });
      },
      return(value) {
        consumed = true;
        return Promise.resolve({ value, done: true });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };

  const listeners = { data: [], end: [], error: [] };
  const originalOn = typeof req.on === 'function' ? req.on.bind(req) : null;
  const originalRemove =
    typeof req.removeListener === 'function'
      ? req.removeListener.bind(req)
      : null;
  let emitted = false;

  const emitBody = () => {
    if (emitted) return;
    emitted = true;
    for (const listener of listeners.data.slice()) listener(buffer);
    for (const listener of listeners.end.slice()) listener();
  };

  const addListener = (event, listener) => {
    if (Object.hasOwn(listeners, event)) {
      listeners[event].push(listener);
      if (event === 'data') queueMicrotask(emitBody);
      return req;
    }
    return originalOn ? originalOn(event, listener) : req;
  };

  req.on = addListener;
  req.once = addListener;
  req.addListener = addListener;
  req.removeListener = (event, listener) => {
    if (Object.hasOwn(listeners, event)) {
      listeners[event] = listeners[event].filter(
        (registered) => registered !== listener,
      );
      return req;
    }
    return originalRemove ? originalRemove(event, listener) : req;
  };

  return req;
}

function routeSegments(value) {
  if (Array.isArray(value)) {
    return value.flatMap((part) => String(part).split('/')).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split('/').filter(Boolean);
  }
  return [];
}

function resolveRequestUrl(req) {
  const segments = routeSegments(req.query?.__gev_api_path);
  const pathname = segments.length ? '/api/' + segments.join('/') : '/api';
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '__gev_api_path') continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) query.append(key, String(item));
    }
  }

  const search = query.toString();
  return search ? pathname + '?' + search : pathname;
}

export { rehydrateBody, resolveRequestUrl };
