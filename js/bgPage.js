'use strict';
let tempSiteExceptions = {};
let openHostnamesUnwantedCookies = {};
var defaultBehaviour, enableCookieCounter;

function loadSettings(skipUpdatingScripts = false) {
  // loads settings from storage and applies them
  return new Promise(function(resolve, reject) {
    let getting = browser.storage.sync.get({
      defaultBehaviour: 2,
      enableCookieCounter: false
    });
    getting.then(async function(items) {
      defaultBehaviour = Number(items.defaultBehaviour);
      enableCookieCounter = items.enableCookieCounter;
      if (skipUpdatingScripts) {
        // when installing, the content scripts are not injected yet
        await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
      } else {
        await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies(), restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
      }
      resolve();
      updateAllTabsIcons();
      if (!enableCookieCounter) {
        removeAllTabsCounts();
      } else {
        updateActiveTabsCounts();
      }
    }, logError);
  });
}

function injectJsInAllTabs() {
  // injects js into all open tabs (http*); new tabs are handled by manifest entry
  // also sets the correct icon and count for the open tabs
  return new Promise(async function(resolve, reject) {
    let querying = browser.tabs.query({});
    var promises = [];
    querying.then(async function(tabs) {
      promises.push(...tabs.flatMap(function(tab) {
        if (!tab.url.startsWith('http')) {
          return [];
        }
        return [browser.tabs.executeScript(tab.id, {
          file: 'lib/browser-polyfill.min.js'
        }), browser.tabs.executeScript(tab.id, {
          file: '/js/contentScript.js'
        })];
      }));
      try {
        await Promise.all(promises);
      } catch (e) {
        console.error(e);
      }
      resolve();
    }, logError);
  });
}

function getEnableCookieCounter(request) {
  // returns whether cookie counter in enabled
  return new Promise(async function(resolve, reject) {
    resolve(enableCookieCounter);
  });
}

function getTempSiteException(request) {
  // returns the rule of a temporary exception
  return new Promise(async function(resolve, reject) {
    let exception = tempSiteExceptions[encodeURI(request.hostname)];
    exception = typeof exception === "undefined" ? null : exception;
    resolve(exception);
  });
}

function addTempSiteException(request) {
  // adds a temporary exception
  return new Promise(async function(resolve, reject) {
    tempSiteExceptions[encodeURI(request.hostname)] = request.rule;
    await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies(), restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
    resolve();
    updateAllTabsIcons();
    updateActiveTabsCounts();
  });
}

function deleteTempSiteException(request) {
  // deletes a temporary exception
  return new Promise(async function(resolve, reject) {
    delete tempSiteExceptions[encodeURI(request.hostname)];
    await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies(), restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
    resolve();
    updateAllTabsIcons();
    updateActiveTabsCounts();
  });
}

