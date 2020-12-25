'use strict'
/*
 *
 * This file contains functions that may be used by all the other js files.
 *
 */
/* prefix for permanent dom storage entries converted into temporary ones */
const CONVERT_PREFIX = '__CR_'
/* whether firstPartyIsolation is supported */
let firstPartyIsolationSupported
/* shim for accessing background page when in private mode */
class backgroundPageShim {
  async getUnwantedCookiesForDomain(domain, cookieStore) {
    return browser.runtime.sendMessage({
      type: 'getUnwantedCookiesForDomain',
      domain: domain,
      cookieStore: cookieStore
    })
  }
  async addUnwantedCookie(cookie) {
    return browser.runtime.sendMessage({
      type: 'addUnwantedCookie',
      cookie: cookie
    })
  }
  async restoreUnwantedCookie(fullCookieDomain, name) {
    return browser.runtime.sendMessage({
      type: 'restoreUnwantedCookie',
      domain: fullCookieDomain,
      name: name
    })
  }
  async restoreAllDomainsUnwantedCookies() {
    return browser.runtime.sendMessage({
      type: 'restoreAllDomainsUnwantedCookies'
    })
  }
  async deleteUnwantedCookie(domain, name, cookieStore) {
    return browser.runtime.sendMessage({
      type: 'deleteUnwantedCookie',
      domain: domain,
      name: name,
      cookieStore: cookieStore
    })
  }
  async clearUnwantedCookiesforDomain(domain, cookieStore) {
    return browser.runtime.sendMessage({
      type: 'clearUnwantedCookiesforDomain',
      domain: domain,
      cookieStore: cookieStore
    })
  }
  async hasTempSiteException(domain) {
    return browser.runtime.sendMessage({
      type: 'hasTempSiteException',
      domain: domain
    })
  }
  async addTempSiteException(domain) {
    return browser.runtime.sendMessage({
      type: 'addTempSiteException',
      domain: domain
    })
  }
  async deleteTempSiteException(domain) {
    return browser.runtime.sendMessage({
      type: 'deleteTempSiteException',
      domain: domain
    })
  }
  async clearTempSiteExceptions() {
    return browser.runtime.sendMessage({
      type: 'clearTempSiteExceptions'
    })
  }
  // getting settings from the background page is better than storing them in a variable because only the background page reloads the settings when changed by the user
  // it is also less limited and probably faster than reading from the disk even when using the messaging api
  async getDefaultBehaviour() {
    return browser.runtime.sendMessage({
      type: 'getDefaultBehaviour'
    })
  }
  async getEnableCookieCounter() {
    return browser.runtime.sendMessage({
      type: 'getEnableCookieCounter'
    })
  }
  async loadSettings() {
    return browser.runtime.sendMessage({
      type: 'loadSettings'
    })
  }
}
let bgPage = browser.extension.getBackgroundPage() || new backgroundPageShim()
initFirstPartyIsolationSupported()
async function initFirstPartyIsolationSupported() {
  // inits firstPartyIsolationSupported
  try {
    firstPartyIsolationSupported = await checkFirstPartyIsolationSupport()
  } catch (e) {
    console.error(e)
  }
}

async function checkFirstPartyIsolationSupport() {
  // checks whether the first party domain cookie property is supported
  try {
    await browser.cookies.get({
      name: '',
      url: '',
      firstPartyDomain: ''
    })
    return true
  } catch (e) {
    console.log('Browser does not support first party domain cookie property.')
    return false
  }
}
/*
 *cookie functions
 */
