'use strict';
var tempSiteExceptions = {};
var defaultBehaviour, enableCookieCounter;

function loadSettings() {
  // loads settings from storage and applies them
  var result = new Promise(function(resolve, reject) {
    var getting = browser.storage.sync.get({
      defaultBehaviour: 2,
      enableCookieCounter: false
    });
    getting.then(async function(items) {
      defaultBehaviour = Number(items.defaultBehaviour);
      enableCookieCounter = items.enableCookieCounter;
      resolve();
      updateAllTabsIcons();
      if (!enableCookieCounter) {
        removeAllTabsCounts();
      } else {
        updateActiveTabsCounts();
      }
    }, logError);
  });
  return result;
}

function injectJsInAllTabs() {
  // injects js into all open tabs (http*); new tabs are handled by manifest entry
  // also sets the correct icon and count for the open tabs
  var querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      if (tab.url.startsWith('http')) {
        var executing = browser.tabs.executeScript(tab.id, {
          file: 'lib/browser-polyfill.min.js'
        });
        executing.then(function() {}, logError);
        executing = browser.tabs.executeScript(tab.id, {
          file: '/js/contentScript.js'
        });
        executing.then(function() {}, logError);
      }
    });
  }, logError);
}

function getEnableCookieCounter(request) {
  // returns whether cookie counter in enabled
  var result = new Promise(async function(resolve, reject) {
    resolve(enableCookieCounter);
  });
  return result;
}

function getTempSiteException(request) {
  // returns the rule of a temporary exception
  var result = new Promise(async function(resolve, reject) {
    var exception = tempSiteExceptions[encodeURI(request.hostname)];
    exception = typeof exception === "undefined" ? null : exception;
    resolve(exception);
  });
  return result;
}

function addTempSiteException(request) {
  // adds a temporary exception
  var result = new Promise(async function(resolve, reject) {
    tempSiteExceptions[encodeURI(request.hostname)] = request.rule;
    resolve();
    updateAllTabsIcons();
    updateActiveTabsCounts();
  });
  return result;
}

function deleteTempSiteException(request) {
  // deletes a temporary exception
  var result = new Promise(async function(resolve, reject) {
    delete tempSiteExceptions[encodeURI(request.hostname)];
    resolve();
    updateAllTabsIcons();
    updateActiveTabsCounts();
  });
  return result;
}

function clearTempSiteExceptions(request) {
  // deletes all temporary exceptions
  var result = new Promise(async function(resolve, reject) {
    tempSiteExceptions = [];
    resolve();
    updateAllTabsIcons();
    updateActiveTabsCounts();
  });
  return result;
}

function getTabDomStorageItemsAllowedStates(request) {
  // returns an array of booleans meaning whether a dom storage entry is allowed or not
  var result = new Promise(async function(resolve, reject) {
    var behaviour = await getSiteBehaviour(trimSubdomains('http://' + request.domain));
    // if behaviour is allow all --> return true for all items
    if (behaviour == 2) {
      return resolve(request.items.map(function() {
        return true
      }));
    }
    // if behaviour is not allow all --> check whitelisted state and storage type
    var promises = request.items.map(function(item) {
      return getObjectWhitelistedState(request.domain, item.name, 'd').then(function(whitelisted) {
        return (whitelisted || (behaviour == 1 && item.storage == 'session'))
      });
    });
    resolve(Promise.all(promises));
  });
  return result;
}

function filterCookiesInHttpRequestHeader(details) {
  // modifies a request header to include only the allowed cookies
  var result = new Promise(function(resolve, reject) {
    // filtering the cookies already included does not make much sense since reading the actual cookie in necessary anyway to find out if it should be sent
    var getting = getAllCookies({
      url: details.url
    });
    getting.then(async function(existingCookies) {
      var cookiesToSend = '';
      var promises = existingCookies.map(function(cookie) {
        return getCookieAllowedState(cookie).then(function(allowed) {
          if (allowed) {
            if (cookiesToSend !== '') {
              cookiesToSend += ';'
            }
            cookiesToSend += `${cookie.name}=${cookie.value}`;
          }
        });
      });
      await Promise.all(promises);
      for (var header of details.requestHeaders) {
        if (header.name.toLowerCase() === "cookie") {
          header.value = cookiesToSend;
        }
      }
      resolve({
        requestHeaders: details.requestHeaders
      });
    }, logError);
  });
  return result;
}

function handleMessage(request, sender) {
  // those messages are sent from the content scripts and other js files
  // call the correct function to respond to them
  switch (request.type) {
    case 'addTempSiteException':
      return addTempSiteException(request);
      break;
    case 'getTempSiteException':
      return getTempSiteException(request);
      break;
    case 'deleteTempSiteException':
      return deleteTempSiteException(request);
      break;
    case 'clearTempSiteExceptions':
      return clearTempSiteExceptions(request);
      break;
    case 'getDefaultBehaviour':
      return Promise.resolve(defaultBehaviour);
      break;
    case 'getEnableCookieCounter':
      return getEnableCookieCounter(request);
      break;
    case 'loadSettings':
      return loadSettings();
      break;
    case 'getTabDomStorageItemsAllowedStates':
      return getTabDomStorageItemsAllowedStates(request);
      break;
    default:
      logError(`Unknown request type: ${request.type}`);
  }
}
/*
 * intialization (parts of it must not be in a separate function to work properly in ff)
 */
browser.runtime.onMessage.addListener(handleMessage);
browser.webRequest.onBeforeSendHeaders.addListener(filterCookiesInHttpRequestHeader, {
    urls: ["<all_urls>"]
  },
  ["blocking", "requestHeaders"]);
browser.webNavigation.onCompleted.addListener(function(details) {
  updateActiveTabsCounts();
});
browser.tabs.onActivated.addListener(function(activeInfo) {
  updateActiveTabsCounts();
});
browser.runtime.onInstalled.addListener(async function(details) {
  // shows the user a welcome message and opens the settings page; also injects js in open tabs and takes care of the extension icon
  if (details.reason === "install") {
    browser.tabs.create({
      url: '/options.html'
    }).then(function() {
      sendInfoMessage('Thank you for installing Cookie Ripper!\nMake sure cookies are enabled in your browser and the third party cookie setting is adjusted to your liking (I suggest not accepting those). After that, adjust the cookie ripper default behaviour and you are good to go!');
    }, logError);
  }
  await loadSettings();
  injectJsInAllTabs();
});
browser.cookies.onChanged.addListener(updateActiveTabsCounts);
browser.webNavigation.onCommitted.addListener(async function(details) {
  // update icon and count
  updateTabIcon(details.tabId);
  updateActiveTabsCounts();
});
browser.tabs.onCreated.addListener(function(tab) {
  updateTabIcon(tab.id);
});