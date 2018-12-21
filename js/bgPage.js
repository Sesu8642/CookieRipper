'use strict';
var defaultBehaviour, enableCookieCounter, firstPartyIsolationSupported;
var tempSiteExceptions = {};
var openHostnamesUnwantedCookies = {};
initialize();
async function initialize() {
  // loads setting, adds listeners and does some other initializing
  // check FirstPartyIsolation support
  await checkFirstPartyIsolationSupport();
  loadSettings();
  populateOpenHostnamesUnwantedCookies();
}

function loadSettings() {
  // loads settings from storage
  var getting = browser.storage.sync.get({
    defaultBehaviour: 2,
    enableCookieCounter: false
  });
  getting.then(function(items) {
    defaultBehaviour = Number(items.defaultBehaviour);
    enableCookieCounter = items.enableCookieCounter;
    restoreAllTabsCookiesFromUnwantedList();
    deleteAllTabsUnwantedCookies();
    updateAllTabsIcons();
    if (!enableCookieCounter) {
      removeAllTabsCounts();
    } else {
      updateActiveTabsCounts();
    }
  }, logError);
}

function checkFirstPartyIsolationSupport() {
  // checks whether the first party domain cookie property is supported and stores the answer in firstPartyIsolationSupported
  var result = new Promise(function(resolve, reject) {
    var getting = browser.cookies.get({
      name: '',
      url: '',
      firstPartyDomain: ''
    });
    getting.then(function() {
      firstPartyIsolationSupported = true;
      resolve();
    }, function() {
      firstPartyIsolationSupported = false;
      resolve();
    });
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
          file: '/js/inject.js'
        });
        executing.then(function() {}, logError);
      }
    });
  }, logError);
}

function handleMessage(request, sender) {
  // those messages are sent from the content script to get settings
  // call the correct function to answer them
  switch (request.type) {
    case 'getSiteBehaviour':
      return sendBehaviour(request);
      break;
    case 'getWhitelisted':
      return sendDomstorageEntryWhitelistedState(request);
      break;
    default:
      logError(`Unknown request type: ${request.type}`);
  }
}
/*
 * add event listeners (at least onInstalled must not be in a separate function to work properly in ff)
 */
browser.runtime.onInstalled.addListener(function(details) {
  // shows the user a welcome message and opens the settings page; also injects js in open tabs and takes care of the extension icon
  if (details.reason === "install") {
    browser.tabs.create({
      url: '/firstInstall.html'
    }).then(function() {}, logError);
  }
  injectJsInAllTabs();
  updateAllTabsIcons();
  updateActiveTabsCounts();
});
browser.cookies.onChanged.addListener(handleCookieEvent);
browser.webNavigation.onCommitted.addListener(async function(details) {
  if (details.transitionType !== 'auto_subframe' && details.transitionType !== 'manual_subframe') {
    // update icon and count and delete undwanted cookies
    updateTabIcon(details.tabId);
    var cookieStore = await getTabCookieStore(details.tabId);
    await deleteUnwantedCookies(details.url, cookieStore);
    updateActiveTabsCounts();
    // if new hostname --> add it to list
    var newHostname = trimSubdomains(details.url);
    if (!openHostnamesUnwantedCookies.hasOwnProperty(newHostname)) {
      openHostnamesUnwantedCookies[newHostname] = {
        hostname: newHostname,
        unwantedCookies: {}
      }
    }
    removeClosedHostnamesFromOpenHostnamesUnwantedCookies();
  }
});
browser.webNavigation.onCompleted.addListener(function(details) {
  updateActiveTabsCounts();
});
browser.tabs.onActivated.addListener(function(activeInfo) {
  updateActiveTabsCounts();
});
browser.tabs.onRemoved.addListener(removeClosedHostnamesFromOpenHostnamesUnwantedCookies);
browser.runtime.onMessage.addListener(handleMessage);