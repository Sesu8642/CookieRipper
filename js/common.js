/*
 *
 * This file contains functions that may be used by all the other js files.
 *
 */
/* for accessing variables from background page */
var bgPage = browser.extension.getBackgroundPage();
/*
 *cookie functions
 */
function getAllCookies(parameters) {
  // returns all cookies matching the given criteria
  if (bgPage.firstPartyIsolationSupported) {
    parameters.firstPartyDomain = null;
  }
  return browser.cookies.getAll(parameters);
}

function addCookie(name, value, domain, path, session, date, time, hostOnly, secure, httpOnly, cookieStore, firstPartyDomain, overwriteCookie) {
  // creates a new cookie from the given data; also makes sure the provided overwrite-cookie gets actually overwritten or deleted
  var result = new Promise(async function(resolve, reject) {
    // delete overwriteCookie
    if (overwriteCookie !== null) {
      await deleteCookie(overwriteCookie);
    }
    // create new cookie
    var url = (domain.startsWith('.') ? `https://${domain.substr(1)}` : `https://${domain}`);
    var parameters = {
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
      expirationDate: (session ? null : ((date.getTime() + time.getTime() + new Date().getTimezoneOffset() * 60000) / 1000)),
      storeId: cookieStore
    };
    if (bgPage.firstPartyIsolationSupported) {
      parameters.firstPartyDomain = firstPartyDomain;
    }
    var setting = browser.cookies.set(parameters);
    setting.then(async function() {
      // make sure that if the cookie is unwanted, it is deleted before resolving to prevent the ui from refreshing too early with incorrect data
      // cookie.set returns a cookie object but seems to be unreliable in both chromium and ff so just use the input date instead
      if (!domain.startsWith(".")) {
        var newDomain = hostOnly ? domain : `.${domain}`;
      } else {
        newDomain = hostOnly ? domain.slice(1) : domain;
      }
      var newCookie = {
        name: name,
        domain: newDomain
      };
      var allowed = await getCookieAllowedState(newCookie);
      if (allowed) {
        resolve();
      } else {
        await addCookieToUnwantedList(newCookie);
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
  return result;
}

function addCookieFromObject(cookie, cookieStore) {
  // creates a new cookie from the given cookie object
  var result = new Promise(async function(resolve, reject) {
    // create new cookie
    var parameters = {
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
    if (bgPage.firstPartyIsolationSupported) {
      parameters.firstPartyDomain = cookie.firstPartyDomain;
    }
    var setting = browser.cookies.set(parameters);
    setting.then(resolve, logError);
  });
  return result;
}
async function deleteCookie(cookie) {
  // deletes the provided cookie
  var result = new Promise(function(resolve, reject) {
    var parameters = {
      url: `https://${cookie.domain}${cookie.path}`,
      name: cookie.name,
      storeId: cookie.storeId
    };
    if (bgPage.firstPartyIsolationSupported) {
      parameters.firstPartyDomain = cookie.firstPartyDomain;
    }
    var removing = browser.cookies.remove(parameters);
    removing.then(resolve, logError);
  });
  return result;
}

function deleteAllCookies(url, cookieStore) {
  // deletes all cookies from the given url
  var result = new Promise(function(resolve, reject) {
    var getting = getAllCookies({
      url: url,
      storeId: cookieStore
    });
    getting.then(async function(siteCookies) {
      var promises = siteCookies.map(function(cookie) {
        return deleteCookie(cookie);
      });
      // also remove unwanted cookies from memory
      var hostname = trimSubdomains(url);
      bgPage.openHostnamesUnwantedCookies[hostname].unwantedCookies = {};
      await Promise.all(promises);
      resolve();
    }, logError);
  });
  return result;
}

function deleteUnwantedCookies(url, cookieStore) {
  // deletes all existung but unwanted cookies from a given url
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(url);
    var behaviour = await getSiteBehaviour(hostname);
    var getting = getAllCookies({
      url: url,
      storeId: cookieStore
    });
    getting.then(async function(siteCookies) {
      var promises = siteCookies.map(function(cookie) {
        if (behaviour == 0 || (behaviour == 1 && !cookie.session)) {
          return getObjectWhitelistedState(cookie.domain, cookie.name, 'c').then(async function(whitelisted) {
            if (!whitelisted) {
              await deleteCookie(cookie);
              await addCookieToUnwantedList(cookie);
            }
          });
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
  return result;
}

function deleteAllTabsUnwantedCookies() {
  // deletes all existung but unwanted cookies all open tabs
  var result = new Promise(function(resolve, reject) {
    var querying = browser.tabs.query({});
    querying.then(async function(tabs) {
      var promises = tabs.map(function(tab) {
        if (tab.url.startsWith('http')) {
          return getTabCookieStore(tab.id).then(async function(cookieStore) {
            await deleteUnwantedCookies(tab.url, cookieStore);
          });
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
  return result;
}

function getCookieAllowedState(cookie) {
  // returns if a given cookie is allowed (should be accepted) or not
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(`http://${cookie.domain}`);
    var caseBehaviour = await getSiteBehaviour(hostname);
    // allow if all cookies are allowed for that site
    if (caseBehaviour == 2) {
      return resolve(true);
    }
    // allow if the cookie is whitelisted
    var whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c');
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
          message: `Error: invalid Behaviour: &{caseBehaviour}`
        });
    }
  });
  return result;
}

function restoreCookiesFromUnwantedList(hostname) {
  // re-creates cookies from unwanted list in case the user changes the behaviour for a site
  var result = new Promise(async function(resolve, reject) {
    // get behaviour for site
    var behaviour = await getSiteBehaviour(hostname);
    // resolve if behaviour is 'deny'
    if (behaviour === 0) {
      resolve();
    }
    // iterate all unwanted cookies
    for (var key in bgPage.openHostnamesUnwantedCookies[hostname].unwantedCookies) {
      var cookie = JSON.parse(bgPage.openHostnamesUnwantedCookies[hostname].unwantedCookies[key]);
      // check if cookie should be restored
      if (behaviour === 2 || behaviour === 1 && cookie.session) {
        await addCookieFromObject(cookie, cookie.storeId);
        delete bgPage.openHostnamesUnwantedCookies[hostname].unwantedCookies[key];
      }
    }
    resolve();
  });
  return result;
}

function restoreAllTabsCookiesFromUnwantedList() {
  // re-creates cookies from unwanted list in case the user changes the behaviour for multiple sites
  var result = new Promise(async function(resolve, reject) {
    for (var hostname in bgPage.openHostnamesUnwantedCookies) {
      await restoreCookiesFromUnwantedList(bgPage.openHostnamesUnwantedCookies[hostname].hostname);
    }
    resolve();
  });
  return result;
}

function restoreWhitelistedCookieFromUnwantedList(domain, name, cookieStore) {
  // re-creates a cookie from unwanted list in case the user whitelisted it
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(`http://${domain}`);
    await addCookieFromObject(JSON.parse(bgPage.openHostnamesUnwantedCookies[hostname].unwantedCookies[`${encodeURI(domain)}|${encodeURI(name)}`]), cookieStore);
    delete bgPage.openHostnamesUnwantedCookies[hostname].unwantedCookies[`${encodeURI(domain)}|${encodeURI(name)}`];
    resolve();
  });
  return result;
}

function addCookieToUnwantedList(cookie) {
  // adds a cookie to the list of unwanted cookies
  var result = new Promise(function(resolve, reject) {
    var cookieHostname = trimSubdomains(`http://${cookie.domain}`);
    // only do it if the site is opened in a tab
    // stringify to prevent some weird ff dead object issue
    bgPage.openHostnamesUnwantedCookies[cookieHostname].unwantedCookies[`${encodeURI(cookie.domain)}|${encodeURI(cookie.name)}`] = JSON.stringify(cookie);
    resolve();
  });
  return result;
}

function populateOpenHostnamesUnwantedCookies() {
  // adds all open sites to the openHostnamesUnwantedCookies variable
  var querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      var hostname = trimSubdomains(tab.url);
      bgPage.openHostnamesUnwantedCookies[hostname] = {
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
    for (var property in bgPage.openHostnamesUnwantedCookies) {
      if (!(openTabsHostnames.includes(property))) {
        delete bgPage.openHostnamesUnwantedCookies[property];
      }
    }
  }, logError);
}
async function handleCookieEvent(changeInfo) {
  // is used when a cookie change event needs to be handled
  // determines the correct action to take and executes it
  // note: .removed is also true when overwriting as the cookie is removed completely first
  // exit if remove event (no cookie is added / changed)
  if (changeInfo.removed) {
    return;
  }
  var allowed = await getCookieAllowedState(changeInfo.cookie);
  if (!allowed) {
    addCookieToUnwantedList(changeInfo.cookie);
    await deleteCookie(changeInfo.cookie);
    updateActiveTabsCounts();
  }
}
/*
 * dom storage functions
 * The functions communicate with injected js in the tab in order to do their job
 */
function getTabDomStorage(tabId) {
  // returns both local and session storage from a given tab
  var result = new Promise(function(resolve, reject) {
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'getStorage'
    });
    sending.then(function(result) {
      result.localStorage = JSON.parse(result.localStorage);
      result.sessionStorage = JSON.parse(result.sessionStorage);
      resolve(result);
    }, reject);
  });
  return result;
}

function addDomStorageEntry(tabId, persistent, name, value, overwriteEntry) {
  // adds a new dom storage entry to a given tab
  var result = new Promise(async function(resolve, reject) {
    // delete overwriteEntry
    if (overwriteEntry !== null) {
      await deleteDomStorageEntry(tabId, overwriteEntry);
    }
    var storage = (persistent ? 'local' : 'session');
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'addEntry',
      storage: storage,
      name: name,
      value: value
    });
    sending.then(resolve, async function(error) {
      // restore overwriteEntry if new entry could not be set
      if (overwriteEntry !== null) {
        await addDomStorageEntry(tabId, overwriteEntry.permanence, overwriteEntry.name, overwriteEntry.value, null);
      }
      reject(error);
    });
  });
  return result;
}

function deleteDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  var result = new Promise(function(resolve, reject) {
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'deleteEntry',
      entry: entry
    });
    sending.then(resolve, logError);
  });
  return result;
}

function clearTabDomStorage(tabId) {
  // deletes all dom storage entries from a given tab
  var answer = new Promise(function(resolve, reject) {
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'clearStorage'
    });
    sending.then(resolve, logError);
  });
  return answer;
}
/*
 * site exception functions
 */
function getPermSiteException(hostname) {
  // returns the permanent exception for the given hostname
  // returns null if there is none
  var result = new Promise(function(resolve, reject) {
    var key = `ex|${encodeURI(hostname)}`;
    var getting = browser.storage.local.get({
      [key]: null
    });
    getting.then(function(items) {
      resolve(items[key]);
    }, logError);
  });
  return result;
}

function addSiteException(url, rule, temporary, overwriteException) {
  // adds a new site exception for the given domain
  var result = new Promise(async function(resolve, reject) {
    // delete overwriteException
    if (overwriteException !== null) {
      await deleteSiteException(`https://${overwriteException.domain}`, false);
    }
    var site = trimSubdomains(url);
    if (temporary) {
      bgPage.tempSiteExceptions[encodeURI(site)] = rule;
      await Promise.all([restoreAllTabsCookiesFromUnwantedList(),
        deleteAllTabsUnwantedCookies()
      ]);
      resolve();
      updateAllTabsIcons();
      updateActiveTabsCounts();
    } else {
      var saving = savePermSiteException(site, rule);
      saving.then(async function() {
        delete bgPage.tempSiteExceptions[site];
        await Promise.all([restoreAllTabsCookiesFromUnwantedList(),
          deleteAllTabsUnwantedCookies()
        ]);
        resolve();
        updateAllTabsIcons();
        updateActiveTabsCounts();
      }, async function(error) {
        // restore overwriteException if new exception could not be set
        if (overwriteException !== null) {
          await addSiteException(`https://${overwriteException.domain}`, overwriteException.ruleId, false, null);
        }
        reject(error);
      });
    }
    return result;

    function savePermSiteException(hostname, rule) {
      // sets an exception for a given hostname
      var result = new Promise(function(resolve, reject) {
        try {
          // make sure the hostname is valid
          var url = new URL(`http://${hostname}`);
          // count . in hostname to reject subdomains
          var domainCount = url.hostname.split('.').length - 1;
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
        var setting = browser.storage.local.set({
          // use prefix 'ex' for exceptions and hostname as key
          [`ex|${encodeURI(hostname)}`]: rule
        });
        setting.then(resolve, logError);
      });
      return result;
    }
  });
  return result;
}

function deletePermSiteException(hostname) {
  // deletes the permanent exception for the given hostname (if there is any)
  var result = new Promise(function(resolve, reject) {
    var key = `ex|${encodeURI(hostname)}`;
    var removing = browser.storage.local.remove(key)
    removing.then(resolve, logError);
  });
  return result;
}

function deleteSiteException(url, temporary) {
  // deletes the permanent or temporary exception for the given hostname (if there is any)
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(url);
    if (temporary) {
      delete bgPage.tempSiteExceptions[encodeURI(hostname)];
      await Promise.all([restoreAllTabsCookiesFromUnwantedList(),
        deleteAllTabsUnwantedCookies()
      ]);
      resolve();
      updateAllTabsIcons();
      updateActiveTabsCounts();
    } else {
      await deletePermSiteException(hostname);
      await Promise.all([restoreAllTabsCookiesFromUnwantedList(),
        deleteAllTabsUnwantedCookies()
      ]);
      resolve();
      updateAllTabsIcons();
      updateActiveTabsCounts();
    }
  });
  return result;
}

