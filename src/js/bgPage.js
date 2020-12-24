'use strict'
let tempSiteExceptions = []
let openDomainsUnwantedCookies = {}
var defaultBehaviour, enableCookieCounter
async function loadSettings(skipUpdatingScripts = false) {
  // loads settings from storage and applies them
  let items = await browser.storage.sync.get({
    defaultBehaviour: 1,
    enableCookieCounter: false
  })
  defaultBehaviour = Number(items.defaultBehaviour)
  enableCookieCounter = items.enableCookieCounter
  if (skipUpdatingScripts) {
    // when installing, the content scripts are not injected yet
    await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  } else {
    await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
    try {
      // this can fail if unable to inject content script
      await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), handleAllTabsExistingUnwantedDomStorageEntries()])
    } catch (e) {
      console.warn(e)
    }
  }
  await updateAllTabsIcons()
  if (!enableCookieCounter) {
    await removeAllTabsCounts()
  } else {
    await updateActiveTabsCounts()
  }
}
async function injectJsInAllTabs() {
  // injects js into all open tabs (http*) new tabs are handled by manifest entry
  // also sets the correct icon and count for the open tabs
  let tabs = await browser.tabs.query({})
  var promises = []
  promises.push(...tabs.flatMap(tab => {
    if (!tab.url.startsWith('http')) {
      return []
    }
    return [browser.tabs.executeScript(tab.id, {
      file: 'lib/browser-polyfill/browser-polyfill.js'
    }), browser.tabs.executeScript(tab.id, {
      file: '/js/contentScript.js'
    })]
  }))
  try {
    await Promise.all(promises)
  } catch (e) {
    console.error(e)
  }
}
// these getter functions are needed for the wrapper in common.js as it can not call an async function in a getter but it can do so in a function
async function getDefaultBehaviour() {
  // returns the default behaviour
  return defaultBehaviour
}
async function getEnableCookieCounter() {
  // returns whether cookie counter in enabled
  return enableCookieCounter
}
async function hasTempSiteException(domain) {
  // returns the rule of a temporary exception
  return tempSiteExceptions.includes(encodeURI(domain))
}
async function addTempSiteException(domain) {
  // adds a temporary exception
  tempSiteExceptions.push(encodeURI(domain))
  await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // this can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), handleAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
}
async function deleteTempSiteException(domain) {
  // deletes a temporary exception
  tempSiteExceptions = tempSiteExceptions.filter(item => item !== domain)
  await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // this can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), handleAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
}
async function clearTempSiteExceptions() {
  // deletes all temporary exceptions
  tempSiteExceptions = []
  await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), handleAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
}
async function getUnwantedCookiesForDomain(domain, cookieStore) {
  // returns a domain's cookies from unwanted list
  let cookies = []
  if (typeof openDomainsUnwantedCookies[domain] === "undefined" || typeof openDomainsUnwantedCookies[domain].cookieStores[cookieStore] === "undefined") {
    return []
  }
  for (let key in openDomainsUnwantedCookies[domain].cookieStores[cookieStore].unwantedCookies) {
    let cookie = JSON.parse(openDomainsUnwantedCookies[domain].cookieStores[cookieStore].unwantedCookies[key])
    cookies.push(cookie)
  }
  return cookies
}
async function addUnwantedCookie(cookie) {
  // adds a single cookie to unwanted list
  let cookieDomain = getRuleRelevantPartOfDomain(cookie.domain)
  // if it is undefined, it is a third party cookie which does not need to be recorded
  if (openDomainsUnwantedCookies[cookieDomain] != undefined) {
    // add cookie store to domain if needed
    if (openDomainsUnwantedCookies[cookieDomain].cookieStores[cookie.storeId] === undefined) {
      openDomainsUnwantedCookies[cookieDomain].cookieStores[cookie.storeId].unwantedCookies = {}
    }
    let key = `${encodeURI(cookie.domain)}|${encodeURI(cookie.name)}`
    let value = JSON.stringify(cookie)
    openDomainsUnwantedCookies[cookieDomain].cookieStores[cookie.storeId].unwantedCookies[key] = value
  }
}
async function restoreUnwantedCookie(domain, name) {
  // re-creates a cookie from unwanted list for all cookie stores where it was listed
  let ruleDomain = getRuleRelevantPartOfDomain(domain)
  let cookieKey = `${encodeURI(domain)}|${encodeURI(name)}`
  let cookieStorePromises = Object.keys(openDomainsUnwantedCookies[ruleDomain].cookieStores).map(async storeKey => {
    let json = openDomainsUnwantedCookies[ruleDomain].cookieStores[storeKey].unwantedCookies[cookieKey]
    if (json !== undefined) {
      let cookie = JSON.parse(json)
      await addCookieFromObject(cookie, cookie.storeId)
      delete openDomainsUnwantedCookies[ruleDomain].cookieStores[storeKey].unwantedCookies[cookieKey]
    }
  })
  await Promise.all(cookieStorePromises)
}
async function restoreAllDomainsUnwantedCookies() {
  // re-creates all domains' wanted cookies from unwanted list
  // it is assumed that whitelisted cookies are not in the unwanted list
  let domainPromises = Object.keys(openDomainsUnwantedCookies).map(domain => {
    // get behaviour for domain
    return getSiteBehaviour(domain).then(async behaviour => {
      // exit if behaviour is 'deny'
      if (!(behaviour === 0)) {
        let cookieStorePromises = Object.keys(openDomainsUnwantedCookies[domain].cookieStores).map(async storeKey => {
          let cookiePromises = Object.keys(openDomainsUnwantedCookies[domain].cookieStores[storeKey].unwantedCookies).map(async cookieKey => {
            let cookie = JSON.parse(openDomainsUnwantedCookies[domain].cookieStores[storeKey].unwantedCookies[cookieKey])
            // check if cookie should be restored
            if (behaviour === 2 || behaviour === 1 && cookie.session) {
              await addCookieFromObject(cookie, cookie.storeId)
              delete openDomainsUnwantedCookies[domain].cookieStores[storeKey].unwantedCookies[cookieKey]
            } else if (behaviour === 1 && !cookie.session) {
              await convertCookieToSessionCookie(cookie)
              delete openDomainsUnwantedCookies[domain].cookieStores[storeKey].unwantedCookies[cookieKey]
            }
          })
          await Promise.all(cookiePromises)
        })
        await Promise.all(cookieStorePromises)
      }
    })
  })
  await Promise.all(domainPromises)
}
async function deleteUnwantedCookie(domain, name) {
  // deletes a cookie from unwanted list
  let ruleDomain = getRuleRelevantPartOfDomain(domain)
  let cookieKey = `${encodeURI(ruleDomain)}|${encodeURI(name)}`
  delete openDomainsUnwantedCookies[ruleDomain].cookieStores[cookieStore].unwantedCookies[cookieKey]
}
async function clearUnwantedCookiesforDomain(domain, cookieStore) {
  // deletes a domain's cookies from unwanted list
  openDomainsUnwantedCookies[domain].cookieStores[cookieStore].unwantedCookies = {}
}
async function populateopenDomainsUnwantedCookies() {
  // adds all open sites to openDomainsUnwantedCookies
  let tabs = await browser.tabs.query({})
  tabs.forEach(async tab => {
    let cookieStore
    try {
      cookieStore = await getTabCookieStore(tab.id)
    } catch {
      return
    }
    let domain = getRuleRelevantPartOfDomain(tab.url)
    if (typeof(openDomainsUnwantedCookies[domain]) === 'undefined') {
      openDomainsUnwantedCookies[domain] = {
        domain: domain,
        cookieStores: {}
      }
    }
    openDomainsUnwantedCookies[domain].cookieStores[cookieStore] = {
      unwantedCookies: {}
    }
  })
}
async function removeClosedDomainsFromopenDomainsUnwantedCookies() {
  // removes all sites from openDomainsUnwantedCookies that are not open anymore
  // create array of all open domains
  let openTabsDomainsCookieStores = {}
  let tabs = await browser.tabs.query({})
  tabs.forEach(async tab => {
    let cookieStore = await getTabCookieStore(tab.id)
    if (openTabsDomainsCookieStores[tab.url] === undefined) {
      openTabsDomainsCookieStores[tab.url] = [cookieStore]
    } else {
      openTabsDomainsCookieStores[tab.url].push(cookieStore)
    }
  })
  // iterate all entries in openDomainsUnwantedCookies and remove them if the domain is not open in a tab anymore
  for (let domain in openDomainsUnwantedCookies) {
    for (let cookieStore in openDomainsUnwantedCookies[domain].cookieStores) {
      if (typeof openTabsDomainsCookieStores[domain] !== 'undefined' && !openTabsDomainsCookieStores[domain].includes(cookieStore)) {
        delete openDomainsUnwantedCookies[domain].cookieStores[cookieStore]
        if (openDomainsUnwantedCookies.size == 0) {
          delete openDomainsUnwantedCookies[domain]
        }
      }
    }
  }
}
async function getTabDomStorageItemsAllowedStates(domain, items) {
  // returns an array of booleans meaning whether a dom storage entry is allowed or not
  // d -> delete
  // k -> keep
  // c -> convert
  let behaviour = await getSiteBehaviour(getRuleRelevantPartOfDomain(domain))
  // if behaviour is allow all --> return k or c for all items
  if (behaviour == 2) {
    return items.map(item => {
      return item.isConverted ? 'c' : 'k'
    })
  }
  // if behaviour is not allow all --> check whitelisted state and storage type
  let promises = items.map(async item => {
    let whitelisted = await getObjectWhitelistedState(domain, item.name, 'd')
    if (whitelisted) {
      return item.isConverted ? 'c' : 'k'
    }
    switch (behaviour) {
      case 0:
        // delete if storage is not allowed for the site
        return 'd'
        break
      case 1:
        // convert to session
        // keep if its a session cookie; convert if its not
        return item.persistent && !item.isConverted ? 'c' : 'k'
        break
      default:
        // invalid
        throw Error(`Error: invalid Behaviour: ${caseBehaviour}`)
    }
  })
  return Promise.all(promises)
}

