'use strict'
let tempSiteExceptions = {}
let openDomainsUnwantedCookies = {}
var defaultBehaviour, enableCookieCounter
async function loadSettings(skipUpdatingScripts = false) {
  // loads settings from storage and applies them
  let items = await browser.storage.sync.get({
    defaultBehaviour: 2,
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
      await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()])
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
async function getEnableCookieCounter(request) {
  // returns whether cookie counter in enabled
  return enableCookieCounter
}
async function getTempSiteException(request) {
  // returns the rule of a temporary exception
  let exception = tempSiteExceptions[encodeURI(request.domain)]
  exception = typeof exception === "undefined" ? null : exception
  return exception
}
async function addTempSiteException(request) {
  // adds a temporary exception
  tempSiteExceptions[encodeURI(request.domain)] = request.rule
  await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // this can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
}
async function deleteTempSiteException(request) {
  // deletes a temporary exception
  delete tempSiteExceptions[encodeURI(request.domain)]
  await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // this can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
}
async function clearTempSiteExceptions(request) {
  // deletes all temporary exceptions
  tempSiteExceptions = []
  await Promise.all([restoreAllDomainsUnwantedCookies(), deleteAllTabsExistingUnwantedCookies()])
  try {
    // can fail if unable to inject content script
    await Promise.all([restoreAllTabsUnwantedDomStorageEntries(), deleteAllTabsExistingUnwantedDomStorageEntries()])
  } catch (e) {
    console.warn(e)
  }
  await Promise.all([updateAllTabsIcons(), updateActiveTabsCounts()])
}
async function getUnwantedCookiesForDomain(request) {
  // returns a domain's cookies from unwanted list
  let cookies = []
  if (typeof openDomainsUnwantedCookies[request.domain] === "undefined" || typeof openDomainsUnwantedCookies[request.domain].cookieStores[request.cookieStore] === "undefined") {
    return []
  }
  for (let key in openDomainsUnwantedCookies[request.domain].cookieStores[request.cookieStore].unwantedCookies) {
    let cookie = JSON.parse(openDomainsUnwantedCookies[request.domain].cookieStores[request.cookieStore].unwantedCookies[key])
    cookies.push(cookie)
  }
  return cookies
}
async function addUnwantedCookie(request) {
  // adds a single cookie to unwanted list
  let cookieDomain = getRuleRelevantPartOfDomain(request.cookie.domain)
  // if it is undefined, it is a third party cookie which does not need to be recorded
  if (openDomainsUnwantedCookies[cookieDomain] != undefined) {
    // add cookie store to domain if needed
    if (openDomainsUnwantedCookies[cookieDomain].cookieStores[request.cookie.storeId] === undefined) {
      openDomainsUnwantedCookies[cookieDomain].cookieStores[request.cookie.storeId].unwantedCookies = {}
    }
    let key = `${encodeURI(request.cookie.domain)}|${encodeURI(request.cookie.name)}`
    let value = JSON.stringify(request.cookie)
    openDomainsUnwantedCookies[cookieDomain].cookieStores[request.cookie.storeId].unwantedCookies[key] = value
  }
}
async function restoreUnwantedCookie(request) {
  // re-creates a cookie from unwanted list for all cookie store where it was listed
  let domain = getRuleRelevantPartOfDomain(request.domain)
  let cookieKey = `${encodeURI(request.domain)}|${encodeURI(request.name)}`
  let cookieStorePromises = Object.keys(openDomainsUnwantedCookies[domain].cookieStores).map(async storeKey => {
    let cookie = JSON.parse(openDomainsUnwantedCookies[domain].cookieStores[storeKey].unwantedCookies[cookieKey])
    await addCookieFromObject(cookie, cookie.storeId)
    delete openDomainsUnwantedCookies[domain].cookieStores[storeKey].unwantedCookies[cookieKey]
  })
  await Promise.all(cookieStorePromises)
}
async function restoreAllDomainsUnwantedCookies(request) {
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
async function deleteUnwantedCookie(request) {
  // deletes a cookie from unwanted list
  let domain = getRuleRelevantPartOfDomain(request.domain)
  let cookieKey = `${encodeURI(request.domain)}|${encodeURI(request.name)}`
  delete openDomainsUnwantedCookies[domain].cookieStores[request.cookieStore].unwantedCookies[cookieKey]
}
async function clearUnwantedCookiesforDomain(request) {
  // deletes a domain's cookies from unwanted list
  openDomainsUnwantedCookies[request.domain].cookieStores[request.cookieStore].unwantedCookies = {}
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
async function getTabDomStorageItemsAllowedStates(request) {
  // returns an array of booleans meaning whether a dom storage entry is allowed or not
  let behaviour = await getSiteBehaviour(getRuleRelevantPartOfDomain(request.domain))
  // if behaviour is allow all --> return true for all items
  if (behaviour == 2) {
    return request.items.map(_ => {
      return true
    })
  }
  // if behaviour is not allow all --> check whitelisted state and storage type
  let promises = request.items.map(async item => {
    return getObjectWhitelistedState(request.domain, item.name, 'd').then(whitelisted => {
      return (whitelisted || (behaviour == 1 && !item.persistent))
    })
  })
  return Promise.all(promises)
}

function handleMessage(request, sender) {
  // those messages are sent from the content scripts and other js files
  // call the correct function to respond to them
  switch (request.type) {
    case 'addTempSiteException':
      return addTempSiteException(request)
      break
    case 'getTempSiteException':
      return getTempSiteException(request)
      break
    case 'deleteTempSiteException':
      return deleteTempSiteException(request)
      break
    case 'clearTempSiteExceptions':
      return clearTempSiteExceptions(request)
      break
    case 'addUnwantedCookie':
      return addUnwantedCookie(request)
      break
    case 'clearUnwantedCookiesforDomain':
      return clearUnwantedCookiesforDomain(request)
      break
    case 'deleteUnwantedCookie':
      return deleteUnwantedCookie(request)
      break
    case 'restoreUnwantedCookie':
      return restoreUnwantedCookie(request)
      break
    case 'restoreAllDomainsUnwantedCookies':
      return restoreAllDomainsUnwantedCookies(request)
      break
    case 'getUnwantedCookiesForDomain':
      return getUnwantedCookiesForDomain(request)
      break
    case 'getDefaultBehaviour':
      return Promise.resolve(defaultBehaviour)
      break
    case 'getEnableCookieCounter':
      return getEnableCookieCounter(request)
      break
    case 'loadSettings':
      return loadSettings()
      break
    case 'getTabDomStorageItemsAllowedStates':
      return getTabDomStorageItemsAllowedStates(request)
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
    await deleteExistingUnwantedCookies(details.url)
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