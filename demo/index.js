/* eslint-env browser */

import * as Y from 'yjs'
import { WebrtcProvider } from '../src/y-webrtc.js'

const ydoc = new Y.Doc()
const provider = new WebrtcProvider('prosemirror', ydoc)
const fileElement = document.querySelector('#myFile')
const imagesArray = ydoc.getArray('images')
const syncProof = ydoc.getText('sync-proof')
const hashWorker = new Worker('./hash-worker.js')
const hashMap = new Map()
imagesArray.observe((event, transaction) => {
  // console.log('yarray updated: ', event, transaction)
  let { changes } = event
  // when files are added to array
  for (const change of changes.added.values()) {
    let { name, type, buffer, uuid } = change.content.type.toJSON()
    console.log('ADDING', name, type)
    createElement({ name, type, buffer, uuid })
  }

  // when files are deleted from array
  for (const change of changes.deleted.values()) {
    // Delete set has already completed, no data
    // let { name, type, buffer, uuid } = change.content.type.toJSON()
    // internal _map still contains the necessary data
    // we could do all this in the onclick handler instead, but it won't trigger
    // on other clients.
    let uuid = change.content.type._map.get('uuid').content.arr[0]
    removeElement({ uuid })
  }
})
ydoc.on('afterTransaction', (transaction, doc) => {
  // figure out when synced
  fileElement.disabled = false
  /* TODO: figure out when the array is filled or just poll
  console.log('doc', doc, transaction, doc.toJSON())
  imagesArray.forEach((image, index) => {
    // TODO: duplicates not supported
    let { name, type, buffer } = image.toJSON()
    createElement({ name, type, buffer })
  })
  */
  calcProof().then(({ hash }) => {
    console.log('calcProof', hash)
  })
})
hashWorker.onmessage = function (e) {
  let {
    uuid,
    hash
  } = e.data
  let exist = hashMap.get(uuid)
  if (!exist) hashMap.set(uuid, hash)
  else {
    // we're going to make this ugly
    // if it's a string, set the new value
    // if it's a function, call the function with the result
    // so anyone can generate a uuid and get a return value
    // to a callback
    // if anyone extends this, just turn it into a promise setup
    // by generating uuids to the worker
    // and matching results from the message by uuid
    if (isString(hash)) {
      hashMap.set(uuid, hash)
    } else if (isFunction(hash)) {
      hash(e.data)
      hashMap.delete(uuid, hash)
    }
  }
}
provider.on('peers', (events) => {
  for (const peerId of events.removed) {
    console.log(`removed:webrtc:[${peerId}]`)
  }
  for (const peerId of events.added) {
    console.log(`added:webrtc:[${peerId}]`)
  }
})
provider.on('synced', synced => {
  // NOTE: This is only called when a different browser connects to this client
  // Windows of the same browser communicate directly with each other
  // Although this behavior might be subject to change.
  // It is better not to expect a synced event when using y-webrtc
  console.log('synced!', synced)
  fileElement.disabled = false
})
fileElement.onchange = async (event) => {
  // chunk transactions to reduce load
  let chunks = chunkArray([...fileElement.files], 5)
  let transactions = []
  // process chunks into transactions
  for (const chunk of chunks) {
    let promises = chunk.map((file) => {
      return new Promise((resolve, reject) => {
        let reader = new FileReader()
        reader.onload = function (e) {
          let buffer = new Uint8Array(reader.result)
          let uuid = generateUuid()
          let fileModel = Object.entries({ // map from entries
            name: file.name,
            type: file.type,
            uuid,
            buffer
          })
          let msg = { uuid, buffer }
          hashWorker.postMessage(msg)
          resolve(fileModel)
        }
        reader.readAsArrayBuffer(file)
      })
    })
    transactions.push(promises)
  }
  let commit = async (r) => {
    ydoc.transact(() => {
      r.map(f => imagesArray.push([new Y.Map(f)]))
    })
  }
  let functionProcessCommits = async () => {
    let tr = transactions.shift()
    if (tr) {
      let results = await Promise.all(tr)
      commit(results)
    } else {
      imagesArray.unobserve(functionProcessCommits)
    }
  }
  imagesArray.observe(functionProcessCommits)
  functionProcessCommits()
  fileElement.value = ''
}
function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
const isFunction = (file) => {
  return Object.prototype.toString.call(file) === '[object Function]'
}
function isString (s) {
  return Object.prototype.toString.call(s) == '[object String]'
}
function calcProof () {
  return new Promise((resolve, reject) => {
    let hash = [...hashMap.entries()]
      .filter(([k, v]) => isString(v))
      .map(([k, v]) => v)
      .sort() // we're ignoring the order of the keys. If you extend this, you'll want to perserve the order in the imagesArray
      .join()
    let uuid = generateUuid()
    hashMap.set(uuid, resolve)
    let msg = { uuid, buffer: hash }
    hashWorker.postMessage(msg)
  })
}
function generateUuid () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    let r = Math.random()*16|0, v = c === 'x' ? r : ((r&0x3)|0x8)
    return v.toString(16)
  })
}
function chunkArray(array, size) {
  const chunkedArr = []
  const totalSize = array.length || array.byteLength
  let index = 0
  while (index < totalSize) {
    chunkedArr.push(array.slice(index, size + index))
    index += size
  }
  return chunkedArr
}
function urlSafeSelector (value) {
  return value.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, "-").replace(' ','')
}
function createElement ({ name, type, buffer, uuid }) {
  let imagesElem = document.querySelector('#images')
  let imageName = urlSafeSelector(name)
  console.log(imageName)
  if (imagesElem.querySelector(`#image-${uuid}`)) return // exists
  // image container and give id to find for deletion
  let containerElem = document.createElement('div')
  containerElem.id = `image-${uuid}`
  containerElem.classList.add('container')

  // create button to remove & delete image from YArray
  let removeElem = document.createElement('button')
  removeElem.innerHTML = 'X'
  removeElem.classList.add("remove-button")
  removeElem.onclick = () => {
    imagesArray.forEach((image, index) => {
      if (uuid === image.get('uuid')) {
        console.log('REMOVE', image)
        let uuid = image.get('uuid')
        hashMap.delete(uuid)
        ydoc.transact(() => {
          imagesArray.delete(index, 1)
        })
      }
    })
  }

  // create image from File and object url
  let imageElem = document.createElement('img')
  let file = new File([buffer], name, { type })
  imageElem.src = URL.createObjectURL(file)

  // add elements to images container
  containerElem.appendChild(imageElem)
  containerElem.appendChild(removeElem)
  imagesElem.appendChild(containerElem)
}
function removeElement ({ uuid }) {
  // containers & elements
  let containerElem = document.getElementById(`image-${uuid}`)
  let imageElem = containerElem.querySelector('img')

  // clean up on aisle browser
  URL.revokeObjectURL(imageElem.src)

  containerElem.parentNode.removeChild(containerElem)
}

// @ts-ignore
window.example = { provider, ydoc, imagesArray }

console.log(window.example)