function handleMessage(request, sender) {
  // those messages are sent from the content scripts and other js files
  // call the correct function to respond to them
  switch (request.type) {
    case 'addTempSiteException':
      return addTempSiteException(request.domain)
      break
    case 'hasTempSiteException':
      return hasTempSiteException(request.domain)
      break
    case 'deleteTempSiteException':
      return deleteTempSiteException(request.domain)
      break
    case 'clearTempSiteExceptions':
      return clearTempSiteExceptions()
      break
    case 'addUnwantedCookie':
      return addUnwantedCookie(request.cookie)
      break
    case 'clearUnwantedCookiesforDomain':
      return clearUnwantedCookiesforDomain(request.domain, request.cookieStore)
      break
    case 'deleteUnwantedCookie':
      return deleteUnwantedCookie(request.domain, request.name)
      break
    case 'restoreUnwantedCookie':
      return restoreUnwantedCookie(request.domain, request.name)
      break
    case 'restoreAllDomainsUnwantedCookies':
      return restoreAllDomainsUnwantedCookies()
      break
    case 'getUnwantedCookiesForDomain':
      return getUnwantedCookiesForDomain(request.domain, request.cookieStore)
      break
    case 'getDefaultBehaviour':
      return getDefaultBehaviour()
      break
    case 'getEnableCookieCounter':
      return getEnableCookieCounter()
      break
    case 'loadSettings':
      return loadSettings()
      break
    case 'getTabDomStorageItemsAllowedStates':
      return getTabDomStorageItemsAllowedStates(request.domain, request.items)
      break
    default:
      return Promise.reject(Error(`Unknown request type: ${request.type}`))
  }
}
/*
 * intialization (parts of it must not be in a separate function to work properly in ff)
 */
