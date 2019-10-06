'use strict';
/*
 * this script is injected into websites because dom storage is only accessible from there (i think)
 */
var unwantedDomStorageEntries = [];
init();
async function init() {
  return new Promise(async function(resolve, reject) {
    try {
      await deleteExistingUnwantedStorageEntries();
      await injectScript();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
// only answer messages from background script if in the top frame
if (window == window.top) {
  browser.runtime.onMessage.addListener(handleMessage);
}
window.addEventListener('message', async function(event) {
  try {
    if (event.data.type) {
      switch (event.data.type) {
        case 'cookieRipper_domStorageSet':
          await handleNewDomStorageItem(event.data);
          break;
        case 'cookieRipper_injectedScriptIsDone':
          await deleteExistingUnwantedStorageEntries();
          break;
        default:
          // nothing to do, might be some other message the website sent
      }
    }
  } catch (e) {
    console.error(e);
  }
});

function handleMessage(request) {
  // when a message is received, decides how to respond
  switch (request.type) {
    case 'getStorage':
      return sendStorage();
      break;
    case 'getUnwantedStorage':
      return Promise.resolve(unwantedDomStorageEntries);
    case 'deleteEntry':
      return deleteStorageEntry(request);
      break;
    case 'deleteUnwantedEntry':
      return deleteUnwantedStorageEntry(request);
      break;
    case 'restoreUnwantedEntry':
      return restoreUnwantedStorageEntry(request);
      break;
    case 'restoreUnwantedEntries':
      return restoreUnwantedStorageEntries();
      break;
    case 'deleteExistingUnwantedEntries':
      return deleteExistingUnwantedStorageEntries();
      break;
    case 'addEntry':
      return addStorageEntry(request);
      break;
    case 'clearStorage':
      return clearStorage();
      break;
    default:
      console.error(Error(`Unknown request type: ${request.type}`))
  }
}

function sendStorage() {
  // sends both local and session storage
  return new Promise(function(resolve, reject) {
    resolve({
      localStorage: JSON.stringify(localStorage),
      sessionStorage: JSON.stringify(sessionStorage)
    });
  });
}

function deleteStorageEntry(request) {
  // deletes a given storage entry
  return new Promise(function(resolve, reject) {
    if (request.entry.persistent) {
      localStorage.removeItem(request.entry.name);
    } else {
      sessionStorage.removeItem(request.entry.name);
    }
    resolve();
  });
}

function clearStorage() {
  // deletes all local and session storage entries
  return new Promise(function(resolve, reject) {
    localStorage.clear();
    sessionStorage.clear();
    unwantedDomStorageEntries = [];
    resolve();
  });
}

function addStorageEntry(request) {
  // adds the given entry to the given storage
  return new Promise(function(resolve, reject) {
    let storage = request.persistent ? localStorage : sessionStorage;
    storage.setItem(request.name, request.value);
    resolve();
  });
}
async function deleteUnwantedStorageEntry(request) {
  // deletes an entry from unwanted list
  return new Promise(function(resolve, reject) {
    try {
      unwantedDomStorageEntries = unwantedDomStorageEntries.filter(function(entry) {
        return (!(entry.name === request.entry.name && entry.persistent === request.entry.persistent))
      });
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function restoreUnwantedStorageEntry(request) {
  // re-creates a single entry from unwanted list
  return new Promise(async function(resolve, reject) {
    try {
      unwantedDomStorageEntries.forEach(function(entry) {
        if (entry.name === request.entry.name && entry.persistent === request.entry.persistent) {
          let storage = entry.persistent ? localStorage : sessionStorage;
          storage.setItem(entry.name, entry.value);
        }
      });
      await deleteUnwantedStorageEntry(request);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function restoreUnwantedStorageEntries() {
  // re-creates all domains' wanted dom storage entries from unwanted list
  return new Promise(async function(resolve, reject) {
    try {
      let domain = window.location.host;
      let storageItems = [];
      unwantedDomStorageEntries.forEach(function(entry) {
        // create list of storage items and send them to the background page
        storageItems.push({
          name: entry.name,
          persistent: entry.persistent
        });
      });
      let response = await browser.runtime.sendMessage({
        type: 'getTabDomStorageItemsAllowedStates',
        items: storageItems,
        domain: domain
      });
      // restore the wanted items
      for (let i = 0; i < response.length; i++) {
        if (response[i]) {
          await restoreUnwantedStorageEntry({
            entry: {
              name: storageItems[i].name,
              persistent: storageItems[i].persistent
            }
          });
        }
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function deleteExistingUnwantedStorageEntries() {
  // deletes all existung but unwanted entries
  return new Promise(async function(resolve, reject) {
    try {
      let domain = window.location.host;
      // create list of storage items and send them to the background page
      let storageItems = [];
      for (let i = 0; i < localStorage.length; i++) {
        storageItems.push({
          name: localStorage.key(i),
          persistent: true
        });
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        storageItems.push({
          name: sessionStorage.key(i),
          persistent: false
        });
      }
      let response = await browser.runtime.sendMessage({
        type: 'getTabDomStorageItemsAllowedStates',
        items: storageItems,
        domain: domain
      });
      // delete the unwanted items
      for (let i = 0; i < response.length; i++) {
        if (!response[i]) {
          let storage = storageItems[i].persistent ? localStorage : sessionStorage;
          unwantedDomStorageEntries.push({
            name: storageItems[i].name,
            value: storage.getItem(storageItems[i].name),
            persistent: storageItems[i].persistent
          });
          storage.removeItem(storageItems[i].name);
        }
      }
      resolve();
    } catch (e) {
      // if storage is not accessible, there is nothing to do
      reject(e);
    }
  });
}
async function injectScript() {
  // adds a script tag into the html document to notify when dom storage is written
  // using a string loads faster than the js from the website; using a separate js file does not
  return new Promise(function(resolve, reject) {
    try {
      let script = document.createElement('script');
      script.src = browser.runtime.getURL('js/inject.js');
      // Add the script tag to the DOM
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      resolve();
    } catch (e) {
      // if storage is not accessible, there is nothing to do
      reject(e);
    }
  });
}
async function handleNewDomStorageItem(request) {
  // if a new dom storage entry was set, delete or keep it
  return new Promise(async function(resolve, reject) {
    try {
      let storageItems = [{
        name: request.name,
        persistent: request.persistent
      }];
      let response = await browser.runtime.sendMessage({
        type: 'getTabDomStorageItemsAllowedStates',
        items: storageItems,
        domain: window.location.host
      });
      // delete the item if unwanted
      if (!response[0]) {
        let storage = request.persistent ? localStorage : sessionStorage;
        storage.removeItem(request.name);
        // if the item is in the unwanted list already, remove it first
        for (let i = 0; i < unwantedDomStorageEntries.length; i++) {
          if (unwantedDomStorageEntries[i].name === request.name && unwantedDomStorageEntries[i].persistent === request.persistent) {
            unwantedDomStorageEntries.splice(i);
          }
        }
        // add entry to unwanted list
        unwantedDomStorageEntries.push({
          name: request.name,
          value: request.value,
          persistent: request.persistent
        });
      }
      resolve();
    } catch (e) {
      // if storage is not accessible, there is nothing to do
      reject(e);
    }
  });
}