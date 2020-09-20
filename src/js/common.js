'use strict';
/*
 *
 * This file contains functions that may be used by all the other js files.
 *
 */
/* for accessing variables from background page if not in private mode */
let bgPage = browser.extension.getBackgroundPage();
/* whether firstPartyIsolation is supported */
let firstPartyIsolationSupported;
initFirstPartyIsolationSupported();
async function initFirstPartyIsolationSupported() {
  // inits firstPartyIsolationSupported
  try {
    firstPartyIsolationSupported = await checkFirstPartyIsolationSupport();
  } catch (e) {
    console.error(e);
  }
}

async function checkFirstPartyIsolationSupport() {
  // checks whether the first party domain cookie property is supported
  try {
    await browser.cookies.get({
      name: '',
      url: '',
      firstPartyDomain: ''
    });
    return true;
  } catch (e) {
    console.log('Browser does not support first party domain cookie property.');
    return false;
  }
}
/*
 * functions for getting settings from background page
 * getting them from the background page is better than storing them in a variable because only the background page reloads the settings when changed by the user
 * it is also less limited and probably faster than reading from the disk even when using the messaging api
 * the functions either call a funtion in the background page directly or send a message to do their job
 */
async function callGetDefaultBehaviour() {
  // gets default behaviour from background page
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    return bgPage.defaultBehaviour;
  } else {
    return browser.runtime.sendMessage({
      type: 'getDefaultBehaviour'
    });
  }
}

function callGetEnableCookieCounter() {
  // gets default behaviour from background page
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    return bgPage.enableCookieCounter;
  } else {
    return browser.runtime.sendMessage({
      type: 'getEnableCookieCounter'
    });
  }
}
async function callLoadSettings() {
  // reloads settings in background page
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    await bgPage.loadSettings();
  } else {
    await browser.runtime.sendMessage({
      type: 'loadSettings'
    });
  }
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
async function addCookie(name, value, domain, path, session, date, time, hostOnly, secure, httpOnly, cookieStore, firstPartyDomain, sameSite, overwriteCookie = null) {
  // creates a new cookie from the given data; also makes sure the provided overwrite-cookie gets actually overwritten or deleted
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
    storeId: cookieStore,
    sameSite: sameSite
  };
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = firstPartyDomain;
  }
  try {
    await browser.cookies.set(parameters);
  } catch (e) {
    // restore overwriteCookie if new cookie could not be set
    if (overwriteCookie !== null) {
      await addCookieFromObject(overwriteCookie);
    }
    throw e;
  }
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
    session: session,
    expirationDate: expirationDate,
    storeId: cookieStore
  };
  let allowed = await getCookieAllowedState(newCookie);
  if (!allowed) {
    await callAddUnwantedCookie(newCookie);
    await deleteCookie(newCookie);
  }
}
async function addCookieFromObject(cookie, cookieStore) {
  // creates a new cookie from the given cookie object
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
    storeId: cookieStore,
    sameSite: cookie.sameSite
  };
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = cookie.firstPartyDomain;
  }
  await browser.cookies.set(parameters);
}
async function deleteCookie(cookie) {
  // deletes the provided cookie
  let parameters = {
    url: `https://${cookie.domain}${cookie.path}`,
    name: cookie.name,
    storeId: cookie.storeId
  };
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = cookie.firstPartyDomain;
  }
  await browser.cookies.remove(parameters);
}
async function deleteAllCookies(url, cookieStore) {
  // deletes all cookies from the given url
  let siteCookies = await getAllCookies({
    url: url,
    storeId: cookieStore
  });
  let promises = siteCookies.map(function(cookie) {
    return deleteCookie(cookie);
  });
  // also remove unwanted cookies from memory
  promises.push(callClearUnwantedCookiesforDomain(getRuleRelevantPartOfDomain(url), cookieStore));
  await Promise.all(promises);
}
async function deleteExistingUnwantedCookies(url, cookieStore) {
  // deletes all existung but unwanted cookies from a given domain
  let domain = getRuleRelevantPartOfDomain(url);
  let behaviour = await getSiteBehaviour(domain);
  let siteCookies = await getAllCookies({
    url: url,
    storeId: cookieStore
  });
  let promises = siteCookies.flatMap(async function(cookie) {
    if (behaviour == 0 || (behaviour == 1 && !cookie.session)) {
      let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c');
      if (!whitelisted) {
        return [deleteCookie(cookie), callAddUnwantedCookie(cookie)];
      }
    }
  });
  await Promise.all(promises);
}
async function deleteAllTabsExistingUnwantedCookies() {
  // deletes all existung but unwanted cookies from all open tabs
  let tabs = await browser.tabs.query({});
  let promises = tabs.map(async function(tab) {
    if (tab.url.startsWith('http')) {
      let cookieStore = await getTabCookieStore(tab.id);
      return deleteExistingUnwantedCookies(tab.url, cookieStore);
    }
  });
  await Promise.all(promises);
}
async function getCookieAllowedState(cookie) {
  // returns if a given cookie is allowed (should be accepted) or not
  let caseBehaviour = await getSiteBehaviour(getRuleRelevantPartOfDomain(cookie.domain));
  // allow if all cookies are allowed for that site
  if (caseBehaviour == 2) {
    return true;
  }
  // allow if the cookie is whitelisted
  let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c');
  if (whitelisted) {
    return true;
  }
  switch (caseBehaviour) {
    case 0:
      // dont allow if cookies are not allowed for the site
      return false;
      break;
    case 1:
      // allow session
      if (cookie.session) {
        // allow if session cookies are allowed and its a session cookie
        return true;
      } else {
        // deny if session cookies are allowed and its not a session cookie
        return false;
      }
      break;
    default:
      // invalid
      throw Error(`Error: invalid Behaviour: ${caseBehaviour}`);
  }
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
    await updateActiveTabsCounts();
  }
}
/*
 * unwanted cookie functions
 * the functions either call a funtion in the background page directly or send a message to do their job
 */
