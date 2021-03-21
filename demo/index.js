/* eslint-env browser */

import * as Y from 'yjs'
import { WebrtcProvider } from '../src/y-webrtc.js'

const ydoc = new Y.Doc()
const provider = new WebrtcProvider('prosemirror', ydoc)
const fileElement = document.querySelector('#myFile')
const imagesArray = ydoc.getArray('images')

provider.on('synced', synced => {
  // NOTE: This is only called when a different browser connects to this client
  // Windows of the same browser communicate directly with each other
  // Although this behavior might be subject to change.
  // It is better not to expect a synced event when using y-webrtc
  console.log('synced!', synced)
  fileElement.disabled = false
})
ydoc.on('afterTransaction', (transaction, doc) => {
  // figure out when synced
  fileElement.disabled = false
  console.log('doc', doc, transaction, doc.toJSON())
  /* TODO: figure out when the array is filled or just poll
  imagesArray.forEach((image, index) => {
    // TODO: duplicates not supported
    let { name, type, buffer } = image.toJSON()
    createElement({ name, type, buffer })
  })
  */
})
fileElement.onchange = (event) => {
  for (const file of fileElement.files) {
    let reader = new FileReader()
    reader.onload = function (e) {
      console.log(file, e)
      let fileModel = Object.entries({ // map from entries
        name: file.name,
        type: file.type,
        buffer: new Uint8Array(reader.result)
      })
      ydoc.transact(() => {
        imagesArray.push([new Y.Map(fileModel)])
      })
    }
    reader.readAsArrayBuffer(file)
  }
  fileElement.value = ''
}
function createElement ({ name, type, buffer}) {
  let imagesElem = document.querySelector('#images')
  if (imagesElem.querySelector(`#image-${name}`)) return // exists
  // image container and give id to find for deletion
  let containerElem = document.createElement('div')
  containerElem.id = `image-${name}`
  containerElem.classList.add('container')

  // create button to remove & delete image from YArray
  let removeElem = document.createElement('button')
  removeElem.innerHTML = 'X'
  removeElem.classList.add("remove-button")
  removeElem.onclick = () => {
    imagesArray.forEach((image, index) => {
      // TODO: duplicates not supported
      if (name === image.get('name')) {
        console.log('REMOVE', image)
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
function removeElement ({ name }) {
  // containers & elements
  let containerElem = document.getElementById(`image-${name}`)
  let imageElem = containerElem.querySelector('img')

  // clean up on aisle browser
  URL.revokeObjectURL(imageElem.src)

  containerElem.parentNode.removeChild(containerElem)
}
imagesArray.observe((event, transaction) => {
  console.log('yarray updated: ', event, transaction)
  let { changes } = event
  // when files are added to array
  for (const change of changes.added.values()) {
    let { name, type, buffer } = change.content.type.toJSON()
    createElement({ name, type, buffer })
  }

  // when files are deleted from array
  for (const change of changes.deleted.values()) {
    // Delete set has already completed, no data
    // let { name, type, buffer } = change.content.type.toJSON()
    // internal _map still contains the necessary data
    // we could do all this in the onclick handler instead, but it won't trigger
    // on other clients.
    let name = change.content.type._map.get('name').content.arr[0]
    removeElement({ name })
  }
})
// @ts-ignore
window.example = { provider, ydoc, imagesArray }

console.log(window.example)
