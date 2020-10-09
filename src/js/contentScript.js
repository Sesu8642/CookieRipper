'use strict'
/*
 * this script is injected into websites because dom storage is only accessible from there (i think)
 */
var unwantedDomStorageEntries = []
init()
async function init() {
  await deleteExistingUnwantedStorageEntries()
  await injectScript()
}
// only answer messages from background script if in the top frame
if (window == window.top) {
  browser.runtime.onMessage.addListener(handleMessage)
}
window.addEventListener('message', async event => {
  try {
    if (event.data.type) {
      switch (event.data.type) {
        case 'cookieRipper_domStorageSet':
          await handleNewDomStorageItem(event.data)
          break
        case 'cookieRipper_injectedScriptIsDone':
          await deleteExistingUnwantedStorageEntries()
          break
        default:
          // nothing to do, might be some other message the website sent
      }
    }
  } catch (e) {
    console.error(e)
  }
})

function handleMessage(request) {
  // when a message is received, decides how to respond
  switch (request.type) {
    case 'getStorage':
      return sendStorage()
      break
    case 'getUnwantedStorage':
      return Promise.resolve(unwantedDomStorageEntries)
    case 'deleteEntry':
      return deleteStorageEntry(request)
      break
    case 'deleteUnwantedEntriesByName':
      return deleteUnwantedStorageEntriesByName(request)
      break
    case 'deleteUnwantedEntry':
      return deleteUnwantedStorageEntry(request)
    case 'restoreUnwantedEntriesByName':
      return restoreUnwantedStorageEntriesByName(request)
      break
    case 'restoreUnwantedEntries':
      return restoreUnwantedStorageEntries()
      break
    case 'deleteExistingUnwantedEntriesByName':
      return deleteExistingUnwantedStorageEntriesByName(request)
      break
    case 'deleteExistingUnwantedEntries':
      return deleteExistingUnwantedStorageEntries()
      break
    case 'addEntry':
      return addStorageEntry(request)
      break
    case 'clearStorage':
      return clearStorage()
      break
    default:
      console.error(Error(`Unknown request type: ${request.type}`))
  }
}

async function sendStorage() {
  // sends both local and session storage
  return {
    localStorage: JSON.stringify(localStorage),
    sessionStorage: JSON.stringify(sessionStorage)
  }
}

async function deleteStorageEntry(request) {
  // deletes a given storage entry
  if (request.entry.persistent) {
    localStorage.removeItem(request.entry.name)
  } else {
    sessionStorage.removeItem(request.entry.name)
  }
  return
}

async function clearStorage() {
  // deletes all local and session storage entries
  localStorage.clear()
  sessionStorage.clear()
  unwantedDomStorageEntries = []
}