async function callGetUnwantedCookiesForDomain(domain, cookieStore) {
  // returns the object that stores the cookies for the given domain in unwanted list
  // use function directly or send message depending on the availability of bgPage
  let cookies;
  if (bgPage !== null) {
    cookies = await bgPage.getUnwantedCookiesForDomain({
      domain: domain,
      cookieStore: cookieStore
    });
  } else {
    cookies = await browser.runtime.sendMessage({
      type: 'getUnwantedCookiesForDomain',
      domain: domain,
      cookieStore: cookieStore
    });
  }
  return cookies;
}
async function callAddUnwantedCookie(cookie) {
  // adds a cookie to the list of unwanted cookies
  // only do it if the site is opened in a tab
  // stringify to prevent some weird ff dead object issue
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    await bgPage.addUnwantedCookie({
      cookie: cookie
    });
  } else {
    await browser.runtime.sendMessage({
      type: 'addUnwantedCookie',
      cookie: cookie
    });
  }
}
async function callRestoreUnwantedCookie(fullCookieDomain, name, cookieStore) {
  // re-creates a cookie from unwanted list in case the user whitelists it
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    await bgPage.restoreUnwantedCookie({
      domain: fullCookieDomain,
      name: name,
      cookieStore: cookieStore
    });
  } else {
    await browser.runtime.sendMessage({
      type: 'restoreUnwantedCookie',
      domain: fullCookieDomain,
      name: name,
      cookieStore: cookieStore
    });
  }
}
async function callRestoreAllDomainsUnwantedCookies() {
  // re-creates cookies from unwanted list in case the user changes the behaviour for a domain
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    return await bgPage.restoreAllDomainsUnwantedCookies();
  } else {
    return await browser.runtime.sendMessage({
      type: 'restoreAllDomainsUnwantedCookies'
    });
  }
}
async function callDeleteUnwantedCookie(domain, name, cookieStore) {
  // deletes a cookie from the list of unwanted cookies
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    await bgPage.deleteUnwantedCookie({
      domain: domain,
      name: name,
      cookieStore: cookieStore
    });
  } else {
    await browser.runtime.sendMessage({
      type: 'deleteUnwantedCookie',
      domain: domain,
      name: name,
      cookieStore: cookieStore
    });
  }
}
async function callClearUnwantedCookiesforDomain(domain, cookieStore) {
  // clears all unwanted cookies from the list of unwanted cookies for a domain
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    await bgPage.clearUnwantedCookiesforDomain({
      domain: domain,
      cookieStore: cookieStore
    });
  } else {
    await browser.runtime.sendMessage({
      type: 'clearUnwantedCookiesforDomain',
      domain: domain,
      cookieStore: cookieStore
    });
  }
}
/*
 * dom storage functions
 * the functions communicate with injected js in the tab in order to do their job
 */
