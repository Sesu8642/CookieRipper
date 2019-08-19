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
    var storageItems = [{
      name: event.data.key,
      storage: event.data.storageType
    }];
    var sending = browser.runtime.sendMessage({
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
  var answer = new Promise(function(resolve, reject) {
    resolve({
      localStorage: JSON.stringify(localStorage),
      sessionStorage: JSON.stringify(sessionStorage)
    });
  });
  return answer;
}

function deleteStorageEntry(request) {
  // deletes a given storage entry
  var answer = new Promise(function(resolve, reject) {
    if (request.entry.permanence === 'permanent') {
      localStorage.removeItem(request.entry.name);
    } else if (request.entry.permanence === 'temporary') {
      sessionStorage.removeItem(request.entry.name);
    }
    resolve();
  });
  return answer;
}

function clearStorage() {
  // deletes all local and session storage entries
  var answer = new Promise(function(resolve, reject) {
    localStorage.clear();
    sessionStorage.clear();
    unwantedDomStorageEntries = [];
    resolve();
  });
  return answer;
}

function addStorageEntry(request) {
  // adds the given entry to the given storage
  var answer = new Promise(function(resolve, reject) {
    if (request.storage === 'local') {
      localStorage.setItem(request.name, request.value);
    } else if (request.storage === 'session') {
      sessionStorage.setItem(request.name, request.value);
    }
    resolve();
  });
  return answer;
}

function deleteUnwantedStorageEntry(request) {
  // deletes an entry from unwanted list
  var answer = new Promise(function(resolve, reject) {
    unwantedDomStorageEntries = unwantedDomStorageEntries.filter(function(entry) {
      if (entry.name === request.entry.name && entry.permanence === request.entry.permanence) {
        return false;
      }
      return true;
    });
    resolve();
  });
  return answer;
}

function restoreUnwantedStorageEntry(request) {
  // re-creates a single entry from unwanted list
  var answer = new Promise(async function(resolve, reject) {
    unwantedDomStorageEntries.forEach(function(entry) {
      // permanence is not considered here because the whitelist doesn't either
      if (entry.name === request.entry.name) {
        if (entry.permanence === 'permanent') {
          localStorage.setItem(entry.name, entry.value);
        } else {
          sessionStorage.setItem(entry.name, entry.value);
        }
      }
    });
    await Promise.all([deleteUnwantedStorageEntry({
      entry: {
        name: request.entry.name,
        permanence: 'permanent'
      }
    }), deleteUnwantedStorageEntry({
      entry: {
        name: request.entry.name,
        permanence: 'temporary'
      }
    })]);
    resolve();
  });
  return answer;
}

function deleteExistingUnwantedStorageEntries() {
  // deletes all existung but unwanted entries
  var answer = new Promise(function(resolve, reject) {
    // deletes all unwanted storage entries from both local and session storage
    var domain = window.location.host;
    try {
      // create list of storage items and send them to the background page
      var storageItems = [];
      for (var i = 0; i < localStorage.length; i++) {
        storageItems.push({
          name: localStorage.key(i),
          storage: 'local'
        });
      }
      for (i = 0; i < sessionStorage.length; i++) {
        storageItems.push({
          name: sessionStorage.key(i),
          storage: 'session'
        });
      }
      var sending = browser.runtime.sendMessage({
        type: 'getTabDomStorageItemsAllowedStates',
        items: storageItems,
        domain: domain
      });
      sending.then(async function(response) {
        // delete the unwanted items
        for (i = 0; i < response.length; i++) {
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
  return answer;
}

function injectScript() {
  // adds a script tag into the html document to notify when dom storage is written
  // using a string loads faster than the js from the website; using a separate js file does not
  var injectJS = `
  var _setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    var storageType;
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
  var script = document.createElement('script');
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