import * as Y from 'yjs' // eslint-disable-line
import Peer from 'simple-peer/simplepeer.min.js'

export const CHUNK_SIZE = (1024 * 16) - 512 // 16KB - data header
export const XSTATUS_WAIT_SYNC = 'wait'
export const XSTATUS_SENT_SYNC = 'sending'
export const XSTATUS_HAVE_SYNC = 'ready'
export const TX_SEND_TIMEOUT = 500

const uInt8Concatenate = (array) => {
  let length = array
    .reduce((acc, i) => { acc += i.length; return acc }, 0)
  let position = 0
  let merged = new Uint8Array(length)
  for (const item of array) {
    merged.set(item, position)
    position += item.length
  }
  return merged
}

class SimplePeerExtended extends Peer {
  constructor(opts) {
    super(opts)
    this._opts = opts

    this.txDoc = Y.Doc()
    this.txStatus = XSTATUS_WAIT_SYNC
    this._txQueue = []
    this._txSent = []
    this._tx
    this._txOrdinal = 0
    this.rxDoc = Y.Doc()
    this.rxStatus = XSTATUS_WAIT_SYNC
    this._rxOrdinal = 0
  }
  sortPacketArray (a, b) {
    return (a.get('txOrd') > b.get('txOrd')
      ? 1
      : -1
  }
  packetArray (array, size) {
    const txOrd = this._txOrdinal
    this._txOrdinal++
    const chunkedArr = []
    const totalSize = array.length || array.byteLength
    let index = 0
    while (index < length) {
      chunkedArr.push(array.slice(index, size + index))
      index += size
    }
    return chunkedArr.reduce((chunk, index) => {
      let packet = new Y.Map()
      packet.set('chunk', chunk)
      packet.set('txOrd', txOrd)
      packet.set('index', index)
      packet.set('length', chunkedArr.length)
      packet.set('totalSize', totalSize)
      packet.set('chunkSize', chunk.byteLength)
      return packet
    }
  }
  send (chunk) {
    if (chunk instanceof ArrayBuffer) chunk = new Uint8Array(data)
    let chunks = this.packetArray(chunk, CHUNK_SIZE)
    this._txQueue.concat(chunks)
    this._txSend()
  }
  _txSend () {
    if (this.txStatus === XSTATUS_WAIT_SYNC) {
      let txDocState = Y.encodeStateAsUpdate(this.txDoc)
      this.txStatus = XSTATUS_SENT_SYNC
      this._channel.send(txDocState)
    } else if (this.txStatus === XSTATUS_SENT_SYNC) {
      setTimeout(() => this._txSend(), TX_SEND_TIMEOUT)
    } else if (this.txStatus === XSTATUS_HAVE_SYNC) {
      if (!this._txDocOnUpdate) {
        let fn = (msg) => this._channel.send(msg)
        this._txDocOnUpdate = fn.bind(this)
        this.txDoc.on('update', this._txDocOnUpdate)
      }
      if (this._txQueue.length === 0) return 
      this.txDoc.transact(() => {
        let packet = this._txQueue.shift()
        let packets = this.txDoc.getArray(packet.txOrd)
        packets.push(packet)
        this._txSend()
      })
    }
  }
  rxDocOnUpdate (doc, transactions) {
    for (tr of transactions) {
      let { changed } = tr
      for (const [ type, txOrd ] of changed) {
        let packets = type.toArray()
        if (!packets.length) continue // no packets

        let firstPacket = packets[0]

        if (txOrd !== firstPacket.get('txOrd')) continue // not a packet array

        let totalSize = firstPacket.get('totalSize')
        if (totalSize === firstPacket.get('chunkSize')) {
          this.push(firstPacket.get('chunk'))
          continue
        }
        let totalLength = firstPacket.get('length')
        if (totalLength < packets.length) continue // not enough packets

        let indices = packets.map(p => p.get('index'))
        if (totalLength < new Set(indices).size) continue // not enough packets // duplicates

        let chunkArray = packets.sort(this.sortPacketArray)
        let currentSize = chunkArray.reduce((agg, packet) => agg + packet.get('chunkSize'))
        if (totalSize === currentSize) {
          let buffers = chunkArray.map((packet) => packet.get('chunk'))
          let data = uInt8Concatenate(buffers)
          this.txDoc.transact(() => {
            console.log(this.txDoc)
            this.push(data)
          })
        } else {
          console.warn('MisMatchedPacketSizes', chunkArray)
        }
      }
    }
    // this.rxDoc.getArray(this._rxOrdinal)
    // review transactions
    // start a rxOrdinal and increment as full packets received
    // delete completed queues
    // signal txDoc of completions / missings if skipped oridinal
    // ???
    // this.push(data)
  }
  _onChannelMessage (event) {
    let { data } = event
    if (data instanceof ArrayBuffer) data = new Uint8Array(data)
    if (rxStatus === XSTATUS_WAIT_SYNC) {
      Y.applyUpdate(this.rxDoc, data, { status: XSTATUS_HAVE_SYNC })
      let rxDocState = Y.encodeStateAsUpdate(this.rxDoc)
      this.rxStatus = XSTATUS_HAVE_SYNC
      this._channel.send(rxDocState)
    } else if (this.txStatus === XSTATUS_SENT_SYNC) {
      Y.applyUpdate(this.txDoc, data, { status: XSTATUS_HAVE_SYNC })
      this.txStatus = XSTATUS_HAVE_SYNC
    } else {
      if (!this._rxDocOnUpdate) {
        let fn = (msg) => this._channel.send(msg)
        this._rxDocOnUpdate = this.rxDocOnUpdate.bind(this)
        this.txDoc.on('afterAllTransactions', this._rxDocOnUpdate)
      }
      Y.applyUpdate(this.rxDoc, data, { status: XSTATUS_HAVE_SYNC })
    }
  }
  /*
  send (chunk) {
    this._channel.send(chunk)
  }
  _onChannelMessage (event) {
    if (this.destroyed) return
    let data = event.data
    if (data instanceof ArrayBuffer) data = Buffer.from(data)
    this.push(data)
  }

  */
}