function clearTempSiteExceptions(request) {
  // deletes all temporary exceptions
  return new Promise(async function(resolve, reject) {
    tempSiteExceptions = [];
    await Promise.all([callRestoreAllHostnamesUnwantedCookies(), deleteAllTabsExistingUnwantedCookies(), restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
    resolve();
    updateAllTabsIcons();
    updateActiveTabsCounts();
  });
}

function getUnwantedCookiesForHostname(request) {
  // returns a domain's cookies from unwanted list
  return new Promise(function(resolve, reject) {
    let cookies = [];
    if (typeof openHostnamesUnwantedCookies[request.hostname] === "undefined") {
      resolve([]);
    }
    for (let key in openHostnamesUnwantedCookies[request.hostname].unwantedCookies) {
      let cookie = JSON.parse(openHostnamesUnwantedCookies[request.hostname].unwantedCookies[key]);
      cookies.push(cookie);
    }
    resolve(cookies);
  });
}

function addUnwantedCookie(request) {
  // adds a single cookie to unwanted list
  return new Promise(function(resolve, reject) {
    let cookieHostname = trimSubdomains(`http://${request.cookie.domain}`);
    // if it is undefined, it is a third party cookie which does not need to be recorded
    if (openHostnamesUnwantedCookies[cookieHostname] != undefined) {
      let key = `${encodeURI(request.cookie.domain)}|${encodeURI(request.cookie.name)}`;
      let value = JSON.stringify(request.cookie);
      openHostnamesUnwantedCookies[cookieHostname].unwantedCookies[key] = value;
    }
    resolve();
  });
}

function restoreUnwantedCookie(request) {
  // re-creates a single cookie from unwanted list
  return new Promise(async function(resolve, reject) {
    let hostname = trimSubdomains(`http://${request.domain}`);
    let key = `${encodeURI(request.domain)}|${encodeURI(request.name)}`;
    await addCookieFromObject(JSON.parse(openHostnamesUnwantedCookies[hostname].unwantedCookies[key]), request.cookieStore);
    delete openHostnamesUnwantedCookies[hostname].unwantedCookies[key];
    resolve();
  });
}

function restoreAllHostnamesUnwantedCookies(request) {
  // re-creates all hostnames' wanted cookies from unwanted list
  return new Promise(async function(resolve, reject) {
    let hostnamePromises = Object.keys(openHostnamesUnwantedCookies).map(function(hostname) {
      // get behaviour for hostname
      return getSiteBehaviour(hostname).then(async function(behaviour) {
        // break if behaviour is 'deny'
        if (!(behaviour === 0)) {
          // iterate all unwanted cookies
          let cookiePromises = Object.keys(openHostnamesUnwantedCookies[hostname].unwantedCookies).map(async function(key) {
            return new Promise(async function(resolve, reject) {
              let cookie = JSON.parse(openHostnamesUnwantedCookies[hostname].unwantedCookies[key]);
              // check if cookie should be restored
              if (behaviour === 2 || behaviour === 1 && cookie.session) {
                await addCookieFromObject(cookie, cookie.storeId);
                delete openHostnamesUnwantedCookies[hostname].unwantedCookies[key];
              }
              resolve();
            });
          });
          await Promise.all(cookiePromises);
        }
      })
    });
    await Promise.all(hostnamePromises);
    resolve();
  });
}

function deleteUnwantedCookie(request) {
  // deletes a cookie from unwanted list
  return new Promise(function(resolve, reject) {
    let hostname = trimSubdomains(`https://${request.domain}`);
    let key = `${encodeURI(request.domain)}|${encodeURI(request.name)}`;
    delete openHostnamesUnwantedCookies[hostname].unwantedCookies[key];
    resolve();
  });
}

function clearUnwantedCookiesforHostname(request) {
  // deletes a hostname's cookies from unwanted list
  return new Promise(function(resolve, reject) {
    openHostnamesUnwantedCookies[request.hostname].unwantedCookies = {};
    resolve();
  });
}

function populateOpenHostnamesUnwantedCookies() {
  // adds all open sites to openHostnamesUnwantedCookies
  let querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      let hostname = trimSubdomains(tab.url);
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
  let openTabsHostnames = [];
  let querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      openTabsHostnames.push(trimSubdomains(tab.url));
    });
    // iterate all entries in openHostnamesUnwantedCookies and remove them if the hostname is not open in a tab anymore
    for (let property in openHostnamesUnwantedCookies) {
      if (!(openTabsHostnames.includes(property))) {
        delete openHostnamesUnwantedCookies[property];
      }
    }
  }, logError);
}

function getTabDomStorageItemsAllowedStates(request) {
  // returns an array of booleans meaning whether a dom storage entry is allowed or not
  return new Promise(async function(resolve, reject) {
    let behaviour = await getSiteBehaviour(trimSubdomains('http://' + request.domain));
    // if behaviour is allow all --> return true for all items
    if (behaviour == 2) {
      return resolve(request.items.map(function() {
        return true
      }));
    }
    // if behaviour is not allow all --> check whitelisted state and storage type
    let promises = request.items.map(function(item) {
      return getObjectWhitelistedState(request.domain, item.name, 'd').then(function(whitelisted) {
        return (whitelisted || (behaviour == 1 && item.storage == 'session'))
      });
    });
    resolve(Promise.all(promises));
  });
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
      url: '/options.html'
    }).then(function() {
      sendInfoMessage('Thank you for installing Cookie Ripper!\nMake sure cookies are enabled in your browser and the third party cookie setting is adjusted to your liking (I suggest not accepting those). After that, adjust the cookie ripper default behaviour and you are good to go!');
    }, logError);
  }
  await loadSettings(true);
  await injectJsInAllTabs();
});
browser.cookies.onChanged.addListener(handleCookieEvent);
browser.webNavigation.onBeforeNavigate.addListener(async function(details) {
  if (!['auto_subframe', 'manual_subframe'].includes(details.transitionType)) {
    // if new hostname --> add it to list
    let newHostname = trimSubdomains(details.url);
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
  let cookieStore = await getTabCookieStore(details.tabId);
  await deleteExistingUnwantedCookies(details.url, cookieStore);
  updateActiveTabsCounts();
  removeClosedHostnamesFromOpenHostnamesUnwantedCookies();
});
browser.tabs.onCreated.addListener(function(tab) {
  updateTabIcon(tab.id);
});