function getAllCookies(parameters) {
  // returns all cookies matching the given criteria
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = null
  }
  return browser.cookies.getAll(parameters)
}
async function addCookie(name, value, domain, path, session, date, time, hostOnly, secure, httpOnly, cookieStore, firstPartyDomain, sameSite, overwriteCookie = null) {
  // creates a new cookie from the given data also makes sure the provided overwrite-cookie gets actually overwritten or deleted
  // delete overwriteCookie
  if (overwriteCookie !== null) {
    await deleteCookie(overwriteCookie)
  }
  // create new cookie
  let url = (domain.startsWith('.') ? `https://${domain.substr(1)}` : `https://${domain}`)
  let expirationDate = (session ? null : ((date.getTime() + time.getTime() + new Date().getTimezoneOffset() * 60000) / 1000))
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
  }
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = firstPartyDomain
  }
  try {
    await browser.cookies.set(parameters)
  } catch (e) {
    // restore overwriteCookie if new cookie could not be set
    if (overwriteCookie !== null) {
      await addCookieFromObject(overwriteCookie)
    }
    throw e
  }
  // make sure that if the cookie is unwanted, it is handled before resolving to prevent the ui from refreshing too early with incorrect data
  // cookie.set returns a cookie object but seems to be unreliable in both chromium and ff so just use the input data instead
  let newDomain
  if (!domain.startsWith(".")) {
    newDomain = hostOnly ? domain : `.${domain}`
  } else {
    newDomain = hostOnly ? domain.slice(1) : domain
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
  }
  let allowedState = await getCookieAllowedState(newCookie)
  switch (allowedState) {
    case 'd':
      await Promise.all([bgPage.addUnwantedCookie(newCookie), deleteCookie(newCookie)])
      break
    case 'c':
      await convertCookieToSessionCookie(newCookie)
      break
    default:
      // no action needed to keep the cookie as is
      break
  }
}
async function addCookieFromObject(cookie) {
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
    storeId: cookie.storeId,
    sameSite: cookie.sameSite
  }
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = cookie.firstPartyDomain
  }
  await browser.cookies.set(parameters)
}
async function deleteCookie(cookie) {
  // deletes the provided cookie
  let parameters = {
    url: `https://${cookie.domain}${cookie.path}`,
    name: cookie.name,
    storeId: cookie.storeId
  }
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = cookie.firstPartyDomain
  }
  await browser.cookies.remove(parameters)
}
async function deleteAllCookies(url, cookieStore) {
  // deletes all cookies from the given url
  let siteCookies = await getAllCookies({
    url: url,
    storeId: cookieStore
  })
  let promises = siteCookies.map(cookie => {
    return deleteCookie(cookie)
  })
  // also remove unwanted cookies from memory
  promises.push(bgPage.clearUnwantedCookiesforDomain(getRuleRelevantPartOfDomain(url), cookieStore))
  await Promise.all(promises)
}
async function handleExistingUnwantedCookies(url) {
  // deletes all existung but unwanted cookies from a given url
  let domain = getRuleRelevantPartOfDomain(url)
  let behaviour = await getSiteBehaviour(domain)
  if (behaviour == 2) {
    // all cookies allowed
    return
  }
  let cookieStores = await browser.cookies.getAllCookieStores()
  let siteCookiePromises = cookieStores.map(async cookieStore => {
    return getAllCookies({
      url: url,
      storeId: cookieStore.id
    })
  })
  let siteCookies = (await Promise.all(siteCookiePromises)).flat()
  let promises = siteCookies.flatMap(async cookie => {
    let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c')
    if (whitelisted) {
      return
    }
    if (behaviour == 0) {
      return Promise.all([deleteCookie(cookie), bgPage.addUnwantedCookie(cookie)])
    } else if (behaviour == 1 && !cookie.session) {
      await convertCookieToSessionCookie(cookie)
    }
  })
  await Promise.all(promises)
}
async function deleteAllTabsExistingUnwantedCookies() {
  // deletes all existung but unwanted cookies from all open tabs
  let tabs = await browser.tabs.query({})
  let promises = tabs.map(async tab => {
    if (tab.url.startsWith('http')) {
      return handleExistingUnwantedCookies(tab.url)
    }
  })
  await Promise.all(promises)
}
async function getCookieAllowedState(cookie) {
  // returns the appropriate action for a cookie
  // d -> delete
  // k -> keep
  // c -> convert
  let caseBehaviour = await getSiteBehaviour(getRuleRelevantPartOfDomain(cookie.domain))
  // keep if all cookies are allowed for that site
  if (caseBehaviour == 2) {
    return 'k'
  }
  // keep if the cookie is whitelisted
  let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c')
  if (whitelisted) {
    return 'k'
  }
  switch (caseBehaviour) {
    case 0:
      // delete if cookies are not allowed for the site
      return 'd'
      break
    case 1:
      // convert to session
      if (cookie.session) {
        // keep if convert to session is set and its a session cookie
        return 'k'
      } else {
        // convert if convert to session is set and its not a session cookie
        return 'c'
      }
      break
    default:
      // invalid
      throw Error(`Error: invalid Behaviour: ${caseBehaviour}`)
  }
}
async function convertCookieToSessionCookie(cookie) {
  let sessionCookie = {
    ...cookie,
    expirationDate: undefined
  }
  await addCookieFromObject(sessionCookie)
}
async function handleCookieEvent(changeInfo) {
  // is used when a cookie change event needs to be handled
  // determines the correct action to take and executes it
  // note: .removed is also true when overwriting as the cookie is removed completely first
  // exit if remove event (no cookie is added / changed)
  if (changeInfo.removed) {
    return
  }
  let allowedState = await getCookieAllowedState(changeInfo.cookie);
  switch (allowedState) {
    case 'd':
      await Promise.all([bgPage.addUnwantedCookie(changeInfo.cookie), deleteCookie(changeInfo.cookie)])
      break
    case 'c':
      await convertCookieToSessionCookie(changeInfo.cookie)
      break
    default:
      // no action needed to keep the cookie as is
      break
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
  })
  result.localStorage = JSON.parse(result.localStorage)
  result.sessionStorage = JSON.parse(result.sessionStorage)
  return result
}
async function getUnwantedDomStorageEntries(tabId) {
  // returns the unwanted dom storage entries from a given tab
  return await browser.tabs.sendMessage(tabId, {
    type: 'getUnwantedStorage'
  })
}
async function addDomStorageEntry(tabId, persistent, name, value, overwriteEntry = null) {
  // adds a new dom storage entry to a given tab
  // prevent the users from adding the prefix themselves
  if (persistent) {
    while (name.startsWith(CONVERT_PREFIX)) {
      name = name.substr(CONVERT_PREFIX.length)
    }
  } else {
    // allow a single convert prefix for temporary items
    while (name.startsWith(CONVERT_PREFIX + CONVERT_PREFIX)) {
      name = name.substr(CONVERT_PREFIX.length)
    }
  }
  // delete overwriteEntry
  if (overwriteEntry !== null) {
    await deleteDomStorageEntry(tabId, overwriteEntry)
  }
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'addEntry',
      persistent: persistent,
      name: name,
      value: value
    })
  } catch (e) {
    // restore overwriteEntry if new entry could not be set
    if (overwriteEntry !== null) {
      await addDomStorageEntry(tabId, overwriteEntry.persistent, overwriteEntry.name, overwriteEntry.value)
    }
    throw e
  }
  // delete the entry if unwanted
  await handleExistingUnwantedDomStorageEntries(tabId)
}
async function deleteDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  await browser.tabs.sendMessage(tabId, {
    type: 'deleteEntry',
    entry: entry
  })
}
async function deleteUnwantedDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  await browser.tabs.sendMessage(tabId, {
    type: 'deleteUnwantedEntry',
    entry: entry
  })
}
async function deleteUnwantedDomStorageEntriesByName(hostname, name) {
  // deletes unwanted dom storage entries by name
  let tabs = await browser.tabs.query({})
  let promises = tabs.map(async tab => {
    if ((new URL(tab.url)).hostname === hostname) {
      return await browser.tabs.sendMessage(tab.id, {
        type: 'deleteUnwantedEntriesByName',
        name: name
      })
    }
  })
  await Promise.all(promises)
}
async function restoreUnwantedDomStorageEntriesByName(hostname, name) {
  // re-creates dom storage entries from unwanted list in case the user whitelists one
  let tabs = await browser.tabs.query({})
  let promises = tabs.map(async tab => {
    if ((new URL(tab.url)).hostname === hostname) {
      return await browser.tabs.sendMessage(tab.id, {
        type: 'restoreUnwantedEntriesByName',
        name: name
      })
    }
  })
  await Promise.all(promises)
}
async function restoreAllTabsUnwantedDomStorageEntries() {
  // re-creates all tabs' wanted dom storage entries from unwanted list
  let tabs = await browser.tabs.query({})
  let promises = tabs.map(async tab => {
    if (tab.url.startsWith('http')) {
      return await browser.tabs.sendMessage(tab.id, {
        type: 'restoreUnwantedEntries'
      })
    }
  })
  await Promise.all(promises)
}
async function handleExistingUnwantedDomStorageEntriesByName(hostname, name) {
  // handles existing but unwanted dom storage entries
  let tabs = await browser.tabs.query({})
  let promises = tabs.map(async tab => {
    if ((new URL(tab.url)).hostname === hostname) {
      return await browser.tabs.sendMessage(tab.id, {
        type: 'handleExistingUnwantedEntriesByName',
        name: name
      })
    }
  })
  await Promise.all(promises)
}
async function handleExistingUnwantedDomStorageEntries(tabId) {
  // handles all existung but unwanted dom storage entries from a given tab
  return await browser.tabs.sendMessage(tabId, {
    type: 'handleExistingUnwantedEntries'
  })
}
async function handleAllTabsExistingUnwantedDomStorageEntries() {
  // handles all existung but unwanted dom storage entries from all open tabs
  let tabs = await browser.tabs.query({})
  let promises = tabs.map(async tab => {
    if (tab.url.startsWith('http')) {
      await handleExistingUnwantedDomStorageEntries(tab.id)
    }
  })
  await Promise.all(promises)
}
async function clearTabDomStorage(tabId) {
  // deletes all dom storage entries from a given tab
  await browser.tabs.sendMessage(tabId, {
    type: 'clearStorage'
  })
}
/*
 * site exception functions
 */
