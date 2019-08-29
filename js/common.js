/*
 *
 * This file contains functions that may be used by all the other js files.
 *
 */
/* for accessing variables from background page if not in private mode */
let bgPage = browser.extension.getBackgroundPage();
/* whether firstPartyIsolation is supported */
let firstPartyIsolationSupported = checkFirstPartyIsolationSupport();

function checkFirstPartyIsolationSupport() {
  // checks whether the first party domain cookie property is supported
  let getting = browser.cookies.get({
    name: '',
    url: '',
    firstPartyDomain: ''
  });
  getting.then(function() {
    return true
  }, function() {
    return false
  });
}
/*
 * functions for getting settings from background page
 * getting them from the background page is better than storing them in a variable because only the background page reloads the settings when changed by the user
 * it is also less limited and probably faster than reading from the disk even when using the messaging api
 * the functions either call a funtion in the background page directly or send a message to do their job
 */
function callGetDefaultBehaviour() {
  // gets default behaviour from background page
  return new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      resolve(bgPage.defaultBehaviour);
    } else {
      let getting = browser.runtime.sendMessage({
        type: 'getDefaultBehaviour'
      });
      getting.then(resolve, logError);
    }
  });
}

function callGetEnableCookieCounter() {
  // gets default behaviour from background page
  return new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      resolve(bgPage.enableCookieCounter);
    } else {
      let getting = browser.runtime.sendMessage({
        type: 'getEnableCookieCounter'
      });
      getting.then(resolve, logError);
    }
  });
}

function callLoadSettings() {
  // reloads settings in background page
  return new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      bgPage.loadSettings();
    } else {
      let getting = browser.runtime.sendMessage({
        type: 'loadSettings'
      });
      getting.then(resolve, logError);
    }
  });
}
/*
 *cookie functions
 */
function getAllCookies(parameters) {
  // returns all cookies matching the given criteria
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = null;
  }
  return browser.cookies.getAll(parameters);
}

function addCookie(name, value, domain, path, session, date, time, hostOnly, secure, httpOnly, cookieStore, firstPartyDomain, overwriteCookie = null) {
  // creates a new cookie from the given data; also makes sure the provided overwrite-cookie gets actually overwritten or deleted
  return new Promise(async function(resolve, reject) {
    // delete overwriteCookie
    if (overwriteCookie !== null) {
      await deleteCookie(overwriteCookie);
    }
    // create new cookie
    let url = (domain.startsWith('.') ? `https://${domain.substr(1)}` : `https://${domain}`);
    let expirationDate = (session ? null : ((date.getTime() + time.getTime() + new Date().getTimezoneOffset() * 60000) / 1000));
    let parameters = {
      // url is mainly used for creating host only cookies (do this by specifying no domain) which are only accessible for the exact (sub-)domain
      url: url,
      // deal with host only --> do not supply domain if host only
      domain: (hostOnly ? null : domain),
      path: path,
      name: name,
      value: value,
      secure: secure,
      httpOnly: httpOnly,
      // if not a session cookie convert date to seconds since 1980
      expirationDate: expirationDate,
      storeId: cookieStore
    };
    if (firstPartyIsolationSupported) {
      parameters.firstPartyDomain = firstPartyDomain;
    }
    let setting = browser.cookies.set(parameters);
    setting.then(async function() {
      // make sure that if the cookie is unwanted, it is deleted before resolving to prevent the ui from refreshing too early with incorrect data
      // cookie.set returns a cookie object but seems to be unreliable in both chromium and ff so just use the input data instead
      let newDomain;
      if (!domain.startsWith(".")) {
        newDomain = hostOnly ? domain : `.${domain}`;
      } else {
        newDomain = hostOnly ? domain.slice(1) : domain;
      }
      let newCookie = {
        url: url,
        // deal with host only --> do not supply domain if host only
        domain: newDomain,
        path: path,
        name: name,
        value: value,
        secure: secure,
        httpOnly: httpOnly,
        // if not a session cookie convert date to seconds since 1980
        expirationDate: expirationDate,
        storeId: cookieStore
      };
      let allowed = await getCookieAllowedState(newCookie);
      if (allowed) {
        resolve();
      } else {
        await callAddUnwantedCookie(newCookie);
        await deleteCookie(newCookie);
        resolve();
      }
    }, async function(error) {
      // restore overwriteCookie if new cookie could not be set
      if (overwriteCookie !== null) {
        await addCookieFromObject(overwriteCookie);
      }
      reject(error);
    });
  });
}