async function getTabDomStorage(tabId) {
  // returns both local and session storage from a given tab
  let result = await browser.tabs.sendMessage(tabId, {
    type: 'getStorage'
  });
  result.localStorage = JSON.parse(result.localStorage);
  result.sessionStorage = JSON.parse(result.sessionStorage);
  return result;
}
async function getUnwantedDomStorageEntries(tabId) {
  // returns the unwanted dom storage entries from a given tab
  return await browser.tabs.sendMessage(tabId, {
    type: 'getUnwantedStorage'
  });
}
async function addDomStorageEntry(tabId, persistent, name, value, overwriteEntry = null) {
  // adds a new dom storage entry to a given tab
  // delete overwriteEntry
  if (overwriteEntry !== null) {
    await deleteDomStorageEntry(tabId, overwriteEntry);
  }
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'addEntry',
      persistent: persistent,
      name: name,
      value: value
    });
  } catch (e) {
    // restore overwriteEntry if new entry could not be set
    if (overwriteEntry !== null) {
      await addDomStorageEntry(tabId, overwriteEntry.persistent, overwriteEntry.name, overwriteEntry.value);
    }
    throw e;
  }
  // delete the entry if unwanted
  await deleteExistingUnwantedDomStorageEntries(tabId);
}
async function deleteDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  await browser.tabs.sendMessage(tabId, {
    type: 'deleteEntry',
    entry: entry
  });
}
async function deleteUnwantedDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  await browser.tabs.sendMessage(tabId, {
    type: 'deleteUnwantedEntry',
    entry: entry
  });
}
async function restoreUnwantedDomStorageEntry(tabId, entry) {
  // re-creates a dom storage entry from unwanted list in case the user whitelists it
  await browser.tabs.sendMessage(tabId, {
    type: 'restoreUnwantedEntry',
    entry: entry
  });
}
async function restoreAllTabsUnwantedDomStorageEntries() {
  // re-creates all tabs' wanted dom storage entries from unwanted list
  let tabs = await browser.tabs.query({});
  let promises = tabs.map(async function(tab) {
    if (tab.url.startsWith('http')) {
      return await browser.tabs.sendMessage(tab.id, {
        type: 'restoreUnwantedEntries'
      });
    }
  });
  await Promise.all(promises);
}
async function deleteExistingUnwantedDomStorageEntries(tabId) {
  // deletes all existung but unwanted dom storage entries from a given tab
  return await browser.tabs.sendMessage(tabId, {
    type: 'deleteExistingUnwantedEntries'
  });
}
async function deleteAllTabsExistingUnwantedDomStorageEntries() {
  // deletes all existung but unwanted dom storage entries from all open tabs
  let tabs = await browser.tabs.query({});
  let promises = tabs.map(async function(tab) {
    if (tab.url.startsWith('http')) {
      await deleteExistingUnwantedDomStorageEntries(tab.id);
    }
  });
  await Promise.all(promises);
}
async function clearTabDomStorage(tabId) {
  // deletes all dom storage entries from a given tab
  await browser.tabs.sendMessage(tabId, {
    type: 'clearStorage'
  });
}
/*
 * site exception functions
 */
