import * as Y from 'yjs' // eslint-disable-line
import Peer from 'simple-peer/simplepeer.min.js'

export const CHUNK_SIZE = (1024 * 16) - 512 // 16KB - data header
export const XSTATUS_WAIT_SYNC = 'wait'
export const XSTATUS_SENT_SYNC = 'sending'
export const XSTATUS_HAVE_SYNC = 'ready'
export const XSTATUS_PACKET_SYNC = 'packet-sync'
export const XSTATUS_DELETE_SYNC = 'packet-delete'
export const TX_SEND_TIMEOUT = 500
export const TX_SEND_THROTTLE = 10
export const TX_SEND_TTL = 1000 * 60 // 1 minute
export const MAX_BUFFERED_AMOUNT = 64 * 1024 // simple peer value

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

    this.txDoc = new Y.Doc()
    this.txStatus = XSTATUS_WAIT_SYNC
    this._txQueue = []
    this._txSent = []
    this._tx
    this._txOrdinal = 0
    this.rxDoc = new Y.Doc()
    this.rxStatus = XSTATUS_WAIT_SYNC
    this.setupTypes()
    console.log(this)
  }
  setupTypes () {
    this._txReceivedArray()
    this._txPacketsMap()
    this._rxReceivedArray()
    this._rxPacketsMap()
    let txSend = (msg) => {
      if (this._channel) this._channel.send(msg)
      else this.destroy()
      setTimeout(() => this._txSend(), TX_SEND_THROTTLE)
      // console.log('_txSend', this.txDoc.toJSON())
    }
    this._txDocOnUpdate = txSend.bind(this)
    this.txDoc.on('update', this._txDocOnUpdate)
  }
  _txReceivedArray () {
    return this.txDoc.getArray('received')
  }
  _txPacketsMap () {
    return this.txDoc.getMap('packets')
  }
  _rxReceivedArray () {
    return this.rxDoc.getArray('received')
  }
  _rxPacketsMap () {
    return this.rxDoc.getMap('packets')
  }
  sortPacketArray (a, b) {
    return a.get('index') > b.get('index')
      ? 1
      : -1
  }
  packetArray (array, size) {
    const txOrd = this._txOrdinal
    this._txOrdinal++
    const chunkedArr = []
    const totalSize = array.length || array.byteLength
    let index = 0
    while (index < totalSize) {
      chunkedArr.push(array.slice(index, size + index))
      index += size
    }
    return chunkedArr.map((chunk, index) => {
      let packet = {
        chunk,
        txOrd,
        index,
        length: chunkedArr.length,
        totalSize,
        chunkSize: chunk.byteLength
      }
      return packet
    })
  }
  send (chunk) {
    console.log('tx', chunk)
    if (chunk instanceof ArrayBuffer) chunk = new Uint8Array(data)
    let chunks = this.packetArray(chunk, CHUNK_SIZE)
    this._txQueue = this._txQueue.concat(chunks)
    this._txSend()
  }
  _txCleanup (txOrd) {
    console.log('_txCleanup', txOrd, this._txPacketsMap().get(txOrd))
    return this.txDoc.transact(() => {
      this._txPacketsMap().delete(txOrd)
    })
  }
  _txSend () {
    if (this.txStatus === XSTATUS_WAIT_SYNC) {
      let txDocState = Y.encodeStateAsUpdate(this.txDoc)
      this.txStatus = XSTATUS_SENT_SYNC
      // console.log(this.txStatus, txDocState)
      this._channel.send(txDocState)
    } else if (this.txStatus === XSTATUS_SENT_SYNC) {
      setTimeout(() => this._txSend(), TX_SEND_TIMEOUT)
    } else if (this.txStatus === XSTATUS_HAVE_SYNC) {
      if (this._txQueue.length === 0) return
      this.txDoc.transact(() => {
        let packet = this._txQueue.shift()
        let packetMap = new Y.Map(Object.entries(packet))
        let packets = this._txPacketsMap().get(packet.txOrd)
        if (packets) {
          packets.push([packetMap])
        } else {
          packets = new Y.Array()
          packets.push([packetMap])
          this._txPacketsMap().set(packet.txOrd, packets)
        }
        if (this._txQueue.length > 0) {
          if (this._txQueue[0].txOrd > packet.txOrd) {
            setTimeout(() => this._txCleanup(packet.txOrd), TX_SEND_TTL)
          }
        } else {
          setTimeout(() => this._txCleanup(packet.txOrd), TX_SEND_TTL)
        }
      })
    }
  }
  rxDocOnUpdate ({ origin }, doc) {
    if (origin && origin.status === XSTATUS_PACKET_SYNC) {
      this._rxProcessPackets()
    }
  }
  _rxProcessPackets () {
    let rxCleanups = []
    let txCleanups = []
    let txReceived = this._txReceivedArray().toArray()
    let rxReceived = this._rxReceivedArray().toArray()
    let rxPackets = this._rxPacketsMap()
    let txOrdinals = [...rxPackets.keys()]
    if (txOrdinals.length === 0) return
    for (let txOrd of txOrdinals) {
      let cleanRxFn = () => {
        this._rxPacketsMap().delete(txOrd)
        this._rxReceivedArray().push([txOrd])
      }
      let cleanTxFn = () => this._txReceivedArray().push([txOrd])
      if (rxReceived.indexOf(txOrd) !== -1) {
        rxCleanups.push(cleanRxFn)
        txCleanups.push(cleanTxFn)
        continue
      }
      let packets = rxPackets
        .get(txOrd)
        .toArray()
      if (!packets.length) continue // no packets

      let firstPacket = packets[0]
      if (parseInt(txOrd) !== firstPacket.get('txOrd')) continue // not a packet array [NOTE: keys come out as string]


      let totalSize = firstPacket.get('totalSize')
      if (totalSize === firstPacket.get('chunkSize')) {
        this.push(firstPacket.get('chunk'))
        rxCleanups.push(cleanRxFn)
        txCleanups.push(cleanTxFn)
        continue
      }
      let totalLength = firstPacket.get('length')
      let indices = packets.map(p => p.get('index'))
      if (totalLength < new Set(indices).size) continue // not enough packets // duplicates

      let currentSize = packets.reduce((agg, p) => agg + p.get('chunkSize'), 0)
      if (totalSize === currentSize) {
        let buffers = packets
          .sort(this.sortPacketArray)
          .map(p => p.get('chunk'))
        let data = uInt8Concatenate(buffers)
        // console.log('rx', data)
        this.push(data)
        rxCleanups.push(cleanRxFn)
        txCleanups.push(cleanTxFn)
        continue
      }
      if (totalLength === new Set(indices).size) {
        console.warn('FailedBufferOrSizeConversion', packets)
      }

    }
    this.rxDoc.transact(() => {
      rxCleanups.map(fn => fn())
    }, { status: XSTATUS_DELETE_SYNC })
    this.txDoc.transact(() => {
      txCleanups.map(fn => fn())
    }, { status: XSTATUS_DELETE_SYNC })
  }
  _onChannelMessage (event) {
    let { data } = event
    if (data instanceof ArrayBuffer) data = new Uint8Array(data)
    if (this.rxStatus === XSTATUS_WAIT_SYNC) {
      Y.applyUpdate(this.rxDoc, data, { status: XSTATUS_HAVE_SYNC })
      let rxDocState = Y.encodeStateAsUpdate(this.rxDoc)
      this.rxStatus = XSTATUS_HAVE_SYNC
      this._channel.send(rxDocState)
    } else if (this.txStatus === XSTATUS_SENT_SYNC) {
      Y.applyUpdate(this.txDoc, data, { status: XSTATUS_HAVE_SYNC })
      this.txStatus = XSTATUS_HAVE_SYNC
    } else {
      if (!this._rxDocOnUpdate) {
        this._rxDocOnUpdate = this.rxDocOnUpdate.bind(this)
        this.rxDoc.on('afterTransaction', this._rxDocOnUpdate)
      }
      console.log('_rxRecieve', this.rxDoc.toJSON())
      Y.applyUpdate(this.rxDoc, data, { status: XSTATUS_PACKET_SYNC })
      this.emit('buffer-synced')
    }
  }
  /* SimplePeer functions for reference
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

export default SimplePeerExtended