function addCookieFromObject(cookie, cookieStore) {
  // creates a new cookie from the given cookie object
  return new Promise(async function(resolve, reject) {
    // create new cookie
    let parameters = {
      // url is mainly used for creating host only cookies (do this by specifying no domain) which are only accessible for the exact (sub-)domain
      // create url from domain (remove leading . first)
      url: (cookie.domain.startsWith('.') ? `https://${cookie.domain.substr(1)}` : `https://${cookie.domain}`),
      // deal with host only --> do not supply domain if host only
      domain: (cookie.hostOnly ? null : cookie.domain),
      path: cookie.path,
      name: cookie.name,
      value: cookie.value,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      storeId: cookieStore
    };
    if (firstPartyIsolationSupported) {
      parameters.firstPartyDomain = cookie.firstPartyDomain;
    }
    let setting = browser.cookies.set(parameters);
    setting.then(resolve, logError);
  });
}

function deleteCookie(cookie) {
  // deletes the provided cookie
  return new Promise(function(resolve, reject) {
    let parameters = {
      url: `https://${cookie.domain}${cookie.path}`,
      name: cookie.name,
      storeId: cookie.storeId
    };
    if (firstPartyIsolationSupported) {
      parameters.firstPartyDomain = cookie.firstPartyDomain;
    }
    let removing = browser.cookies.remove(parameters);
    removing.then(resolve, logError);
  });
}

function deleteAllCookies(url, cookieStore) {
  // deletes all cookies from the given url
  return new Promise(function(resolve, reject) {
    let getting = getAllCookies({
      url: url,
      storeId: cookieStore
    });
    getting.then(async function(siteCookies) {
      let promises = siteCookies.map(function(cookie) {
        return deleteCookie(cookie);
      });
      // also remove unwanted cookies from memory
      promises.push(callClearUnwantedCookiesforHostname(url));
      await Promise.all(promises);
      resolve();
    }, logError);
  });
}