async function getSiteException(domain, temporary) {
  // returns the exception for the given domain; returns null if there is none
  if (temporary) {
    // use function directly or send message depending on the availability of bgPage
    let exception;
    if (bgPage !== null) {
      exception = await bgPage.getTempSiteException({
        domain: domain
      });
    } else {
      exception = await browser.runtime.sendMessage({
        type: 'getTempSiteException',
        domain: domain
      });
    }
    return exception;
  } else {
    let key = `ex|${domain}`;
    let items = await browser.storage.local.get({
      [key]: null
    });
    return items[key];
  }
}
async function addSiteException(domain, rule, temporary, overwriteException = null) {
  // adds a new site exception for the given domain
  // delete overwriteException
  if (overwriteException !== null) {
    await deleteSiteException(overwriteException.domain, false);
  }
  if (temporary) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      await bgPage.addTempSiteException({
        domain: domain,
        rule: rule
      });
    } else {
      await browser.runtime.sendMessage({
        type: 'addTempSiteException',
        domain: domain,
        rule: rule
      });
    }
  } else {
    try {
      await savePermSiteException(domain, rule);
    } catch (e) {
      // restore overwriteException if new exception could not be set
      if (overwriteException !== null) {
        await addSiteException(overwriteException.domain, overwriteException.ruleId, false);
      }
      throw e;
    }
    await deleteSiteException(domain, true);
    await Promise.all([callRestoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
    try {
      // can fail if unable to inject content script
      await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
    } catch (e) {
      console.warn(e);
    }
    await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()]);
  }
  async function savePermSiteException(domain, rule) {
    // sets an exception for a given domain
    // requires tld.js to be loaded
    // make sure the domain is valid
    let parsedDomain = tldjs.parse(domain);
    if (!parsedDomain.isValid) {
      throw Error('Invalid domain.');
    }
    // reject subdomains
    if (parsedDomain.subdomain) {
      throw Error('Subdomains are not supportet.');
    }
    // reject public suffixes only
    if (parsedDomain.hostname === parsedDomain.publicSuffix) {
      throw Error('Only organization level domains are supported.');
    }
    // reject if there is more info than the domain (e.g. path or port)
    if (parsedDomain.hostname !== domain) {
      throw Error('Invalid domain.');
    }
    await browser.storage.local.set({
      // use prefix 'ex' for exceptions and domain as key
      [`ex|${domain}`]: rule
    });
  }
}
async function deletePermSiteException(domain) {
  // deletes the permanent exception for the given domain (if there is any)
  let key = `ex|${encodeURI(domain)}`;
  await browser.storage.local.remove(key)
}
async function deleteSiteException(domain, temporary) {
  // deletes the permanent or temporary exception for the given domain (if there is any)
  if (temporary) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      await bgPage.deleteTempSiteException({
        domain: domain
      });
    } else {
      await browser.runtime.sendMessage({
        type: 'deleteTempSiteException',
        domain: domain
      });
    }
  } else {
    await deletePermSiteException(domain);
    await Promise.all([callRestoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()]);
    try {
      // can fail if unable to inject content script
      await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()]);
    } catch (e) {
      console.warn(e);
    }
    await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()]);
  }
}
async function clearTempSiteExceptions() {
  // deletes all temp site exceptions
  // use function directly or send message depending on the availability of bgPage
  if (bgPage !== null) {
    await bgPage.clearTempSiteExceptions();
  } else {
    await browser.runtime.sendMessage({
      type: 'clearTempSiteExceptions'
    });
  }
}
async function getSiteBehaviour(domain) {
  // returns the behaviour for a given domain
  // takes temporary and permanent exceptions as well as whitelist entries into account
  // first check if there is a temporary exception
  let tempException = await getSiteException(domain, true);
  if (tempException !== null) {
    return tempException;
  } else {
    // if there is no temporary exception, check for a permanent one
    let permSiteException = await getSiteException(domain, false);
    if (permSiteException !== null) {
      return permSiteException;
    } else {
      // if there is no permanent exception either, use default behaviour
      return await callGetDefaultBehaviour();
    }
  }
}
/*
 * whitelist functions
 */
