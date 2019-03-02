'use strict';
var tempSiteExceptions = {};
var openHostnamesUnwantedCookies = {};
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
      await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
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
    await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
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
    await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
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
    await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
    resolve();
    updateAllTabsIcons();
    updateActiveTabsCounts();
  });
  return result;
}

function getUnwantedCookiesForHostname(request) {
  // returns a domain's cookies from unwanted list
  var result = new Promise(function(resolve, reject) {
    var cookies = [];
    if (typeof openHostnamesUnwantedCookies[request.hostname] === "undefined") {
      resolve([]);
    }
    for (var key in openHostnamesUnwantedCookies[request.hostname].unwantedCookies) {
      var cookie = JSON.parse(openHostnamesUnwantedCookies[request.hostname].unwantedCookies[key]);
      cookies.push(cookie);
    }
    resolve(cookies);
  });
  return result;
}

function addUnwantedCookie(request) {
  // adds a single cookie to unwanted list
  var result = new Promise(function(resolve, reject) {
    var cookieHostname = trimSubdomains(`http://${request.cookie.domain}`);
    // if it is undefined, it is a third party cookie which does not need to be recorded
    if (openHostnamesUnwantedCookies[cookieHostname] != undefined) {
      var key = `${encodeURI(request.cookie.domain)}|${encodeURI(request.cookie.name)}`;
      var value = JSON.stringify(request.cookie);
      openHostnamesUnwantedCookies[cookieHostname].unwantedCookies[key] = value;
    }
    resolve();
  });
  return result;
}

function restoreUnwantedCookie(request) {
  // re-creates a single cookie from unwanted list
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(`http://${request.domain}`);
    var key = `${encodeURI(request.domain)}|${encodeURI(request.name)}`;
    await addCookieFromObject(JSON.parse(openHostnamesUnwantedCookies[hostname].unwantedCookies[key]), request.cookieStore);
    delete openHostnamesUnwantedCookies[hostname].unwantedCookies[key];
    resolve();
  });
  return result;
}

function restoreAllHostnamesUnwantedCookies(request) {
  // re-creates all hostnames wanted cookies from unwanted list
  var result = new Promise(async function(resolve, reject) {
    // TODO: make more efficient
    for (var hostname in openHostnamesUnwantedCookies) {
      // get behaviour for hostname
      var behaviour = await getSiteBehaviour(hostname);
      // break if behaviour is 'deny'
      if (!(behaviour === 0)) {
        // iterate all unwanted cookies
        for (var key in openHostnamesUnwantedCookies[hostname].unwantedCookies) {
          var cookie = JSON.parse(openHostnamesUnwantedCookies[hostname].unwantedCookies[key]);
          // check if cookie should be restored
          if (behaviour === 2 || behaviour === 1 && cookie.session) {
            await addCookieFromObject(cookie, cookie.storeId);
            delete openHostnamesUnwantedCookies[hostname].unwantedCookies[key];
          }
        }
      }
    }
    resolve();
  });
  return result;
}

function deleteUnwantedCookie(request) {
  // deletes a cookie from unwanted list
  var result = new Promise(function(resolve, reject) {
    var hostname = trimSubdomains(`https://${request.domain}`);
    var key = `${encodeURI(request.domain)}|${encodeURI(request.name)}`;
    delete openHostnamesUnwantedCookies[hostname].unwantedCookies[key];
    resolve();
  });
  return result;
}

function clearUnwantedCookiesforHostname(request) {
  // deletes a hostname's cookies from unwanted list
  var result = new Promise(function(resolve, reject) {
    openHostnamesUnwantedCookies[request.hostname].unwantedCookies = {};
    resolve();
  });
  return result;
}

function populateOpenHostnamesUnwantedCookies() {
  // adds all open sites to openHostnamesUnwantedCookies
  var querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      var hostname = trimSubdomains(tab.url);
      openHostnamesUnwantedCookies[hostname] = {
        hostname: hostname,
        unwantedCookies: {}
      }
    });
  }, logError);
}

function removeClosedHostnamesFromOpenHostnamesUnwantedCookies() {
  // removes all sites from openHostnamesUnwantedCookies that are not open anymore
  // create array of all open hostnames
  var openTabsHostnames = [];
  var querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      openTabsHostnames.push(trimSubdomains(tab.url));
    });
    // iterate all entries in openHostnamesUnwantedCookies and remove them if the hostname is not open in a tab anymore
    for (var property in openHostnamesUnwantedCookies) {
      if (!(openTabsHostnames.includes(property))) {
        delete openHostnamesUnwantedCookies[property];
      }
    }
  }, logError);
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
    case 'addUnwantedCookie':
      return addUnwantedCookie(request);
      break;
    case 'clearUnwantedCookiesforHostname':
      return clearUnwantedCookiesforHostname(request);
      break;
    case 'deleteUnwantedCookie':
      return deleteUnwantedCookie(request);
      break;
    case 'restoreUnwantedCookie':
      return restoreUnwantedCookie(request);
      break;
    case 'restoreAllHostnamesUnwantedCookies':
      return restoreAllHostnamesUnwantedCookies(request);
      break;
    case 'getUnwantedCookiesForHostname':
      return getUnwantedCookiesForHostname(request);
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
    case 'getSiteBehaviour':
      return getSiteBehaviour(trimSubdomains(request.url));
      break;
    case 'getWhitelisted':
      return getDomstorageEntryWhitelistedStateAsResponse(request);
      break;
    default:
      logError(`Unknown request type: ${request.type}`);
  }
}
/*
 * intialization (parts of it must not be in a separate function to work properly in ff)
 */
populateOpenHostnamesUnwantedCookies();
browser.runtime.onMessage.addListener(handleMessage);
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
      url: '/firstInstall.html'
    }).then(function() {}, logError);
  }
  await loadSettings();
  injectJsInAllTabs();
});
browser.cookies.onChanged.addListener(handleCookieEvent);
browser.webNavigation.onBeforeNavigate.addListener(async function(details) {
  if (!['auto_subframe', 'manual_subframe'].includes(details.transitionType)) {
    // if new hostname --> add it to list
    var newHostname = trimSubdomains(details.url);
    if (!openHostnamesUnwantedCookies.hasOwnProperty(newHostname)) {
      openHostnamesUnwantedCookies[newHostname] = {
        hostname: newHostname,
        unwantedCookies: {}
      }
    }
  }
});
browser.webNavigation.onCommitted.addListener(async function(details) {
  // update icon and count and delete unwanted cookies
  updateTabIcon(details.tabId);
  var cookieStore = await getTabCookieStore(details.tabId);
  await deleteExistingUnwantedCookies(details.url, cookieStore);
  updateActiveTabsCounts();
  removeClosedHostnamesFromOpenHostnamesUnwantedCookies();
});
browser.tabs.onCreated.addListener(function(tab) {
  updateTabIcon(tab.id);
});