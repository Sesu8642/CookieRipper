'use strict';
/*
 * this script is injected into websites because dom storage is only accessible from there (i think)
 */
deleteUnwantedStorage();
// only answer messages if in the top frame
if (window == window.top) {
  browser.runtime.onMessage.addListener(handleMessage);
}

function handleMessage(request) {
  // when a message is received, decides how to respond
  switch (request.type) {
    case 'getStorage':
      return sendStorage();
      break;
    case 'deleteEntry':
      return deleteStorageEntry(request);
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

function deleteUnwantedStorage() {
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
            localStorage.removeItem(storageItems[i].name);
          } else {
            sessionStorage.removeItem(storageItems[i].name);
          }
        }
      }
    }, logError);
  } catch (e) {
    // if storage is not accessible, there is nothing to do
  }
}

function logError(error) {
  // logs an error to the console
  console.log(`Cookie Ripper ${error}`);
  console.error(error);
}