async function getObjectWhitelistedState(domain, name, type) {
  // returns wether a whitelist entry exists
  domain = domain.startsWith('.') ? domain.substr(1) : domain;
  let key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
  let items = await browser.storage.local.get({
    [key]: null
  });
  let whitelistedEntry = items[key];
  return !(whitelistedEntry === null);
}
async function addWhitelistEntry(domain, name, type, overwriteEntry = null) {
  // adds a new whitelist with the given data
  domain = domain.startsWith('.') ? domain.substr(1) : domain;
  // make sure the domain is valid
  new URL(`http://${domain}`);
  // delete overwriteEntry
  if (overwriteEntry !== null) {
    await deleteWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type);
  }
  try {
    await browser.storage.local.set({
      // use prefix 'wl' for whitelist entries and both domain and name as key
      // last letter is the type: d --> dom storage, c --> cookie
      //use '|' as separator and encode all the other stuff to prevent fuck ups
      [`wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`]: ''
    });
  } catch (e) {
    // restore overwriteEntry if new entry could not be set
    if (overwriteEntry !== null) {
      await addWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type);
    }
    throw e;
  }
}
async function deleteWhitelistEntry(domain, name, type) {
  // removes a whitelist entry matching the given data
  domain = domain.startsWith('.') ? domain.substr(1) : domain;
  let key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
  await browser.storage.local.remove(key);
}
async function getDomstorageEntryWhitelistedStateAsResponse(request) {
  // returns whether a dom storage entry from a request is whitelisted and also the name of the entry itself
  let whitelisted = await getObjectWhitelistedState(request.domain, request.name, 'd');
  return {
    name: request.name,
    whitelisted: whitelisted
  };
}
/*
status icon functions
*/
async function updateTabIcon(tabId) {
  // updates the icon for a specific tab (not overall) according to the tabs behaviour
  let tab = await browser.tabs.get(tabId);
  if (tab.url.startsWith('http')) {
    let url = tab.url;
    let domain = getRuleRelevantPartOfDomain(url);
    let behaviour = await getSiteBehaviour(domain);
    setIcon(behaviour);
  } else {
    setIcon(-1);
  }
  return

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
        console.error(Error(`invalid Behaviour: ${behaviour}`));
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
}
async function updateAllTabsIcons() {
  // updates icon for all open tabs
  let tabs = await browser.tabs.query({});
  var promises = tabs.map(function(tab) {
    return updateTabIcon(tab.id);
  });
  await Promise.all(promises);
}
async function updateActiveTabsCounts() {
  // sets cookie count on icon batch according to the behaviour for the active tab
  let enabled = await callGetEnableCookieCounter();
  if (!enabled) {
    // exit if feature is disabled
    return;
  }
  // get active tab in every window
  let tabs = await browser.tabs.query({
    active: true
  });
  for (let tab of tabs) {
    if (typeof tab !== 'undefined') {
      let cookieCount = '';
      if (tab.url.startsWith('http')) {
        // get cookies
        cookieCount = await countCookies(tab);
      }
      browser.browserAction.setBadgeText({
        text: `${cookieCount}`,
        tabId: tab.id
      });
    }
  }
  async function countCookies(tab) {
    // count cookies
    let cookieStore = await getTabCookieStore(tab.id);
    let cookies = await getAllCookies({
      url: tab.url,
      storeId: cookieStore
    })
    let count = cookies.length;
    // get dom storage
    let response;
    try {
      response = await getTabDomStorage(tab.id);
      // count dom storage
      count = count + Object.keys(response.localStorage).length + Object.keys(response.sessionStorage).length;
    } catch (e) {
      // can fail if unable to inject content script
      console.warn(e);
    }
    return count
  }
}
async function removeAllTabsCounts() {
  // removes the cookie count from all tabs
  let tabs = await browser.tabs.query({});
  let promises = tabs.map(function(tab) {
    return browser.browserAction.setBadgeText({
      text: '',
      tabId: tab.id
    });
  });
  await Promise.all(promises);
}
/*
 * misc functions
 */
function getRuleRelevantPartOfDomain(urlOrHostname) {
  // returns the part of an url or hostname that is used for rules (domain without subdomains or ip or hostname)
  // requires tld.js to be loaded
  // first remove leading '.', if any
  urlOrHostname = urlOrHostname.startsWith('.') ? urlOrHostname.substr(1) : urlOrHostname;
  let parsedUrl = tldjs.parse(urlOrHostname);
  return parsedUrl.domain == null ? parsedUrl.hostname : parsedUrl.domain;
}

function formatDate(date) {
  // formats a date for displaying in tables
  let month = `${(date.getMonth() + 1 < 10 ? '0' : '')}${date.getMonth() + 1}`;
  let day = `${(date.getDate() < 10 ? '0' : '')}${date.getDate()}`;
  let year = date.getFullYear();
  return `${year}/${month}/${day}`;
}

async function getActiveTab() {
  // returns the active Tab
  let tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0];
}
async function getTabCookieStore(tabId) {
  // returns the id of the cookie store which the given tab uses
  // chromium does not supply tab.cookieStoreId :(
  let cookieStores = await browser.cookies.getAllCookieStores();
  for (let store of cookieStores) {
    if (store.tabIds.includes(tabId)) {
      return store.id;
    }
  }
  throw Error("This tab could not be found in any cookie store.");
}

async function sendInfoMessage(message) {
  // sends a message to the user
  await browser.notifications.create(null, {
    type: 'basic',
    message: message,
    title: "Cookie Ripper Info"
  });
}