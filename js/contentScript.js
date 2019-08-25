'use strict';
/*
 * this script is injected into websites because dom storage is only accessible from there (i think)
 */
var unwantedDomStorageEntries = [];
deleteExistingUnwantedStorageEntries();
injectScript();
// only answer messages from content script if in the top frame
if (window == window.top) {
  browser.runtime.onMessage.addListener(handleMessage);
}
window.addEventListener('message', function(event) {
  if (event.data.type && (event.data.type == 'cookieRipper_domStorageSet')) {
    let storageItems = [{
      name: event.data.key,
      storage: event.data.storageType
    }];
    let sending = browser.runtime.sendMessage({
      type: 'getTabDomStorageItemsAllowedStates',
      items: storageItems,
      domain: window.location.host
    });
    sending.then(async function(response) {
      // delete the item if unwanted
      if (!response[0]) {
        if (event.data.storageType == 'localStorage') {
          localStorage.removeItem(event.data.key);
        } else {
          sessionStorage.removeItem(event.data.key);
        }
      }
    }, logError);
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
      logError(Error(`Unknown request type: ${request.type}`))
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
    if (request.entry.permanence === 'permanent') {
      localStorage.removeItem(request.entry.name);
    } else if (request.entry.permanence === 'temporary') {
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
    if (request.storage === 'local') {
      localStorage.setItem(request.name, request.value);
    } else if (request.storage === 'session') {
      sessionStorage.setItem(request.name, request.value);
    }
    resolve();
  });
}

function deleteUnwantedStorageEntry(request) {
  // deletes an entry from unwanted list
  return new Promise(function(resolve, reject) {
    unwantedDomStorageEntries = unwantedDomStorageEntries.filter(function(entry) {
      if (entry.name === request.entry.name && entry.permanence === request.entry.permanence) {
        return false;
      }
      return true;
    });
    resolve();
  });
}

function restoreUnwantedStorageEntry(request) {
  // re-creates a single entry from unwanted list
  return new Promise(async function(resolve, reject) {
    unwantedDomStorageEntries.forEach(function(entry) {
      if (entry.name === request.entry.name && entry.permanence === request.entry.permanence) {
        if (entry.permanence === 'permanent') {
          localStorage.setItem(entry.name, entry.value);
        } else {
          sessionStorage.setItem(entry.name, entry.value);
        }
      }
    });
    await deleteUnwantedStorageEntry({
      entry: {
        name: request.entry.name,
        permanence: request.entry.permanence
      }
    });
    resolve();
  });
}

function restoreUnwantedStorageEntries() {
  // re-creates all hostnames' wanted dom storage entries from unwanted list
  return new Promise(async function(resolve, reject) {
    let domain = window.location.host;
    let storageItems = [];
    unwantedDomStorageEntries.forEach(function(entry) {
      // create list of storage items and send them to the background page
      storageItems.push({
        name: entry.name,
        storage: entry.permanence === 'permanent' ? 'local' : 'session'
      });
    });
    let sending = browser.runtime.sendMessage({
      type: 'getTabDomStorageItemsAllowedStates',
      items: storageItems,
      domain: domain
    });
    sending.then(async function(response) {
      // restore the wanted items
      for (let i = 0; i < response.length; i++) {
        if (response[i]) {
          restoreUnwantedStorageEntry({
            entry: {
              name: storageItems[i].name,
              permanence: storageItems[i].storage === 'local' ? 'permanent' : 'temporary'
            }
          });
        }
      }
    }, logError);
    resolve();
  });
}

function deleteExistingUnwantedStorageEntries() {
  // deletes all existung but unwanted entries
  return new Promise(function(resolve, reject) {
    let domain = window.location.host;
    try {
      // create list of storage items and send them to the background page
      let storageItems = [];
      for (let i = 0; i < localStorage.length; i++) {
        storageItems.push({
          name: localStorage.key(i),
          storage: 'local'
        });
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        storageItems.push({
          name: sessionStorage.key(i),
          storage: 'session'
        });
      }
      let sending = browser.runtime.sendMessage({
        type: 'getTabDomStorageItemsAllowedStates',
        items: storageItems,
        domain: domain
      });
      sending.then(async function(response) {
        // delete the unwanted items
        for (let i = 0; i < response.length; i++) {
          if (!response[i]) {
            if (storageItems[i].storage == 'local') {
              unwantedDomStorageEntries.push({
                name: storageItems[i].name,
                value: localStorage.getItem(storageItems[i].name),
                permanence: 'permanent'
              });
              localStorage.removeItem(storageItems[i].name);
            } else {
              unwantedDomStorageEntries.push({
                name: storageItems[i].name,
                value: sessionStorage.getItem(storageItems[i].name),
                permanence: 'temporary'
              });
              sessionStorage.removeItem(storageItems[i].name);
            }
          }
        }
        resolve();
      }, logError);
    } catch (e) {
      // if storage is not accessible, there is nothing to do
      reject();
    }
  });
}

function injectScript() {
  // adds a script tag into the html document to notify when dom storage is written
  // using a string loads faster than the js from the website; using a separate js file does not
  let injectJS = `
  let _setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    let storageType;
    if (this === window.localStorage) {
      storageType = 'localStorage';
    } else if (this === window.sessionStorage) {
      storageType = 'sessionStorage';
    }
    window.postMessage({
      type: 'cookieRipper_domStorageSet',
      storageType: storageType,
      key: key,
      value: value
    }, window.location.href);
    _setItem.apply(this, arguments);
  }
  `
  let script = document.createElement('script');
  script.textContent = injectJS;
  // Add the script tag to the DOM
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function logError(error) {
  // logs an error to the console
  console.log(`Cookie Ripper ${error}`);
  console.error(error);
}