'use strict';
/** An error the client is allowed to see. Anything else becomes a plain 500. */
class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const bad = (message, code = 'invalid') => new HttpError(422, code, message);
const notFound = (message = 'That item no longer exists.') => new HttpError(404, 'not_found', message);
const conflict = (message, code = 'conflict') => new HttpError(409, code, message);
const forbidden = (message = 'Your role does not allow this.') => new HttpError(403, 'forbidden', message);
const unauthorized = (message = 'Please sign in.') => new HttpError(401, 'unauthorized', message);

module.exports = { HttpError, bad, notFound, conflict, forbidden, unauthorized };
