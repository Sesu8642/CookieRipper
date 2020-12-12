'use strict'
/*
 * this script is injected into websites because dom storage is only accessible from there (i think)
 */
/* prefix for permanent dom storage entries converted into temporary ones */
const CONVERT_PREFIX = '__CR_'
var unwantedDomStorageEntries = []
init()
async function init() {
  await handleExistingUnwantedStorageEntries()
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
          await deleteInvalidPrefixItems();
          await handleExistingUnwantedStorageEntries()
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
      break
    case 'deleteEntry':
      return deleteStorageEntry(request)
      break
    case 'deleteUnwantedEntriesByName':
      return deleteUnwantedStorageEntriesByName(request)
      break
    case 'deleteUnwantedEntry':
      return deleteUnwantedStorageEntry(request)
      break
    case 'restoreUnwantedEntriesByName':
      return restoreUnwantedStorageEntriesByName(request)
      break
    case 'restoreUnwantedEntries':
      return restoreUnwantedStorageEntries()
      break
    case 'handleExistingUnwantedEntriesByName':
      return handleExistingUnwantedStorageEntriesByName(request)
      break
    case 'handleExistingUnwantedEntries':
      return handleExistingUnwantedStorageEntries()
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
  unwantedDomStorageEntries.filter(entry => entry.name === request.name).forEach(entry => {
    let storage = entry.persistent ? localStorage : sessionStorage
    storage.setItem(entry.name, entry.value)
  })
  await deleteUnwantedStorageEntriesByName(request)
}
async function restoreUnwantedStorageEntries() {
  // re-creates wanted dom storage entries from unwanted list
  let domain = window.location.hostname
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
    if (response[i] === 'd') {
      continue;
    }
    let storage
    let prefix = ''
    if (response[i] === 'c') {
      // create as temporary entry; c cannot mean to convert the other way bc no info about conversion is in the unwanted list
      storage = sessionStorage;
      prefix = CONVERT_PREFIX;
    } else if (response[i] === 'k') {
      // create entry in original storage
      storage = storageItems[i].persistent ? localStorage : sessionStorage
    }
    // the response does (on purpose) not contain enough information to restore the entry so it must be found in the unwanted entries again
    unwantedDomStorageEntries.forEach(async entry => {
      if (entry.name === storageItems[i].name && entry.persistent === storageItems[i].persistent) {
        storage.setItem(`${prefix}${entry.name}`, entry.value)
        await deleteUnwantedStorageEntry({
          entry: entry
        })
      }
    })
  }
}
async function handleExistingUnwantedStorageEntriesByName(request) {
  // handles existung but unwanted entries by name
  let domain = window.location.hostname
  // create list of storage items and send them to the background page
  let existingItems = []
  if (sessionStorage.getItem(request.name) !== null) {
    let isConverted = request.name.startsWith(CONVERT_PREFIX);
    let nameWithoutPrefix = isConverted ? request.name.substring(CONVERT_PREFIX.length) : request.name
    existingItems.push({
      name: nameWithoutPrefix,
      persistent: false,
      isConverted: isConverted
    })
  }
  if (localStorage.getItem(request.name) !== null) {
    existingItems.push({
      name: request.name,
      persistent: true,
      isConverted: false
    })
  }
  let response = await browser.runtime.sendMessage({
    type: 'getTabDomStorageItemsAllowedStates',
    items: existingItems,
    domain: domain
  })
  for (let i = 0; i < response.length; i++) {
    if (response[i] === 'd') {
      let storage = existingItems[i].persistent ? localStorage : sessionStorage
      unwantedDomStorageEntries.push({
        name: request.name,
        value: storage.getItem(request.name),
        persistent: existingItems[i].persistent
      })
      storage.removeItem(request.name)
    } else if (response[i] === 'c') {
      if (existingItems[i].persistent) {
        // item was previously whitelisted and now needs to be converted
        convertPermanentEntryToTemporary({
          name: request.name,
          value: localStorage.getItem(request.name)
        })
      } else {
        // item was just whitelisted and needs to be converted back
        convertTemporaryEntryToPermanent({
          name: request.name.substring(CONVERT_PREFIX.length),
          value: sessionStorage.getItem(request.name)
        })
      }
    }
  }
}
async function handleExistingUnwantedStorageEntries() {
  // handles all existung but unwanted entries
  let domain = window.location.hostname
  // create list of storage items and send them to the background page
  let storageItems = []
  for (let i = 0; i < localStorage.length; i++) {
    storageItems.push({
      name: localStorage.key(i),
      persistent: true,
      isConverted: false
    })
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    if (sessionStorage.key(i).startsWith(CONVERT_PREFIX)) {
      storageItems.push({
        name: sessionStorage.key(i).substring(CONVERT_PREFIX.length),
        persistent: true,
        isConverted: true
      })
    } else {
      storageItems.push({
        name: sessionStorage.key(i),
        persistent: false,
        isConverted: false
      })
    }
  }
  let response = await browser.runtime.sendMessage({
    type: 'getTabDomStorageItemsAllowedStates',
    items: storageItems,
    domain: domain
  })
  for (let i = 0; i < response.length; i++) {
    if (response[i] === 'd') {
      // delete entry
      let prefix_name = storageItems[i].isConverted ? CONVERT_PREFIX + storageItems[i].name : storageItems[i].name
      let readFromStorage = (!storageItems[i].persistent || storageItems[i].isConverted) ? sessionStorage : localStorage;
      let rememberAsPersistent = (storageItems[i].isConverted || storageItems[i].persistent)
      unwantedDomStorageEntries.push({
        name: storageItems[i].name,
        value: readFromStorage.getItem(prefix_name),
        persistent: rememberAsPersistent
      })
      readFromStorage.removeItem(prefix_name)
    } else if (response[i] === 'c') {
      // convert entry
      if (!storageItems[i].isConverted) {
        await convertPermanentEntryToTemporary({
          name: storageItems[i].name,
          value: localStorage.getItem(storageItems[i].name)
        })
      } else {
        await convertTemporaryEntryToPermanent({
          name: storageItems[i].name,
          value: sessionStorage.getItem(CONVERT_PREFIX + storageItems[i].name)
        })
      }
    }
  }
}
async function injectScript() {
  // adds a script tag into the html document to notify when dom storage is written
  // using a string loads faster than the js from the website using a separate js file does not
  let script = document.createElement('script')
  script.src = chrome.runtime.getURL('js/inject.js');
  // Add the script tag to the DOM
  (document.head || document.documentElement).appendChild(script)
  script.remove()
}
async function handleNewDomStorageItem(request) {
  // if a new dom storage entry was set, delete, convert or keep it
  let storageItems = [{
    name: request.name,
    persistent: request.persistent
  }]
  let response = await browser.runtime.sendMessage({
    type: 'getTabDomStorageItemsAllowedStates',
    items: storageItems,
    domain: window.location.hostname
  })
  // delete the item if unwanted
  if (response[0] === 'd') {
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
  } else if (response[0] === 'c') {
    // converting the other way is not applicable
    await convertPermanentEntryToTemporary(request)
  }
}
async function deleteInvalidPrefixItems() {
  let removeData = []
  for (let i = 0; i < localStorage.length; i++) {
    if (localStorage.key(i).startsWith(CONVERT_PREFIX)) {
      removeData.push({
        storage: localStorage,
        name: localStorage.key(i)
      })
    }
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    // session storage entries with a single prefix may be legit and from the extension; even when a website can set one, it wont break anything
    if (sessionStorage.key(i).startsWith(CONVERT_PREFIX + CONVERT_PREFIX)) {
      removeData.push({
        storage: sessionStorage,
        name: sessionStorage.key(i)
      })
    }
  }
  removeData.forEach(dataPoint => {
    dataPoint.storage.removeItem(dataPoint.name)
  })
}
async function convertPermanentEntryToTemporary(entry) {
  sessionStorage.setItem(CONVERT_PREFIX + entry.name, entry.value)
  localStorage.removeItem(entry.name)
}
async function convertTemporaryEntryToPermanent(entry) {
  sessionStorage.removeItem(CONVERT_PREFIX + entry.name)
  localStorage.setItem(entry.name, entry.value)
}