/* eslint-env browser */

import * as Y from 'yjs'
import { WebrtcProvider } from '../src/y-webrtc.js'

const ydoc = new Y.Doc()
const provider = new WebrtcProvider('prosemirror', ydoc)
const fileElement = document.querySelector('#myFile')

provider.on('synced', synced => {
  // NOTE: This is only called when a different browser connects to this client
  // Windows of the same browser communicate directly with each other
  // Although this behavior might be subject to change.
  // It is better not to expect a synced event when using y-webrtc
  console.log('synced!', synced)
  fileElement.disabled = false
})

const imagesArray = ydoc.getArray('images')

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
  fileElement.files.length = 0
}
imagesArray.observe((event, transaction) => {
  console.log('yarray updated: ', event, transaction)
  let { changes } = event
  // when files are added to array
  for (const change of changes.added.values()) {
    console.log('updated:', change)
    let { name, type, buffer } = change.content.type.toJSON()
    let imagesElem = document.querySelector('#images')

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
        if (image === change.content.type) {
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

  // when files are deleted from array
  for (const change of changes.deleted.values()) {
    console.log(event, transaction)
    // Delete set has already completed, no data
    // let { name, type, buffer } = change.content.type.toJSON()
    // internal _map still contains the necessary data
    // we could do all this in the onclick handler instead, but it won't trigger
    // on other clients.
    let name = change.content.type._map.get('name').content.arr[0]

    // containers & elements
    let containerElem = document.getElementById(`image-${name}`)
    let imageElem = containerElem.querySelector('img')

    // clean up on aisle browser
    URL.revokeObjectURL(imageElem.src)

    containerElem.parentNode.removeChild(containerElem)
  }
})
// @ts-ignore
window.example = { provider, ydoc, imagesArray }

console.log(window.example)
