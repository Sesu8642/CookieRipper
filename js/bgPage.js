'use strict';
let tempSiteExceptions = {};
let openDomainsUnwantedCookies = {};
var defaultBehaviour, enableCookieCounter;
async function loadSettings(skipUpdatingScripts = false) {
  // loads settings from storage and applies them
  return new Promise(async function(resolve, reject) {
    try {
      let items = await browser.storage.sync.get({
        defaultBehaviour: 2,
        enableCookieCounter: false
      });
      defaultBehaviour = Number(items.defaultBehaviour);
      enableCookieCounter = items.enableCookieCounter;
      if (skipUpdatingScripts) {
        // when installing, the content scripts are not injected yet
        await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
      } else {
        await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
        try {
          // this can fail if unable to inject content script
          await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
        } catch (e) {
          console.warn(e);
        }
      }
      await updateAllTabsIcons();
      if (!enableCookieCounter) {
        await removeAllTabsCounts();
      } else {
        await updateActiveTabsCounts();
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function injectJsInAllTabs() {
  // injects js into all open tabs (http*); new tabs are handled by manifest entry
  // also sets the correct icon and count for the open tabs
  return new Promise(async function(resolve, reject) {
    try {
      let tabs = await browser.tabs.query({});
      var promises = [];
      promises.push(...tabs.flatMap(function(tab) {
        if (!tab.url.startsWith('http')) {
          return [];
        }
        return [browser.tabs.executeScript(tab.id, {
          file: 'lib/browser-polyfill/browser-polyfill.js'
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
    } catch (e) {
      reject(e);
    }
  });
}
async function getEnableCookieCounter(request) {
  // returns whether cookie counter in enabled
  return Promise.resolve(enableCookieCounter);
}
async function getTempSiteException(request) {
  // returns the rule of a temporary exception
  return new Promise(function(resolve, reject) {
    try {
      let exception = tempSiteExceptions[encodeURI(request.domain)];
      exception = typeof exception === "undefined" ? null : exception;
      resolve(exception);
    } catch (e) {
      reject(e);
    }
  });
}
async function addTempSiteException(request) {
  // adds a temporary exception
  return new Promise(async function(resolve, reject) {
    try {
      tempSiteExceptions[encodeURI(request.domain)] = request.rule;
      await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
      try {
        // this can fail if unable to inject content script
        await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
      } catch (e) {
        console.warn(e);
      }
      await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()]);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function deleteTempSiteException(request) {
  // deletes a temporary exception
  return new Promise(async function(resolve, reject) {
    try {
      delete tempSiteExceptions[encodeURI(request.domain)];
      await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
      try {
        // this can fail if unable to inject content script
        await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
      } catch (e) {
        console.warn(e);
      }
      await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()]);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function clearTempSiteExceptions(request) {
  // deletes all temporary exceptions
  return new Promise(async function(resolve, reject) {
    try {
      tempSiteExceptions = [];
      await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
      try {
        // can fail if unable to inject content script
        await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
      } catch (e) {
        console.warn(e);
      }
      await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()]);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function getUnwantedCookiesForDomain(request) {
  // returns a domain's cookies from unwanted list
  return new Promise(function(resolve, reject) {
    try {
      let cookies = [];
      if (typeof openDomainsUnwantedCookies[request.domain] === "undefined") {
        return resolve([]);
      }
      for (let key in openDomainsUnwantedCookies[request.domain].unwantedCookies) {
        let cookie = JSON.parse(openDomainsUnwantedCookies[request.domain].unwantedCookies[key]);
        cookies.push(cookie);
      }
      resolve(cookies);
    } catch (e) {
      reject(e);
    }
  });
}
async function addUnwantedCookie(request) {
  // adds a single cookie to unwanted list
  return new Promise(function(resolve, reject) {
    try {
      let cookieDomain = getRuleRelevantPartOfDomain(request.cookie.domain);
      // if it is undefined, it is a third party cookie which does not need to be recorded
      if (openDomainsUnwantedCookies[cookieDomain] != undefined) {
        let key = `${encodeURI(request.cookie.domain)}|${encodeURI(request.cookie.name)}`;
        let value = JSON.stringify(request.cookie);
        openDomainsUnwantedCookies[cookieDomain].unwantedCookies[key] = value;
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function restoreUnwantedCookie(request) {
  // re-creates a single cookie from unwanted list
  return new Promise(async function(resolve, reject) {
    try {
      let domain = getRuleRelevantPartOfDomain(request.domain);
      let key = `${encodeURI(request.domain)}|${encodeURI(request.name)}`;
      await addCookieFromObject(JSON.parse(openDomainsUnwantedCookies[domain].unwantedCookies[key]), request.cookieStore);
      delete openDomainsUnwantedCookies[domain].unwantedCookies[key];
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function restoreAllDomainsUnwantedCookies(request) {
  // re-creates all domains' wanted cookies from unwanted list
  return new Promise(async function(resolve, reject) {
    try {
      let domainPromises = Object.keys(openDomainsUnwantedCookies).map(function(domain) {
        // get behaviour for domain
        return getSiteBehaviour(domain).then(async function(behaviour) {
          // break if behaviour is 'deny'
          if (!(behaviour === 0)) {
            let cookiePromises = Object.keys(openDomainsUnwantedCookies[domain].unwantedCookies).map(async function(key) {
              let cookie = JSON.parse(openDomainsUnwantedCookies[domain].unwantedCookies[key]);
              // check if cookie should be restored
              if (behaviour === 2 || behaviour === 1 && cookie.session) {
                await addCookieFromObject(cookie, cookie.storeId);
                delete openDomainsUnwantedCookies[domain].unwantedCookies[key];
              }
            });
            await Promise.all(cookiePromises);
          }
        })
      });
      await Promise.all(domainPromises);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function deleteUnwantedCookie(request) {
  // deletes a cookie from unwanted list
  return new Promise(function(resolve, reject) {
    try {
      let domain = getRuleRelevantPartOfDomain(request.domain);
      let key = `${encodeURI(request.domain)}|${encodeURI(request.name)}`;
      delete openDomainsUnwantedCookies[domain].unwantedCookies[key];
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function clearUnwantedCookiesforDomain(request) {
  // deletes a domain's cookies from unwanted list
  return new Promise(function(resolve, reject) {
    try {
      openDomainsUnwantedCookies[request.domain].unwantedCookies = {};
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function populateopenDomainsUnwantedCookies() {
  // adds all open sites to openDomainsUnwantedCookies
  return new Promise(async function(resolve, reject) {
    try {
      let tabs = await browser.tabs.query({});
      tabs.forEach(function(tab) {
        let domain = getRuleRelevantPartOfDomain(tab.url);
        openDomainsUnwantedCookies[domain] = {
          domain: domain,
          unwantedCookies: {}
        }
      });
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function removeClosedDomainsFromopenDomainsUnwantedCookies() {
  // removes all sites from openDomainsUnwantedCookies that are not open anymore
  // create array of all open domains
  return new Promise(async function(resolve, reject) {
    try {
      let openTabsDomains = [];
      let tabs = await browser.tabs.query({});
      tabs.forEach(function(tab) {
        openTabsDomains.push(getRuleRelevantPartOfDomain(tab.url));
      });
      // iterate all entries in openDomainsUnwantedCookies and remove them if the domain is not open in a tab anymore
      for (let property in openDomainsUnwantedCookies) {
        if (!(openTabsDomains.includes(property))) {
          delete openDomainsUnwantedCookies[property];
        }
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function getTabDomStorageItemsAllowedStates(request) {
  // returns an array of booleans meaning whether a dom storage entry is allowed or not
  return new Promise(async function(resolve, reject) {
    try {
      let behaviour = await getSiteBehaviour(getRuleRelevantPartOfDomain(request.domain));
      // if behaviour is allow all --> return true for all items
      if (behaviour == 2) {
        return resolve(request.items.map(function() {
          return true;
        }));
      }
      // if behaviour is not allow all --> check whitelisted state and storage type
      let promises = request.items.map(function(item) {
        return getObjectWhitelistedState(request.domain, item.name, 'd').then(function(whitelisted) {
          return (whitelisted || (behaviour == 1 && !item.persistent))
        });
      });
      resolve(Promise.all(promises));
    } catch (e) {
      reject(e);
    }
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
    case 'clearUnwantedCookiesforDomain':
      return clearUnwantedCookiesforDomain(request);
      break;
    case 'deleteUnwantedCookie':
      return deleteUnwantedCookie(request);
      break;
    case 'restoreUnwantedCookie':
      return restoreUnwantedCookie(request);
      break;
    case 'restoreAllDomainsUnwantedCookies':
      return restoreAllDomainsUnwantedCookies(request);
      break;
    case 'getUnwantedCookiesForDomain':
      return getUnwantedCookiesForDomain(request);
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
      return Promise.reject(Error(`Unknown request type: ${request.type}`));
  }
}
/*
 * intialization (parts of it must not be in a separate function to work properly in ff)
 */
init()
async function init() {
  try {
    await populateopenDomainsUnwantedCookies();
    await loadSettings(true);
    await injectJsInAllTabs();
  } catch (e) {
    console.error(e);
  }
}
browser.runtime.onMessage.addListener(handleMessage);
browser.webNavigation.onCompleted.addListener(async function(details) {
  try {
    await updateActiveTabsCounts();
  } catch (e) {
    console.error(e);
  }
});
browser.tabs.onActivated.addListener(async function(activeInfo) {
  try {
    await updateActiveTabsCounts();
  } catch (e) {
    console.error(e);
  }
});
browser.runtime.onInstalled.addListener(async function(details) {
  // shows the user a welcome message and opens the settings page; also injects js in open tabs and takes care of the extension icon
  try {
    if (details.reason === "install") {
      await browser.tabs.create({
        url: '/options.html'
      });
      await sendInfoMessage('Thank you for installing Cookie Ripper!\nMake sure cookies are enabled in your browser and the third party cookie setting is adjusted to your liking (I suggest not accepting those). After that, adjust the cookie ripper default behaviour and you are good to go!');
    }
  } catch (e) {
    console.error(e);
  }
});
browser.cookies.onChanged.addListener(handleCookieEvent);
browser.webNavigation.onBeforeNavigate.addListener(async function(details) {
  if (!['auto_subframe', 'manual_subframe'].includes(details.transitionType)) {
    // if new domain --> add it to list
    let newDomain = getRuleRelevantPartOfDomain(details.url);
    if (!openDomainsUnwantedCookies.hasOwnProperty(newDomain)) {
      openDomainsUnwantedCookies[newDomain] = {
        domain: newDomain,
        unwantedCookies: {}
      }
    }
  }
});
browser.webNavigation.onCommitted.addListener(async function(details) {
  // update icon and count and delete unwanted cookies
  try {
    await updateTabIcon(details.tabId);
    let cookieStore = await getTabCookieStore(details.tabId);
    await deleteExistingUnwantedCookies(details.url, cookieStore);
    await updateActiveTabsCounts();
    await removeClosedDomainsFromopenDomainsUnwantedCookies();
  } catch (e) {
    console.error(e);
  }
});
browser.tabs.onCreated.addListener(async function(tab) {
  try {
    await updateTabIcon(tab.id);
  } catch (e) {
    console.error(e);
  }
});