async function addStorageEntry(request) {
  // adds the given entry to the given storage
  let storage = request.persistent ? localStorage : sessionStorage
  storage.setItem(request.name, request.value)
}
async function deleteUnwantedStorageEntriesByName(request) {
  // deletes entries with a given name from unwanted list
  unwantedDomStorageEntries = unwantedDomStorageEntries.filter(entry => {
    return (!(entry.name === request.name))
  })
}
async function deleteUnwantedStorageEntry(request) {
  // deletes an entry from unwanted list
  unwantedDomStorageEntries = unwantedDomStorageEntries.filter(entry => {
    return (!(entry.name === request.entry.name && entry.persistent === request.entry.persistent))
  })
}
async function restoreUnwantedStorageEntriesByName(request) {
  // re-creates the entries with the given name from unwanted list (possibly two: one permanent, one temporary)
  unwantedDomStorageEntries.forEach(entry => {
    if (entry.name === request.name) {
      let storage = entry.persistent ? localStorage : sessionStorage
      storage.setItem(entry.name, entry.value)
    }
  })
  await deleteUnwantedStorageEntriesByName(request)
}
async function restoreUnwantedStorageEntries() {
  // re-creates wanted dom storage entries from unwanted list
  let domain = window.location.host
  let storageItems = []
  unwantedDomStorageEntries.forEach(entry => {
    // create list of storage items and send them to the background page
    storageItems.push({
      name: entry.name,
      persistent: entry.persistent
    })
  })
  let response = await browser.runtime.sendMessage({
    type: 'getTabDomStorageItemsAllowedStates',
    items: storageItems,
    domain: domain
  })
  // restore the wanted items
  for (let i = 0; i < response.length; i++) {
    if (response[i]) {
      unwantedDomStorageEntries.forEach(async entry => {
        if (entry.name === storageItems[i].name && entry.persistent === storageItems[i].persistent) {
          let storage = entry.persistent ? localStorage : sessionStorage
          storage.setItem(entry.name, entry.value)
        }
        await deleteUnwantedStorageEntry({
          entry: entry
        })
      })
    }
  }
}
async function deleteExistingUnwantedStorageEntriesByName(request) {
  // deletes existung but unwanted entries by name
  let domain = window.location.host
  // create list of storage items and send them to the background page
  let existingItems = []
  let singleItemPerm
  if (sessionStorage.getItem(request.name) !== null) {
    singleItemPerm = false
    existingItems.push({
      name: request.name,
      persistent: false
    })
  }
  if (localStorage.getItem(request.name) !== null) {
    singleItemPerm = true
    existingItems.push({
      name: request.name,
      persistent: true
    })
  }
  let wanted = await browser.runtime.sendMessage({
    type: 'getTabDomStorageItemsAllowedStates',
    items: existingItems,
    domain: domain
  })
  if (wanted.length === 1) {
    // either a temporary or permanent entry exists
    if (wanted[0] === false) {
      let storage = singleItemPerm ? localStorage : sessionStorage
      unwantedDomStorageEntries.push({
        name: request.name,
        value: storage.getItem(request.name),
        persistent: singleItemPerm
      })
      storage.removeItem(request.name)
    }
    return
  }
  if (wanted[0] === false) {
    unwantedDomStorageEntries.push({
      name: request.name,
      value: sessionStorage.getItem(request.name),
      persistent: false
    })
    sessionStorage.removeItem(request.name)
  }
  if (wanted[1] === false) {
    unwantedDomStorageEntries.push({
      name: request.name,
      value: localStorage.getItem(request.name),
      persistent: true
    })
    localStorage.removeItem(request.name)
  }
}
async function deleteExistingUnwantedStorageEntries() {
  // deletes all existung but unwanted entries
  let domain = window.location.host
  // create list of storage items and send them to the background page
  let storageItems = []
  for (let i = 0; i < localStorage.length; i++) {
    storageItems.push({
      name: localStorage.key(i),
      persistent: true
    })
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    storageItems.push({
      name: sessionStorage.key(i),
      persistent: false
    })
  }
  let response = await browser.runtime.sendMessage({
    type: 'getTabDomStorageItemsAllowedStates',
    items: storageItems,
    domain: domain
  })
  // delete the unwanted items
  for (let i = 0; i < response.length; i++) {
    if (!response[i]) {
      let storage = storageItems[i].persistent ? localStorage : sessionStorage
      unwantedDomStorageEntries.push({
        name: storageItems[i].name,
        value: storage.getItem(storageItems[i].name),
        persistent: storageItems[i].persistent
      })
      storage.removeItem(storageItems[i].name)
    }
  }
}
async function injectScript() {
  // adds a script tag into the html document to notify when dom storage is written
  // using a string loads faster than the js from the website using a separate js file does not
  let script = document.createElement('script')
  script.src = browser.runtime.getURL('js/inject.js')
  // Add the script tag to the DOM
  (document.head || document.documentElement).appendChild(script)
  script.remove()
}
async function handleNewDomStorageItem(request) {
  // if a new dom storage entry was set, delete or keep it
  let storageItems = [{
    name: request.name,
    persistent: request.persistent
  }]
  let response = await browser.runtime.sendMessage({
    type: 'getTabDomStorageItemsAllowedStates',
    items: storageItems,
    domain: window.location.host
  })
  // delete the item if unwanted
  if (!response[0]) {
    let storage = request.persistent ? localStorage : sessionStorage
    storage.removeItem(request.name)
    // if the item is in the unwanted list already, remove it first
    for (let i = 0; i < unwantedDomStorageEntries.length; i++) {
      if (unwantedDomStorageEntries[i].name === request.name && unwantedDomStorageEntries[i].persistent === request.persistent) {
        unwantedDomStorageEntries.splice(i)
      }
    }
    // add entry to unwanted list
    unwantedDomStorageEntries.push({
      name: request.name,
      value: request.value,
      persistent: request.persistent
    })
  }
}