function getSiteBehaviour(hostname) {
  // returns the behaviour for a given hostname
  // takes temporary and permanent exceptions as well as whitelist entries into account
  var result = new Promise(function(resolve, reject) {
    // first check if there is a temporary exception
    if (hostname in bgPage.tempSiteExceptions) {
      resolve(bgPage.tempSiteExceptions[hostname]);
    } else {
      // if there is no temporary exception, check for a permanent one
      var getting = getPermSiteException(hostname);
      getting.then(function(permSiteException) {
        if (permSiteException !== null) {
          resolve(permSiteException);
        } else {
          // if there is no permanent exception either, use default behaviour
          resolve(bgPage.defaultBehaviour);
        }
      }, logError);
    }
  });
  return result;
}

function sendBehaviour(request) {
  // returns the requested behaviour for a given site
  var answer = new Promise(async function(resolve, reject) {
    var domain = trimSubdomains(request.url);
    await getSiteBehaviour(domain);
    resolve();
  });
  return answer;
}
/*
 * whitelist functions
 */
function getObjectWhitelistedState(domain, name, type) {
  // returns wether a whitelist entry exists
  var result = new Promise(function(resolve, reject) {
    var key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
    var getting = browser.storage.local.get({
      [key]: null
    });
    getting.then(function(items) {
      var whitelistedEntry = items[key];
      if (whitelistedEntry === null) {
        resolve(false);
      } else {
        resolve(true);
      }
    }, logError);
  });
  return result;
}

