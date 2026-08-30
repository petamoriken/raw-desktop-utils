export function domException(name: string, message: string): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, name);
  }
  const error = new Error(message);
  error.name = name;
  return error;
}

export function notSupported(message: string): Error {
  return domException("NotSupportedError", message);
}

export function invalidState(message: string): Error {
  return domException("InvalidStateError", message);
}

export function indexSize(message: string): Error {
  return domException("IndexSizeError", message);
}
