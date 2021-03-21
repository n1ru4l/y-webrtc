function isString (s) {
  return Object.prototype.toString.call(s) == '[object String]'
}
function uInt8ToString (uintArray) {
  return new TextDecoder().decode(uintArray);
}
function createHexHash (algo, arrayBuffer, callback) {
  if (isString(arrayBuffer)) {
    let encoder = new TextEncoder('utf-8')
    arrayBuffer = encoder.encode(arrayBuffer)
  }
  crypto.subtle.digest(algo, arrayBuffer).then(function (hash) {
    let array = new Uint8Array(hash)
    callback(uInt8ToString(array))
  })
}

self.onmessage = async (e) => {
  let { buffer, uuid } = e.data
  createHexHash('SHA-512', buffer, (hash) => self.postMessage({ hash, uuid }))
}