function addWhitelistEntry(domain, name, type, overwriteEntry) {
  // adds a new whitelist with the given data
  var result = new Promise(async function(resolve, reject) {
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
    var setting = browser.storage.local.set({
      // use prefix 'wl' for whitelist entries and both domain and name as key
      // last letter is the type: d --> dom storage, c --> cookie
      //use '|' as separator and encode all the other stuff to prevent fuck ups
      [`wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`]: ''
    });
    setting.then(resolve, async function(error) {
      // restore overwriteEntry if new entry could not be set
      if (overwriteEntry !== null) {
        await addWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type, null);
      }
      reject(error);
    });
  });
  return result;
}

function deleteWhitelistEntry(domain, name, type) {
  // removes a whitelist entry matching the given data
  var result = new Promise(function(resolve, reject) {
    var key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
    browser.storage.local.remove(key).then(resolve, logError);
  });
  return result;
}

function sendDomstorageEntryWhitelistedState(request) {
  // returns whether a dom storage entry from a request is whitelisted and also the name of the entry itself
  var answer = new Promise(async function(resolve, reject) {
    var whitelisted = await getObjectWhitelistedState(request.domain, request.name, 'd');
    resolve({
      name: request.name,
      whitelisted: whitelisted
    });
  });
  return answer;
}
/*
status icon functions
*/
function updateTabIcon(tabId) {
  // updates the icon for a specific tab (not overall) according to the tabs behaviour
  function setIcon(behaviour) {
    var iconPath = null;
    var badgeColor = null;
    var title = null;
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
  var getting = browser.tabs.get(tabId);
  getting.then(function(tab) {
    if (tab.url.startsWith('http')) {
      var url = tab.url;
      var hostname = trimSubdomains(url);
      var getting = getSiteBehaviour(hostname);
      getting.then(setIcon, logError);
    } else {
      setIcon(-1);
    }
  }, logError);
}

function updateAllTabsIcons() {
  // updates icon for all open tabs
  var querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      updateTabIcon(tab.id);
    });
  }, logError);
}
async function updateActiveTabsCounts() {
  // sets cookie count on icon batch according to the behaviour for the active tab
  if (!bgPage.enableCookieCounter) {
    // exit if feature is disabled
    return;
  }
  // get active tab in every window
  var querying = browser.tabs.query({
    active: true
  });
  querying.then(async function(tabs) {
    for (var tab of tabs) {
      if (typeof tab !== 'undefined') {
        if (tab.url.startsWith('http')) {
          var cookieStore = await getTabCookieStore(tab.id);
          // get cookies
          var getting = getAllCookies({
            url: tab.url,
            storeId: cookieStore
          });
          getting.then(function(cookies) {
            countCookies(cookies, tab);
          });
        } else {
          setBadgeText(tab.id, '');
        }
      }
    }
  }, logError);

  function countCookies(cookies, tab) {
    // count cookies
    var count = cookies.length;
    // get dom storage
    var getting = getTabDomStorage(tab.id);
    getting.then(async function(response) {
        // get behaviour
        var behaviour = await getSiteBehaviour(trimSubdomains(tab.url));
        // count dom storage, ignore unwanted entries
        if (behaviour == 2) {
          // if behaviour is 'allow all' just count all
          count = count + Object.keys(response.localStorage).length + Object.keys(response.sessionStorage).length;
        } else {
          // if it is a different behaviour, check whitelisted status and permanency
          for (var storageEntry in response.localStorage) {
            var whitelisted = await getObjectWhitelistedState((new URL(tab.url)).hostname, storageEntry, 'd');
            if (whitelisted) {
              count++;
            }
          }
          for (storageEntry in response.sessionStorage) {
            whitelisted = await getObjectWhitelistedState((new URL(tab.url)).hostname, storageEntry, 'd');
            if (behaviour == 1 || whitelisted) {
              count++;
            }
          }
        }
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
  var querying = browser.tabs.query({});
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
  var hostname = (new URL(url)).hostname;
  var trimmedDomain = hostname.split('.');
  return `${trimmedDomain[trimmedDomain.length - 2]}.${trimmedDomain[trimmedDomain.length - 1]}`;
}

function formatDate(date) {
  // formats a date for displaying in tables
  var month = `${(date.getMonth() + 1 < 10 ? '0' : '')}${date.getMonth() + 1}`;
  var day = `${(date.getDate() < 10 ? '0' : '')}${date.getDate()}`;
  var year = date.getFullYear();
  return `${year}/${month}/${day}`;
}

function logError(error) {
  // logs an error to the console
  console.log(`Cookie Ripper ${error}`);
  console.error(error);
}

function getActiveTab() {
  // returns the active Tab
  var result = new Promise(function(resolve, reject) {
    var querying = browser.tabs.query({
      active: true,
      currentWindow: true
    });
    querying.then(function(tabs) {
      resolve(tabs[0]);
    }, logError);
  });
  return result
}

function getTabCookieStore(tabId) {
  // returns the id of the cookie store which the given tab uses
  // chromium does not supply tab.cookieStoreId :(
  var result = new Promise(function(resolve, reject) {
    var getting = browser.cookies.getAllCookieStores();
    getting.then(function(cookieStores) {
      for (let store of cookieStores) {
        if (store.tabIds.includes(tabId)) {
          return resolve(store.id);
        }
      }
      logError(Error("This tab could not be found in any cookie store."));
    }, logError);
  });
  return result
}