async function getPermSiteException(domain) {
  // returns the permanent exception for the given domain returns null if there is none
  let key = `ex|${domain}`
  let items = await browser.storage.local.get({
    [key]: null
  })
  return items[key]
}
async function addPermSiteException(domain, rule, overwriteException = null) {
  // adds a new site exception for the given domain
  // delete overwriteException
  if (overwriteException !== null) {
    await deletePermSiteException(overwriteException.domain)
  }
  try {
    await savePermSiteException(domain, rule)
  } catch (e) {
    // restore overwriteException if new exception could not be set
    if (overwriteException !== null) {
      await addPermSiteException(overwriteException.domain, overwriteException.ruleId, false)
    }
    throw e
  }
  await bgPage.deleteTempSiteException(domain)
  await Promise.all([bgPage.restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), handleAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
  async function savePermSiteException(domain, rule) {
    // sets an exception for a given domain
    // requires tld.js to be loaded
    // make sure the domain is valid
    let parsedDomain = tldjs.parse(domain)
    if (!parsedDomain.isValid) {
      throw Error('Invalid domain.')
    }
    // reject subdomains
    if (parsedDomain.subdomain) {
      throw Error('Subdomains are not supportet.')
    }
    // reject public suffixes only
    if (parsedDomain.hostname === parsedDomain.publicSuffix) {
      throw Error('Only organization level domains are supported.')
    }
    // reject if there is more info than the domain (e.g. path or port)
    if (parsedDomain.hostname !== domain) {
      throw Error('Invalid domain.')
    }
    await browser.storage.local.set({
      // use prefix 'ex' for exceptions and domain as key
      [`ex|${domain}`]: rule
    })
  }
}
async function deletePermSiteException(domain) {
  // deletes the permanent exception for the given domain (if there is any)
  let key = `ex|${encodeURI(domain)}`
  await browser.storage.local.remove(key)
  await Promise.all([bgPage.restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), handleAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
}
async function getSiteBehaviour(domain) {
  // returns the behaviour for a given domain
  // takes temporary and permanent exceptions as well as whitelist entries into account
  // first check if there is a temporary exception
  let tempException = await bgPage.hasTempSiteException(domain)
  if (tempException) {
    return 2
  } else {
    // if there is no temporary exception, check for a permanent one
    let permSiteException = await getPermSiteException(domain)
    if (permSiteException !== null) {
      return permSiteException
    } else {
      // if there is no permanent exception either, use default behaviour
      return await bgPage.getDefaultBehaviour()
    }
  }
}
/*
 * whitelist functions
 */
async function getObjectWhitelistedState(domain, name, type) {
  // returns wether a whitelist entry exists
  domain = domain.startsWith('.') ? domain.substr(1) : domain
  let key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`
  let items = await browser.storage.local.get({
    [key]: null
  })
  let whitelistedEntry = items[key]
  return !(whitelistedEntry === null)
}
async function addWhitelistEntry(domain, name, type, overwriteEntry = null) {
  // adds a new whitelist with the given data
  let nameWithoutPrefix = name.startsWith(CONVERT_PREFIX) ? name.substr(CONVERT_PREFIX.length) : name
  domain = domain.startsWith('.') ? domain.substr(1) : domain
  // make sure the domain is valid
  new URL(`http://${domain}`)
  // delete overwriteEntry
  if (overwriteEntry !== null) {
    await deleteWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type)
  }
  try {
    await browser.storage.local.set({
      // use prefix 'wl' for whitelist entries and both domain and name as key
      // last letter is the type: d --> dom storage, c --> cookie
      //use '|' as separator and encode all the other stuff to prevent fuck ups
      [`wl|${encodeURI(domain)}|${encodeURI(nameWithoutPrefix)}|${type}`]: ''
    })
  } catch (e) {
    // restore overwriteEntry if new entry could not be set
    if (overwriteEntry !== null) {
      await addWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type)
    }
    throw e
  }
}
async function deleteWhitelistEntry(domain, name, type) {
  // removes a whitelist entry matching the given data
  let nameWithoutPrefix = name.startsWith(CONVERT_PREFIX) ? name.substr(CONVERT_PREFIX.length) : name
  domain = domain.startsWith('.') ? domain.substr(1) : domain
  let key = `wl|${encodeURI(domain)}|${encodeURI(nameWithoutPrefix)}|${type}`
  await browser.storage.local.remove(key)
}
async function getDomstorageEntryWhitelistedStateAsResponse(request) {
  // returns whether a dom storage entry from a request is whitelisted and also the name of the entry itself
  let whitelisted = await getObjectWhitelistedState(request.domain, request.name, 'd')
  return {
    name: request.name,
    whitelisted: whitelisted
  }
}
/*
status icon functions
*/
async function updateTabIcon(tabId) {
  // updates the icon for a specific tab (not overall) according to the tabs behaviour
  let tab = await browser.tabs.get(tabId)
  if (tab.url.startsWith('http')) {
    let url = tab.url
    let domain = getRuleRelevantPartOfDomain(url)
    let behaviour = await getSiteBehaviour(domain)
    setIcon(behaviour)
  } else {
    setIcon(-1)
  }
  return

  function setIcon(behaviour) {
    let iconPath = null
    let badgeColor = null
    let title = null
    switch (behaviour) {
      case 0:
        // deny
        iconPath = {
          16: 'icons/cookieRipperDeny_16.png',
          32: 'icons/cookieRipperDeny_32.png',
          48: 'icons/cookieRipperDeny_48.png'
        }
        badgeColor = 'red'
        title = 'Cookie Ripper is blocking cookies from this site.'
        break
      case 1:
        // allow session
        iconPath = {
          16: 'icons/cookieRipperAllowSession_16.png',
          32: 'icons/cookieRipperAllowSession_32.png',
          48: 'icons/cookieRipperAllowSession_48.png'
        }
        badgeColor = 'orange'
        title = 'Cookie Ripper is allowing session cookies from this site.'
        break
      case 2:
        // allow
        iconPath = {
          16: 'icons/cookieRipperAllow_16.png',
          32: 'icons/cookieRipperAllow_32.png',
          48: 'icons/cookieRipperAllow_48.png'
        }
        badgeColor = 'limegreen'
        title = 'Cookie Ripper is allowing all cookies from this site.'
        break
      case -1:
        // site is out of scope
        iconPath = {
          16: 'icons/cookieRipperDisabled_16.png',
          32: 'icons/cookieRipperDisabled_32.png',
          48: 'icons/cookieRipperDisabled_48.png'
        }
        badgeColor = 'blue'
        title = 'Cookie Ripper is not active on this site.'
        break
      default:
        // invalid
        console.error(Error(`invalid Behaviour: ${behaviour}`))
    }
    browser.browserAction.setIcon({
      path: iconPath,
      tabId: tabId
    })
    browser.browserAction.setBadgeBackgroundColor({
      color: badgeColor,
      tabId: tabId
    })
    browser.browserAction.setTitle({
      title: title,
      tabId: tabId
    })
  }
}
async function updateAllTabsIcons() {
  // updates icon for all open tabs
  let tabs = await browser.tabs.query({})
  var promises = tabs.map(tab => {
    return updateTabIcon(tab.id)
  })
  await Promise.all(promises)
}
async function updateActiveTabsCounts() {
  // sets cookie count on icon batch according to the behaviour for the active tab
  let enabled = await bgPage.getEnableCookieCounter()
  if (!enabled) {
    // exit if feature is disabled
    return
  }
  // get active tab in every window
  let tabs = await browser.tabs.query({
    active: true
  })
  for (let tab of tabs) {
    if (typeof tab !== 'undefined') {
      let cookieCount = ''
      if (tab.url.startsWith('http')) {
        // get cookies
        cookieCount = await countCookies(tab)
      }
      browser.browserAction.setBadgeText({
        text: `${cookieCount}`,
        tabId: tab.id
      })
    }
  }
  async function countCookies(tab) {
    // count cookies
    let cookieStore = await getTabCookieStore(tab.id)
    let cookies = await getAllCookies({
      url: tab.url,
      storeId: cookieStore
    })
    let count = cookies.length
    // get dom storage
    let response
    try {
      response = await getTabDomStorage(tab.id)
      // count dom storage
      count = count + Object.keys(response.localStorage).length + Object.keys(response.sessionStorage).length
    } catch (e) {
      // can fail if unable to inject content script
      console.warn(e)
    }
    return count
  }
}
async function removeAllTabsCounts() {
  // removes the cookie count from all tabs
  let tabs = await browser.tabs.query({})
  let promises = tabs.map(tab => {
    return browser.browserAction.setBadgeText({
      text: '',
      tabId: tab.id
    })
  })
  await Promise.all(promises)
}