init()
async function init() {
  try {
    await populateopenDomainsUnwantedCookies()
    await loadSettings(true)
    await injectJsInAllTabs()
  } catch (e) {
    console.error(e)
  }
}
browser.runtime.onMessage.addListener(handleMessage)
browser.webNavigation.onCompleted.addListener(async details => {
  try {
    await updateActiveTabsCounts()
  } catch (e) {
    console.error(e)
  }
})
browser.tabs.onActivated.addListener(async activeInfo => {
  try {
    await updateActiveTabsCounts()
  } catch (e) {
    console.error(e)
  }
})
browser.runtime.onInstalled.addListener(async details => {
  // shows the user a welcome message and opens the settings page also injects js in open tabs and takes care of the extension icon
  try {
    if (details.reason === "install") {
      await browser.tabs.create({
        url: '/welcome.html'
      })
    }
  } catch (e) {
    console.error(e)
  }
})
browser.cookies.onChanged.addListener(handleCookieEvent)
browser.webNavigation.onBeforeNavigate.addListener(async details => {
  if (!['auto_subframe', 'manual_subframe'].includes(details.transitionType)) {
    // if new domain --> add it to list
    let newDomain = getRuleRelevantPartOfDomain(details.url)
    if (!openDomainsUnwantedCookies.hasOwnProperty(newDomain)) {
      openDomainsUnwantedCookies[newDomain] = {
        domain: newDomain,
        cookieStores: {}
      }
    }
    let cookieStore = await getTabCookieStore(details.tabId)
    if (!openDomainsUnwantedCookies[newDomain].cookieStores.hasOwnProperty(cookieStore)) {
      openDomainsUnwantedCookies[newDomain].cookieStores[cookieStore] = {
        unwantedCookies: {}
      }
    }
  }
})
browser.webNavigation.onCommitted.addListener(async details => {
  // update icon and count and delete unwanted cookies
  try {
    await updateTabIcon(details.tabId)
    await handleExistingUnwantedCookies(details.url)
    await updateActiveTabsCounts()
    await removeClosedDomainsFromopenDomainsUnwantedCookies()
  } catch (e) {
    console.error(e)
  }
})
browser.tabs.onCreated.addListener(async tab => {
  try {
    await updateTabIcon(tab.id)
  } catch (e) {
    console.error(e)
  }
})