function deleteExistingUnwantedCookies(url, cookieStore) {
  // deletes all existung but unwanted cookies from a given url
  return new Promise(async function(resolve, reject) {
    let hostname = trimSubdomains(url);
    let behaviour = await getSiteBehaviour(hostname);
    let getting = getAllCookies({
      url: url,
      storeId: cookieStore
    });
    getting.then(async function(siteCookies) {
      let promises = siteCookies.map(function(cookie) {
        if (behaviour == 0 || (behaviour == 1 && !cookie.session)) {
          return getObjectWhitelistedState(cookie.domain, cookie.name, 'c').then(async function(whitelisted) {
            if (!whitelisted) {
              await deleteCookie(cookie);
              await callAddUnwantedCookie(cookie);
            }
          });
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
}

function deleteAllTabsExistingUnwantedCookies() {
  // deletes all existung but unwanted cookies from all open tabs
  return new Promise(function(resolve, reject) {
    let querying = browser.tabs.query({});
    querying.then(async function(tabs) {
      let promises = tabs.map(function(tab) {
        if (tab.url.startsWith('http')) {
          return getTabCookieStore(tab.id).then(async function(cookieStore) {
            await deleteExistingUnwantedCookies(tab.url, cookieStore);
          });
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
}

function getCookieAllowedState(cookie) {
  // returns if a given cookie is allowed (should be accepted) or not
  return new Promise(async function(resolve, reject) {
    let hostname = trimSubdomains(`http://${cookie.domain}`);
    let caseBehaviour = await getSiteBehaviour(hostname);
    // allow if all cookies are allowed for that site
    if (caseBehaviour == 2) {
      return resolve(true);
    }
    // allow if the cookie is whitelisted
    let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c');
    if (whitelisted) {
      return resolve(true);
    }
    switch (caseBehaviour) {
      case 0:
        // dont allow if cookies are not allowed for the site
        resolve(false);
        break;
      case 1:
        // allow session
        if (cookie.session) {
          // allow if session cookies are allowed and its a session cookie
          resolve(true);
        } else {
          // deny if session cookies are allowed and its not a session cookie
          resolve(false);
        }
        break;
      default:
        // invalid
        logError({
          message: `Error: invalid Behaviour: ${caseBehaviour}`
        });
    }
  });
}
async function handleCookieEvent(changeInfo) {
  // is used when a cookie change event needs to be handled
  // determines the correct action to take and executes it
  // note: .removed is also true when overwriting as the cookie is removed completely first
  // exit if remove event (no cookie is added / changed)
  if (changeInfo.removed) {
    return;
  }
  let allowed = await getCookieAllowedState(changeInfo.cookie);
  if (!allowed) {
    callAddUnwantedCookie(changeInfo.cookie);
    await deleteCookie(changeInfo.cookie);
    updateActiveTabsCounts();
  }
}
/*
 * unwanted cookie functions
 * the functions either call a funtion in the background page directly or send a message to do their job
 */
function callGetUnwantedCookiesForHostname(hostname) {
  // returns the object that stores the cookies for the given hostname in unwanted list
  return new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    let getting;
    if (bgPage !== null) {
      getting = bgPage.getUnwantedCookiesForHostname({
        hostname: hostname
      });
    } else {
      getting = browser.runtime.sendMessage({
        type: 'getUnwantedCookiesForHostname',
        hostname: hostname
      });
    }
    getting.then(resolve, logError);
  });
}

function callAddUnwantedCookie(cookie) {
  // adds a cookie to the list of unwanted cookies
  return new Promise(function(resolve, reject) {
    // only do it if the site is opened in a tab
    // stringify to prevent some weird ff dead object issue
    // use function directly or send message depending on the availability of bgPage
    let adding;
    if (bgPage !== null) {
      adding = bgPage.addUnwantedCookie({
        cookie: cookie
      });
    } else {
      adding = browser.runtime.sendMessage({
        type: 'addUnwantedCookie',
        cookie: cookie
      });
    }
    adding.then(resolve, logError);
  });
}

function callRestoreUnwantedCookie(domain, name, cookieStore) {
  // re-creates a cookie from unwanted list in case the user whitelists it
  return new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    let getting;
    if (bgPage !== null) {
      getting = bgPage.restoreUnwantedCookie({
        domain: domain,
        name: name,
        cookieStore: cookieStore
      });
    } else {
      getting = browser.runtime.sendMessage({
        type: 'restoreUnwantedCookie',
        domain: domain,
        name: name,
        cookieStore: cookieStore
      });
    }
    getting.then(resolve, logError);
  });
}

function callRestoreAllHostnamesUnwantedCookies() {
  // re-creates cookies from unwanted list in case the user changes the behaviour for a hostname
  return new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    let restoring;
    if (bgPage !== null) {
      restoring = bgPage.restoreAllHostnamesUnwantedCookies();
    } else {
      restoring = browser.runtime.sendMessage({
        type: 'restoreAllHostnamesUnwantedCookies'
      });
    }
    restoring.then(resolve, logError);
  });
}

function callDeleteUnwantedCookie(domain, name) {
  // deletes a cookie from the list of unwanted cookies
  return new Promise(function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    let adding
    if (bgPage !== null) {
      adding = bgPage.deleteUnwantedCookie({
        domain: domain,
        name: name
      });
    } else {
      adding = browser.runtime.sendMessage({
        type: 'deleteUnwantedCookie',
        domain: domain,
        name: name
      });
    }
    adding.then(resolve, logError);
  });
}

function callClearUnwantedCookiesforHostname(url) {
  // clears all unwanted cookies from the list of unwanted cookies for a hostname
  return new Promise(function(resolve, reject) {
    let hostname = trimSubdomains(url);
    // use function directly or send message depending on the availability of bgPage
    let deleting;
    if (bgPage !== null) {
      deleting = bgPage.clearUnwantedCookiesforHostname({
        hostname: hostname
      });
    } else {
      deleting = browser.runtime.sendMessage({
        type: 'clearUnwantedCookiesforHostname',
        hostname: hostname
      });
    }
    deleting.then(resolve, logError);
  });
}
/*
 * dom storage functions
 * the functions communicate with injected js in the tab in order to do their job
 */
function getTabDomStorage(tabId) {
  // returns both local and session storage from a given tab
  return new Promise(function(resolve, reject) {
    let sending = browser.tabs.sendMessage(tabId, {
      type: 'getStorage'
    });
    sending.then(function(result) {
      result.localStorage = JSON.parse(result.localStorage);
      result.sessionStorage = JSON.parse(result.sessionStorage);
      resolve(result);
    }, reject);
  });
}

function getUnwantedDomStoregeEntries(tabId) {
  // the unwanted dom storage entries from a given tab
  return new Promise(function(resolve, reject) {
    let sending = browser.tabs.sendMessage(tabId, {
      type: 'getUnwantedStorage'
    });
    sending.then(function(result) {
      resolve(result);
    }, reject);
  });
}

function addDomStorageEntry(tabId, persistent, name, value, overwriteEntry = null) {
  // adds a new dom storage entry to a given tab
  return new Promise(async function(resolve, reject) {
    // delete overwriteEntry
    if (overwriteEntry !== null) {
      await deleteDomStorageEntry(tabId, overwriteEntry);
    }
    let sending = browser.tabs.sendMessage(tabId, {
      type: 'addEntry',
      persistent: persistent,
      name: name,
      value: value
    });
    sending.then(resolve, async function(error) {
      // restore overwriteEntry if new entry could not be set
      if (overwriteEntry !== null) {
        await addDomStorageEntry(tabId, overwriteEntry.persistent, overwriteEntry.name, overwriteEntry.value);
      }
      reject(error);
    });
  });
}

function deleteDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  return new Promise(function(resolve, reject) {
    let sending = browser.tabs.sendMessage(tabId, {
      type: 'deleteEntry',
      entry: entry
    });
    sending.then(resolve, logError);
  });
}

function deleteUnwantedDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  return new Promise(function(resolve, reject) {
    let sending = browser.tabs.sendMessage(tabId, {
      type: 'deleteUnwantedEntry',
      entry: entry
    });
    sending.then(resolve, logError);
  });
}

function restoreUnwantedDomStorageEntry(tabId, entry) {
  // re-creates a dom storage entry from unwanted list in case the user whitelists it
  return new Promise(function(resolve, reject) {
    let sending = browser.tabs.sendMessage(tabId, {
      type: 'restoreUnwantedEntry',
      entry: entry
    });
    sending.then(resolve, logError);
  });
}

function restoreAllTabsUnwantedDomStorageEntries() {
  // re-creates all tabs' wanted dom storage entries from unwanted list
  return new Promise(function(resolve, reject) {
    let querying = browser.tabs.query({});
    querying.then(async function(tabs) {
      let promises = tabs.map(async function(tab) {
        if (tab.url.startsWith('http')) {
          return browser.tabs.sendMessage(tab.id, {
            type: 'restoreUnwantedEntries'
          });
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
}

function deleteExistingUnwantedDomStorageEntries(tabId) {
  // deletes all existung but unwanted dom storage entries from a given tab
  return new Promise(async function(resolve, reject) {
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'deleteExistingUnwantedEntries'
      });
    } catch (error) {
      console.log((await browser.tabs.get(tabId)).url);
      console.error(error);
    }
    resolve();
  });
}

function deleteAllTabsExistingUnwantedDomStorageEntries() {
  // deletes all existung but unwanted dom storage entries from all open tabs
  return new Promise(function(resolve, reject) {
    let querying = browser.tabs.query({});
    querying.then(async function(tabs) {
      let promises = tabs.map(async function(tab) {
        if (tab.url.startsWith('http')) {
          await deleteExistingUnwantedDomStorageEntries(tab.id);
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
}

function clearTabDomStorage(tabId) {
  // deletes all dom storage entries from a given tab
  return new Promise(function(resolve, reject) {
    let sending = browser.tabs.sendMessage(tabId, {
      type: 'clearStorage'
    });
    sending.then(resolve, logError);
  });
}
/*
 * site exception functions
 */
function getSiteException(hostname, temporary) {
  // returns the exception for the given hostname; returns null if there is none
  return new Promise(function(resolve, reject) {
    let getting;
    if (temporary) {
      // use function directly or send message depending on the availability of bgPage
      if (bgPage !== null) {
        getting = bgPage.getTempSiteException({
          hostname: hostname
        });
      } else {
        getting = browser.runtime.sendMessage({
          type: 'getTempSiteException',
          hostname: hostname
        });
      }
      getting.then(resolve, logError);
    } else {
      let key = `ex|${hostname}`;
      getting = browser.storage.local.get({
        [key]: null
      });
      getting.then(function(items) {
        resolve(items[key]);
      }, logError);
    }
  });
}

function addSiteException(url, rule, temporary, overwriteException = null) {
  // adds a new site exception for the given domain
  return new Promise(async function(resolve, reject) {
    // delete overwriteException
    if (overwriteException !== null) {
      await deleteSiteException(`https://${overwriteException.domain}`, false);
    }
    let hostname = trimSubdomains(url);
    if (temporary) {
      // use function directly or send message depending on the availability of bgPage
      let adding;
      if (bgPage !== null) {
        adding = bgPage.addTempSiteException({
          hostname: hostname,
          rule: rule
        });
      } else {
        adding = browser.runtime.sendMessage({
          type: 'addTempSiteException',
          hostname: hostname,
          rule: rule
        });
      }
      adding.then(function() {
        resolve();
      }, logError);
    } else {
      let saving = savePermSiteException(hostname, rule);
      saving.then(async function() {
        await deleteSiteException(`https://${hostname}`, true);
        await Promise.all([callRestoreAllHostnamesUnwantedCookies(),
          deleteAllTabsExistingUnwantedCookies(), restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()
        ]);
        resolve();
        updateAllTabsIcons();
        updateActiveTabsCounts();
      }, async function(error) {
        // restore overwriteException if new exception could not be set
        if (overwriteException !== null) {
          await addSiteException(`https://${overwriteException.domain}`, overwriteException.ruleId, false);
        }
        reject(error);
      });
    }
  });

  function savePermSiteException(hostname, rule) {
    // sets an exception for a given hostname
    return new Promise(function(resolve, reject) {
      try {
        // make sure the hostname is valid
        let url = new URL(`http://${hostname}`);
        // count . in hostname to reject subdomains
        let domainCount = url.hostname.split('.').length - 1;
        if (domainCount > 1) {
          reject(Error('Subdomains are not supportet.'));
          return;
        } else if (domainCount < 1) {
          reject(Error('Top-level domains only are not supported.'));
          return;
        }
      } catch (e) {
        reject(e);
        return;
      }
      let setting = browser.storage.local.set({
        // use prefix 'ex' for exceptions and hostname as key
        [`ex|${hostname}`]: rule
      });
      setting.then(resolve, logError);
    });
  }
}

function deletePermSiteException(hostname) {
  // deletes the permanent exception for the given hostname (if there is any)
  return new Promise(function(resolve, reject) {
    let key = `ex|${encodeURI(hostname)}`;
    let removing = browser.storage.local.remove(key)
    removing.then(resolve, logError);
  });
}

function deleteSiteException(url, temporary) {
  // deletes the permanent or temporary exception for the given hostname (if there is any)
  return new Promise(async function(resolve, reject) {
    let hostname = trimSubdomains(url);
    if (temporary) {
      // use function directly or send message depending on the availability of bgPage
      let deleting;
      if (bgPage !== null) {
        deleting = bgPage.deleteTempSiteException({
          hostname: hostname
        });
      } else {
        deleting = browser.runtime.sendMessage({
          type: 'deleteTempSiteException',
          hostname: hostname
        });
      }
      deleting.then(resolve, logError);
    } else {
      await deletePermSiteException(hostname);
      await Promise.all([callRestoreAllHostnamesUnwantedCookies(),
        deleteAllTabsExistingUnwantedCookies(), restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()
      ]);
      resolve();
      updateAllTabsIcons();
      updateActiveTabsCounts();
    }
  });
}

function clearTempSiteExceptions(url) {
  // deletes all temp site exceptions
  return new Promise(async function(resolve, reject) {
    let hostname = trimSubdomains(url);
    // use function directly or send message depending on the availability of bgPage
    let deleting;
    if (bgPage !== null) {
      bgPage.deleteTempSiteException({
        hostname: hostname
      });
      resolve();
    } else {
      deleting = browser.runtime.sendMessage({
        type: 'clearTempSiteExceptions',
        hostname: hostname
      });
      deleting.then(resolve, logError);
    }
  });
}

function getSiteBehaviour(hostname) {
  // returns the behaviour for a given hostname
  // takes temporary and permanent exceptions as well as whitelist entries into account
  return new Promise(async function(resolve, reject) {
    // first check if there is a temporary exception
    let tempException = await getSiteException(hostname, true);
    if (tempException !== null) {
      return resolve(tempException);
    } else {
      // if there is no temporary exception, check for a permanent one
      let permSiteException = await getSiteException(hostname, false);
      if (permSiteException !== null) {
        return resolve(permSiteException);
      } else {
        // if there is no permanent exception either, use default behaviour
        return resolve(await callGetDefaultBehaviour());
      }
    }
  });
}
/*
 * whitelist functions
 */
function getObjectWhitelistedState(domain, name, type) {
  // returns wether a whitelist entry exists
  return new Promise(function(resolve, reject) {
    domain = domain.startsWith('.') ? domain.substr(1) : domain;
    let key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
    let getting = browser.storage.local.get({
      [key]: null
    });
    getting.then(function(items) {
      let whitelistedEntry = items[key];
      if (whitelistedEntry === null) {
        resolve(false);
      } else {
        resolve(true);
      }
    }, logError);
  });
}

function addWhitelistEntry(domain, name, type, overwriteEntry = null) {
  // adds a new whitelist with the given data
  domain = domain.startsWith('.') ? domain.substr(1) : domain;
  return new Promise(async function(resolve, reject) {
    try {
      // make sure the domain is valid
      new URL(`http://${domain}`);
    } catch (e) {
      return reject(e);
    }
    // delete overwriteEntry
    if (overwriteEntry !== null) {
      await deleteWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type);
    }
    let setting = browser.storage.local.set({
      // use prefix 'wl' for whitelist entries and both domain and name as key
      // last letter is the type: d --> dom storage, c --> cookie
      //use '|' as separator and encode all the other stuff to prevent fuck ups
      [`wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`]: ''
    });
    setting.then(resolve, async function(error) {
      // restore overwriteEntry if new entry could not be set
      if (overwriteEntry !== null) {
        await addWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type);
      }
      reject(error);
    });
  });
}

function deleteWhitelistEntry(domain, name, type) {
  // removes a whitelist entry matching the given data
  domain = domain.startsWith('.') ? domain.substr(1) : domain;
  return new Promise(function(resolve, reject) {
    let key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
    browser.storage.local.remove(key).then(resolve, logError);
  });
}

function getDomstorageEntryWhitelistedStateAsResponse(request) {
  // returns whether a dom storage entry from a request is whitelisted and also the name of the entry itself
  return new Promise(async function(resolve, reject) {
    let whitelisted = await getObjectWhitelistedState(request.domain, request.name, 'd');
    resolve({
      name: request.name,
      whitelisted: whitelisted
    });
  });
}
/*
status icon functions
*/
function updateTabIcon(tabId) {
  // updates the icon for a specific tab (not overall) according to the tabs behaviour
  function setIcon(behaviour) {
    let iconPath = null;
    let badgeColor = null;
    let title = null;
    switch (behaviour) {
      case 0:
        // deny
        iconPath = {
          16: 'icons/cookieRipperDeny_16.png',
          32: 'icons/cookieRipperDeny_32.png',
          48: 'icons/cookieRipperDeny_48.png'
        }
        badgeColor = 'red';
        title = 'Cookie Ripper is blocking cookies from this site.';
        break;
      case 1:
        // allow session
        iconPath = {
          16: 'icons/cookieRipperAllowSession_16.png',
          32: 'icons/cookieRipperAllowSession_32.png',
          48: 'icons/cookieRipperAllowSession_48.png'
        }
        badgeColor = 'orange';
        title = 'Cookie Ripper is allowing session cookies from this site.';
        break;
      case 2:
        // allow
        iconPath = {
          16: 'icons/cookieRipperAllow_16.png',
          32: 'icons/cookieRipperAllow_32.png',
          48: 'icons/cookieRipperAllow_48.png'
        }
        badgeColor = 'limegreen';
        title = 'Cookie Ripper is allowing all cookies from this site.';
        break;
      case -1:
        // site is out of scope
        iconPath = {
          16: 'icons/cookieRipperDisabled_16.png',
          32: 'icons/cookieRipperDisabled_32.png',
          48: 'icons/cookieRipperDisabled_48.png'
        }
        badgeColor = 'blue';
        title = 'Cookie Ripper is not active on this site.';
        break;
      default:
        // invalid
        logError(Error(`invalid Behaviour: ${behaviour}`));
    }
    browser.browserAction.setIcon({
      path: iconPath,
      tabId: tabId
    });
    browser.browserAction.setBadgeBackgroundColor({
      color: badgeColor,
      tabId: tabId
    });
    browser.browserAction.setTitle({
      title: title,
      tabId: tabId
    });
  }
  let getting = browser.tabs.get(tabId);
  getting.then(function(tab) {
    if (tab.url.startsWith('http')) {
      let url = tab.url;
      let hostname = trimSubdomains(url);
      let getting = getSiteBehaviour(hostname);
      getting.then(setIcon, logError);
    } else {
      setIcon(-1);
    }
  }, logError);
}

function updateAllTabsIcons() {
  // updates icon for all open tabs
  let querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      updateTabIcon(tab.id);
    });
  }, logError);
}
async function updateActiveTabsCounts() {
  // sets cookie count on icon batch according to the behaviour for the active tab
  if (!await callGetEnableCookieCounter()) {
    // exit if feature is disabled
    return;
  }
  // get active tab in every window
  let querying = browser.tabs.query({
    active: true
  });
  querying.then(async function(tabs) {
    for (let tab of tabs) {
      if (typeof tab !== 'undefined') {
        if (tab.url.startsWith('http')) {
          let cookieStore = await getTabCookieStore(tab.id);
          // get cookies
          countCookies(await getAllCookies({
            url: tab.url,
            storeId: cookieStore
          }), tab);
        } else {
          setBadgeText(tab.id, '');
        }
      }
    }
  }, logError);

  function countCookies(cookies, tab) {
    // count cookies
    let count = cookies.length;
    // get dom storage
    let getting = getTabDomStorage(tab.id);
    getting.then(async function(response) {
        // count dom storage
        count = count + Object.keys(response.localStorage).length + Object.keys(response.sessionStorage).length;
        setBadgeText(tab.id, count);
      },
      function() {
        setBadgeText(tab.id, count);
      });
  }

  function setBadgeText(tabId, count) {
    browser.browserAction.setBadgeText({
      text: `${count}`,
      tabId: tabId
    });
  }
}

function removeAllTabsCounts() {
  // removes the cookie count from all tabs
  let querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      browser.browserAction.setBadgeText({
        text: '',
        tabId: tab.id
      });
    });
  }, logError);
}
/*
 * misc functions
 */
function trimSubdomains(url) {
  // takes an URI and only returns the domain.topleveldomain part of it
  if (!url.startsWith('http') && !url.startsWith('https')) {
    // return if not a http site
    return url;
  }
  let hostname = (new URL(url)).hostname;
  let trimmedDomain = hostname.split('.');
  return `${trimmedDomain[trimmedDomain.length - 2]}.${trimmedDomain[trimmedDomain.length - 1]}`;
}

function formatDate(date) {
  // formats a date for displaying in tables
  let month = `${(date.getMonth() + 1 < 10 ? '0' : '')}${date.getMonth() + 1}`;
  let day = `${(date.getDate() < 10 ? '0' : '')}${date.getDate()}`;
  let year = date.getFullYear();
  return `${year}/${month}/${day}`;
}

function logError(error) {
  // logs an error to the console
  console.log(`Cookie Ripper ${error}`);
  console.error(error);
}

function getActiveTab() {
  // returns the active Tab
  return new Promise(function(resolve, reject) {
    let querying = browser.tabs.query({
      active: true,
      currentWindow: true
    });
    querying.then(function(tabs) {
      resolve(tabs[0]);
    }, logError);
  });
}

function getTabCookieStore(tabId) {
  // returns the id of the cookie store which the given tab uses
  // chromium does not supply tab.cookieStoreId :(
  return new Promise(function(resolve, reject) {
    let getting = browser.cookies.getAllCookieStores();
    getting.then(function(cookieStores) {
      for (let store of cookieStores) {
        if (store.tabIds.includes(tabId)) {
          return resolve(store.id);
        }
      }
      logError(Error("This tab could not be found in any cookie store."));
    }, logError);
  });
}

function sendInfoMessage(message) {
  // sends a message to the user
  browser.notifications.create(null, {
    type: 'basic',
    message: message,
    title: "Cookie Ripper Info"
  });
}