/*
 * UI functions
 */
async function sendInfoMessage(message) {
  // sends a message to the user
  await browser.notifications.create(null, {
    type: 'basic',
    message: message,
    title: "Cookie Ripper Info"
  })
}

function addInfoIconEventListeners() {
  // adds the correct event listener to all info icons on the page
  let infoIcons = document.querySelectorAll('.infoIcon')
  infoIcons.forEach(icon => icon.addEventListener('click', async e => {
    try {
      e.stopPropagation()
      await sendInfoMessage(e.target.title)
    } catch (e) {
      console.error(e)
    }
  }));
}

/*
 * misc functions
 */
function getRuleRelevantPartOfDomain(urlOrHostname) {
  // returns the part of an url or hostname that is used for rules (domain without subdomains or ip or hostname)
  // requires tld.js to be loaded
  // first remove leading '.', if any
  urlOrHostname = urlOrHostname.startsWith('.') ? urlOrHostname.substr(1) : urlOrHostname
  let parsedUrl = tldjs.parse(urlOrHostname)
  return parsedUrl.domain == null ? parsedUrl.hostname : parsedUrl.domain
}

function formatDate(date) {
  // formats a date for displaying in tables
  let month = `${(date.getMonth() + 1 < 10 ? '0' : '')}${date.getMonth() + 1}`
  let day = `${(date.getDate() < 10 ? '0' : '')}${date.getDate()}`
  let year = date.getFullYear()
  return `${year}/${month}/${day}`
}

async function getActiveTab() {
  // returns the active Tab
  let tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  })
  return tabs[0]
}
async function getTabCookieStore(tabId) {
  // returns the id of the cookie store which the given tab uses
  // chromium does not supply tab.cookieStoreId :(
  let cookieStores = await browser.cookies.getAllCookieStores()
  for (let store of cookieStores) {
    if (store.tabIds.includes(tabId)) {
      return store.id
    }
  }
  throw Error("This tab could not be found in any cookie store.")
}