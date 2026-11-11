// Errors that are safe to log.
// The text of a parser or composer error can quote a piece of a message or an address.
// These helpers keep the kind of the problem and the place in the code, and drop the text.

// Replaces an error from a mail library with one that has a fixed text and a fixed code.
export function quietError(what, code) {
  const quiet = new Error(what);
  quiet.code = code;
  return quiet;
}

// The parts of any error that can go in the log.
export const safeError = (err) => ({
  name: err && err.name,
  code: err && (err.code || err.errcode),
  at: String((err && err.stack) || '').split('\n').filter((l) => /^\s+at /.test(l)).slice(0, 3).map((l) => l.trim()),
});
