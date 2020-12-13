'use strict'
let activeTabUrl, activeTabDomain, activeTabId, activeTabCookieStore
//selected cookie for the cookie editor
let cookieInEditor = null
let domStorageEntryInEditor = null
let cookieList = []
let domList = []
let contentScriptavailable = true
const connectToContentScriptMaxRetries = 5
const connectToContentScriptRetryDelayMs = 50
// ui elements
let firstPartyDomainArea, defaultIcon, defaultOption, denyOption, sessionOption, allowOption, slider, useTempBehaviourArea, useSiteBehaviourArea, allowTempCheckBox, allowTempLbl, headline, cookieStore, nonHttpInfo, mainView, cookieTable, domStorageTable, cookieDomainTextBox, cookieHostOnly, cookieNameTextBox, cookieValueTextBox, cookieSessionCookie, cookiePersistent, cookieDate, cookieTime, cookiePathTextBox, cookieFirstPartyDomainTextBox, cookieSecure, cookieHttpOnly, sameSiteSelect, cookieDeleteButton, domStorageDomainTextBox, domStorageNameTextBox, domStorageValueTextBox, domStorageTemporary, domStoragePermanent, domStorageDeleteButton, cookieEditor, domStorageEditor, advancedCookieProperties, cookieAdvancedToggle, cookieCancelButton, domStorageCancelButton, cookieSaveButton, cookieEditorError, domStorageEditorError, domStorageSaveButton, cookieAddIcon, domAddIcon, cookieDeleteAllIcon, domDeleteAllIcon, optionsDropdown, optionsImage, dropdownItemSettings, dropdownItemClearTemp
document.addEventListener('DOMContentLoaded', async _ => {
  try {
    let tab = await getActiveTab()
    activeTabUrl = tab.url
    activeTabDomain = getRuleRelevantPartOfDomain(activeTabUrl)
    activeTabId = tab.id
    activeTabCookieStore = await getTabCookieStore(activeTabId)
    if (activeTabUrl.startsWith('http')) {
      // get all the dom storage and cookies
      await fillCookieList()
      if (contentScriptavailable) {
        try {
          await fillDomStorageList()
        } catch (e) {
          // getting dom storage can fail if unable to inject the content script
          console.warn(e)
        }
      }
      await Promise.all([initCookieTable(), initDomStorageTable()])
      assignUiElements()
      addEventlisteners()
    } else {
      assignUiElements()
    }
    await fillSiteInfo()
  } catch (e) {
    console.error(e)
  }
})
/* formatters for the tables*/
function actionElementsFormatter(cell, formatterParams) {
  return `<input class="tableCheckBox" type="checkbox" alt="whitelist" title="whitelist" ${cell.getValue() ? 'checked' : ''}><img class=" editIcon ${cell.getRow().getData().wanted ? 'tableIcon' : 'tableIconDisabled'}" src="/icons/edit.svg" alt="edit" title="edit"><img class="deleteIcon tableIcon" src="/icons/trash-alt.svg" alt="delete" title="delete">`
}

function cellDateFormatter(cell, formatterParams) {
  if (typeof(cell.getValue()) != 'undefined') {
    return formatDate(new Date(cell.getValue() * 1000))
  } else {
    return 'session ends'
  }
}

function unwantedRowFormatter(row) {
  if (!row.getData().wanted) {
    row.getElement().classList.add('blocked')
  }
}

function initCookieTable() {
  /* inits the cookie table */
  cookieTable = new Tabulator('#cookieTable', {
    columns: [{
      title: 'Name',
      field: 'name',
      width: '20%'
    }, {
      title: 'Value',
      field: 'value',
      width: '42%',
    }, {
      title: 'Expires',
      field: 'expirationDate',
      formatter: cellDateFormatter,
      width: '20%'
    }, {
      title: '<img class="tableIcon" src="/icons/file-alt.svg" alt="whitelisted" title="whitelisted"><img id="cookieAddIcon" class="tableIcon" src="/icons/plus.svg" alt="add" title="add"><img id="cookieDeleteAllIcon" class="tableIcon" src="/icons/trash-alt.svg" alt="delete all" title="delete all">',
      field: 'whitelisted',
      formatter: actionElementsFormatter,
      cellClick: async (e, cell) => {
        try {
          e.stopPropagation()
          let classNames = e.target.className.split(' ')
          if (classNames.includes('tableCheckBox')) {
            // whitelisted checkbox clicked
            if (cell.getValue()) {
              await deleteWhitelistEntry(cell.getRow().getData().domain, cell.getRow().getData().name, 'c', null)
              // could be optimized with function that only checks that one cookie
              await handleExistingUnwantedCookies(activeTabUrl)
              await Promise.all([updateActiveTabsCounts(), updateCookieTable()])
            } else {
              await addWhitelistEntry(cell.getRow().getData().domain, cell.getRow().getData().name, 'c')
              await callRestoreUnwantedCookie(cell.getRow().getData().domain, cell.getRow().getData().name)
              await Promise.all([updateActiveTabsCounts(), updateCookieTable()])
            }
          } else if (classNames.includes('editIcon')) {
            // edit icon clicked
            if (cell.getRow().getData().wanted) {
              showView(cookieEditor)
              fillCookieEditor(cell.getRow().getData(), null)
            }
          } else if (classNames.includes('deleteIcon')) {
            // delete icon clicked
            if (cell.getRow().getData().wanted) {
              await deleteCookie(cell.getRow().getData())
              await Promise.all([updateActiveTabsCounts(), updateCookieTable()])
            } else {
              await callDeleteUnwantedCookie(cell.getRow().getData().domain, cell.getRow().getData().name, activeTabCookieStore)
              await updateCookieTable()
            }
          }
        } catch (e) {
          console.error(e)
        }
      },
      headerSort: false,
      width: '13ex'
    }, {
      title: 'wanted',
      field: 'wanted',
      visible: false // needed for sorting but should not be displayed
    }],
    rowFormatter: unwantedRowFormatter,
    height: '18ex',
    layout: 'fitColumns',
    tooltips: true,
    data: cookieList,
    initialSort: [{
      column: "name",
      dir: "asc"
    }, {
      column: "wanted",
      dir: "desc"
    }, {
      column: "whitelisted",
      dir: "desc"
    }],
    placeholder: 'none'
  })
}

function initDomStorageTable() {
  // inits the dom storage table
  domStorageTable = new Tabulator('#domStorageTable', {
    columns: [{
      title: 'Name',
      field: 'name',
      width: '20%'
    }, {
      title: 'Value',
      field: 'value',
      width: '42%'
    }, {
      title: 'Perm.',
      field: 'permanence',
      width: '20%'
    }, {
      title: '<img class="tableIcon" src="/icons/file-alt.svg" alt="whitelisted" title="whitelisted"><img id="domAddIcon" class="tableIcon" src="/icons/plus.svg" alt="add" title="add"><img id="domDeleteAllIcon" class="tableIcon" src="/icons/trash-alt.svg" alt="delete all" title="delete all">',
      field: 'whitelisted',
      formatter: actionElementsFormatter,
      cellClick: async (e, cell) => {
        try {
          e.stopPropagation()
          let classNames = e.target.className.split(' ')
          if (classNames.includes('tableCheckBox')) {
            // whitelisted checkbox clicked
            if (cell.getValue()) {
              await deleteWhitelistEntry(cell.getRow().getData().domain, cell.getRow().getData().name, 'd')
              await handleExistingUnwantedDomStorageEntriesByName(cell.getRow().getData().domain, cell.getRow().getData().name)
              await Promise.all([updateActiveTabsCounts(), updateDomStorageTable()])
            } else {
              await addWhitelistEntry(cell.getRow().getData().domain, cell.getRow().getData().name, 'd')
              await restoreUnwantedDomStorageEntriesByName(cell.getRow().getData().domain, cell.getRow().getData().name)
              await handleExistingUnwantedDomStorageEntriesByName(cell.getRow().getData().domain, cell.getRow().getData().name)
              await Promise.all([updateActiveTabsCounts(), updateDomStorageTable()])
            }
          } else if (classNames.includes('editIcon')) {
            // edit icon clicked
            if (cell.getRow().getData().wanted) {
              showView(domStorageEditor)
              fillDomStorageEditor(cell.getRow().getData(), null)
            }
          } else if (classNames.includes('deleteIcon')) {
            // delete icon clicked
            if (cell.getRow().getData().wanted) {
              await deleteDomStorageEntry(activeTabId, cell.getRow().getData())
              await Promise.all([updateActiveTabsCounts(), updateDomStorageTable()])
            } else {
              await deleteUnwantedDomStorageEntry(activeTabId, cell.getRow().getData())
              await updateDomStorageTable()
            }
          }
        } catch (e) {
          console.error(e)
        }
      },
      headerSort: false,
      width: '13ex'
    }, {
      title: 'wanted',
      field: 'wanted',
      visible: false // needed for sorting but should not be displayed
    }],
    rowFormatter: unwantedRowFormatter,
    height: '18ex',
    tooltips: true,
    data: domList,
    initialSort: [{
      column: "name",
      dir: "asc"
    }, {
      column: "wanted",
      dir: "desc"
    }, {
      column: "whitelisted",
      dir: "desc"
    }],
    placeholder: 'none'
  })
}
async function updateCookieTable() {
  // updates the cookie table data
  await fillCookieList()
  cookieTable.replaceData(cookieList)
}
async function updateDomStorageTable() {
  // updates the dom storage table data
  if (contentScriptavailable) {
    try {
      await fillDomStorageList()
    } catch (e) {
      // getting dom storage can fail if unable to inject the content script
      console.warn(e)
    }
    domStorageTable.replaceData(domList)
  }
}
async function enablePermSiteException() {
  // adds a permanent site exception
  let option = Number(slider.value - 1)
  if (option === -1) {
    // default
    await deleteSiteException(activeTabDomain, false)
  } else {
    await addSiteException(activeTabDomain, option, false)
  }
  await Promise.all([fillSiteInfo(), updateCookieTable(), updateDomStorageTable()])
}
async function fillSiteInfo() {
  // puts site specific info in ui including cookies and dom storage
  if (activeTabUrl.startsWith('http')) {
    headline.textContent = `Settings For ${activeTabDomain}`
    cookieStore.textContent = `Cookie Store ID: ${activeTabCookieStore}`
    switch (await callGetDefaultBehaviour()) {
      case 0:
        defaultIcon.src = "/icons/ban.svg"
        break
      case 1:
        defaultIcon.src = "/icons/clock.svg"
        break
      case 2:
      default:
        defaultIcon.src = "/icons/check-circle.svg"
    }
    let permSiteException, tempSiteException;
    [permSiteException, tempSiteException] = await Promise.all([getSiteException(activeTabDomain, false), getSiteException(activeTabDomain, true)])
    await depictSiteException(permSiteException, tempSiteException)
    if (firstPartyIsolationSupported) {
      firstPartyDomainArea.classList.remove('hidden')
    }
  } else {
    nonHttpInfo.classList.remove('hidden')
    mainView.classList.add('hidden')
  }

  async function depictSiteException(permSiteException, tempSiteException) {
    // deal with site exceptions
    let permHighlightOption
    if (permSiteException !== null) {
      slider.value = permSiteException + 1
      permHighlightOption = permSiteException + 1
    } else {
      slider.value = 0
      permHighlightOption = 0
    }
    if (tempSiteException !== null) {
      allowTempCheckBox.checked = true
      highlightActiveOption(4)
    } else {
      allowTempCheckBox.checked = false
      highlightActiveOption(permHighlightOption)
    }
  }
  async function highlightActiveOption(option) {
    // highlights the active option in ui
    defaultOption.classList.remove('selectedBehaviour')
    denyOption.classList.remove('selectedBehaviour')
    sessionOption.classList.remove('selectedBehaviour')
    allowOption.classList.remove('selectedBehaviour')
    allowTempLbl.classList.remove('selectedBehaviour')
    switch (option) {
      case 0:
        // default
        defaultOption.classList.add('selectedBehaviour')
        break
      case 1:
        // deny
        denyOption.classList.add('selectedBehaviour')
        break
      case 2:
        // allow session
        sessionOption.classList.add('selectedBehaviour')
        break
      case 3:
        // allow all
        allowOption.classList.add('selectedBehaviour')
        break
      case 4:
        // temporary allow all
        allowTempLbl.classList.add('selectedBehaviour')
        break
      default:
        throw Error(`Invalid behaviour: ${option}`)
    }
  }
}
async function fillCookieList() {
  // gets wanted and unwanted cookies and stores them in cookieList
  cookieList = []
  // get all the cookies
  let cookies = await getAllCookies({
    url: activeTabUrl,
    storeId: activeTabCookieStore
  })
  let promises = cookies.map(async cookie => {
    let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c')
    cookie.whitelisted = whitelisted
    cookie.wanted = true
    // add cookie to list
    cookieList.push(cookie)
  })
  let fullDomain = (new URL(activeTabUrl)).hostname
  let unwantedCookies = await callGetUnwantedCookiesForDomain(activeTabDomain, activeTabCookieStore)
  unwantedCookies.forEach(cookie => {
    // remove leading . from cookie domain for comparison
    let cookieDomain = (cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain)
    if (fullDomain === cookieDomain || (!cookie.hostOnly && fullDomain.endsWith(`${cookieDomain}`))) {
      cookie.wanted = false
      cookieList.push(cookie)
    }
  })
  await Promise.all(promises)
}
async function fillDomStorageList(retries = 0) {
  // gets wanted and unwanted dom storage and stores it in domList
  domList = []
  if (retries === connectToContentScriptMaxRetries) {
    contentScriptavailable = false
    throw Error('Failed to connect to content script.')
  }
  // get all the entries
  let response
  try {
    response = await getTabDomStorage(activeTabId)
  } catch (e) {
    console.warn(e)
    console.warn('Trying again in 50 ms')
    // [UGLY] when injected script is not ready wait some ms and try again
    await new Promise(async resolve => {
      setTimeout(resolve, connectToContentScriptRetryDelayMs)
    })
    await fillDomStorageList(retries + 1)
  }
  let storageItems = []
  // create array of entry objects first
  for (let i in response.localStorage) {
    let entry = {}
    entry.name = i
    entry.value = response.localStorage[i]
    entry.domain = (new URL(activeTabUrl)).hostname
    entry.permanence = 'permanent'
    entry.persistent = true
    storageItems.push(entry)
  }
  for (let i in response.sessionStorage) {
    let entry = {}
    entry.name = i
    entry.value = response.sessionStorage[i]
    entry.domain = (new URL(activeTabUrl)).hostname
    entry.permanence = 'temporary'
    entry.persistent = false
    storageItems.push(entry)
  }
  // add whitelist info
  let promises = storageItems.map(async storageItem => {
    let whitelisted = await getObjectWhitelistedState(storageItem.domain, storageItem.name, 'd')
    storageItem.whitelisted = whitelisted
    storageItem.wanted = true
    // add item to list
    domList.push(storageItem)
  })
  // unwanted storage
  response = await getUnwantedDomStorageEntries(activeTabId)
  domList = domList.concat(response.map(entry => {
    entry.domain = (new URL(activeTabUrl)).hostname
    entry.permanence = entry.persistent ? 'permanent' : 'temporary'
    entry.wanted = false
    return entry
  }))
  await Promise.all(promises)
}

function fillCookieEditor(cookie, domain) {
  // fills the cookie editor ui elements with the given values
  // reset error text
  cookieEditorError.textContent = ""
  let expDate, hour, minute
  if (cookie !== null) {
    // existing cookie
    cookieInEditor = cookie
    cookieDomainTextBox.value = cookie.domain
    cookieHostOnly.checked = cookie.hostOnly
    cookieNameTextBox.value = cookie.name
    cookieValueTextBox.value = cookie.value
    cookieSessionCookie.checked = cookie.session
    cookiePersistent.checked = !cookie.session
    if (cookie.session) {
      expDate = new Date()
      expDate.setDate(expDate.getDate() + 1)
    } else {
      expDate = new Date(cookie.expirationDate * 1000)
    }
    cookieDate.valueAsDate = expDate
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`
    cookieTime.value = `${hour}:${minute}`
    cookiePathTextBox.value = cookie.path
    cookieFirstPartyDomainTextBox.value = cookie.firstPartyDomain
    cookieSecure.checked = cookie.secure
    cookieHttpOnly.checked = cookie.httpOnly
    sameSiteSelect.value = cookie.sameSite
    cookieDeleteButton.disabled = false
  } else {
    // new cookie
    cookieInEditor = null
    cookieDomainTextBox.value = domain
    cookieHostOnly.checked = true
    cookieNameTextBox.value = ''
    cookieValueTextBox.value = ''
    cookieSessionCookie.checked = false
    cookiePersistent.checked = true
    expDate = new Date()
    expDate.setDate(expDate.getDate() + 1)
    cookieDate.valueAsDate = expDate
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`
    cookieTime.value = `${hour}:${minute}`
    cookiePathTextBox.value = '/'
    cookieFirstPartyDomainTextBox.value = ''
    cookieSecure.checked = false
    cookieHttpOnly.checked = false
    sameSiteSelect.value = 'lax'
    cookieDeleteButton.disabled = true
  }
}

function fillDomStorageEditor(entry, domain) {
  // fills the dom storage editor ui elements with the given values
  // reset error text
  domStorageEditorError.textContent = ""
  if (entry !== null) {
    // existing entry
    domStorageEntryInEditor = entry
    domStorageDomainTextBox.value = entry.domain
    domStorageNameTextBox.value = entry.name
    domStorageValueTextBox.value = entry.value
    if (entry.permanence === 'permanent') {
      domStorageTemporary.checked = false
      domStoragePermanent.checked = true
    } else {
      domStorageTemporary.checked = true
      domStoragePermanent.checked = false
    }
    domStorageDeleteButton.disabled = false
  } else {
    // new entry
    domStorageEntryInEditor = null
    domStorageDomainTextBox.value = domain
    domStorageNameTextBox.value = ''
    domStorageValueTextBox.value = ''
    domStorageTemporary.checked = false
    domStoragePermanent.checked = true
    domStorageDeleteButton.disabled = true
  }
}

function showView(view) {
  // shows the given view area (div) and hides the other ones
  const viewAreas = [mainView, cookieEditor, domStorageEditor]
  viewAreas.forEach(item => {
    item.classList.add('hidden')
  })
  view.classList.remove('hidden')
}

function toggleAdvancedProperties() {
  // toggles the advanced property area visibility in cookie editor
  let section = advancedCookieProperties
  section.classList.toggle('hidden')
  if (window.getComputedStyle(section).getPropertyValue('display') === 'none') {
    cookieAdvancedToggle.textContent = '[show advanced]'
  } else {
    cookieAdvancedToggle.textContent = '[hide advanced]'
  }
}

function getBehaviourString(behaviour) {
  // returns the correct string for each behaviour number
  switch (behaviour) {
    case 0:
      // deny
      return 'deny all cookies'
      break
    case 1:
      // allow session
      return 'allow session cookies only'
      break
    case 2:
      // allow all
      return 'allow all cookies'
      break
    default:
      // invalid
      return 'invalid behaviour'
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  firstPartyDomainArea = document.getElementById('firstPartyDomainArea')
  defaultIcon = document.getElementById('defaultIcon')
  defaultOption = document.getElementById('defaultOption')
  denyOption = document.getElementById('denyOption')
  sessionOption = document.getElementById('sessionOption')
  allowOption = document.getElementById('allowOption')
  slider = document.getElementById('slider')
  allowTempCheckBox = document.getElementById('allowTempCheckBox')
  allowTempLbl = document.getElementById('allowTempLbl')
  useSiteBehaviourArea = document.getElementById('useSiteBehaviourArea')
  headline = document.getElementById('headline')
  cookieStore = document.getElementById('cookieStore')
  nonHttpInfo = document.getElementById('nonHttpInfo')
  mainView = document.getElementById('mainView')
  cookieEditor = document.getElementById('cookieEditor')
  domStorageEditor = document.getElementById('domStorageEditor')
  cookieDomainTextBox = document.getElementById('cookieDomainTextBox')
  cookieHostOnly = document.getElementById('cookieHostOnly')
  cookieNameTextBox = document.getElementById('cookieNameTextBox')
  cookieValueTextBox = document.getElementById('cookieValueTextBox')
  cookieSessionCookie = document.getElementById('cookieSessionCookie')
  cookiePersistent = document.getElementById('cookiePersistent')
  cookieDate = document.getElementById('cookieDate')
  cookieTime = document.getElementById('cookieTime')
  cookiePathTextBox = document.getElementById('cookiePathTextBox')
  cookieFirstPartyDomainTextBox = document.getElementById('cookieFirstPartyDomainTextBox')
  cookieSecure = document.getElementById('cookieSecure')
  cookieHttpOnly = document.getElementById('cookieHttpOnly')
  sameSiteSelect = document.getElementById('sameSiteSelect')
  cookieDeleteButton = document.getElementById('cookieDeleteButton')
  domStorageDomainTextBox = document.getElementById('domStorageDomainTextBox')
  domStorageNameTextBox = document.getElementById('domStorageNameTextBox')
  domStorageValueTextBox = document.getElementById('domStorageValueTextBox')
  domStorageTemporary = document.getElementById('domStorageTemporary')
  domStoragePermanent = document.getElementById('domStoragePermanent')
  domStorageDeleteButton = document.getElementById('domStorageDeleteButton')
  advancedCookieProperties = document.getElementById('advancedCookieProperties')
  cookieAdvancedToggle = document.getElementById('cookieAdvancedToggle')
  cookieCancelButton = document.getElementById('cookieCancelButton')
  domStorageCancelButton = document.getElementById('domStorageCancelButton')
  cookieSaveButton = document.getElementById('cookieSaveButton')
  cookieEditorError = document.getElementById('cookieEditorError')
  domStorageEditorError = document.getElementById('domStorageEditorError')
  domStorageSaveButton = document.getElementById('domStorageSaveButton')
  cookieAddIcon = document.getElementById('cookieAddIcon')
  domAddIcon = document.getElementById('domAddIcon')
  cookieDeleteAllIcon = document.getElementById('cookieDeleteAllIcon')
  domDeleteAllIcon = document.getElementById('domDeleteAllIcon')
  optionsDropdown = document.getElementById('optionsDropdown')
  optionsImage = document.getElementById('optionsImage')
  dropdownItemSettings = document.getElementById('dropdownItemSettings')
  dropdownItemClearTemp = document.getElementById('dropdownItemClearTemp')
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  slider.addEventListener('change', async _ => {
    try {
      await enablePermSiteException()
    } catch (e) {
      console.error(e)
    }
  })
  cookieCancelButton.addEventListener('click', async _ => {
    showView(mainView)
  })
  domStorageCancelButton.addEventListener('click', async _ => {
    showView(mainView)
  })
  cookieDeleteButton.addEventListener('click', async _ => {
    try {
      await deleteCookie(cookieInEditor)
      await Promise.all([updateCookieTable(), updateActiveTabsCounts()])
      showView(mainView)
    } catch (e) {
      console.error(e)
    }
  })
  domStorageDeleteButton.addEventListener('click', async _ => {
    try {
      await deleteDomStorageEntry(activeTabId, domStorageEntryInEditor)
      await Promise.all([updateDomStorageTable(), updateActiveTabsCounts()])
      showView(mainView)
    } catch (e) {
      console.error(e)
    }
  })
  cookieSaveButton.addEventListener('click', async _ => {
    try {
      try {
        await addCookie(cookieNameTextBox.value, cookieValueTextBox.value, cookieDomainTextBox.value, cookiePathTextBox.value, cookieSessionCookie.checked, cookieDate.valueAsDate, cookieTime.valueAsDate, cookieHostOnly.checked, cookieSecure.checked, cookieHttpOnly.checked, activeTabCookieStore, cookieFirstPartyDomainTextBox.value, sameSiteSelect.value, cookieInEditor)
      } catch (e) {
        cookieEditorError.textContent = e.message
        return
      }
      // return to overview
      await Promise.all([updateCookieTable(), updateActiveTabsCounts()])
      showView(mainView)
    } catch (e) {
      console.error(e)
    }
  })
  domStorageSaveButton.addEventListener('click', async _ => {
    try {
      try {
        await addDomStorageEntry(activeTabId, domStoragePermanent.checked, domStorageNameTextBox.value, domStorageValueTextBox.value, domStorageEntryInEditor)
      } catch (e) {
        domStorageEditorError.textContent = e.message
        return
      }
      // return to overview
      await Promise.all([updateDomStorageTable(), updateActiveTabsCounts()])
      showView(mainView)
    } catch (e) {
      console.error(e)
    }
  })
  cookieAddIcon.addEventListener('click', _ => {
    fillCookieEditor(null, (new URL(activeTabUrl)).hostname)
    showView(cookieEditor)
  })
  domAddIcon.addEventListener('click', _ => {
    fillDomStorageEditor(null, (new URL(activeTabUrl)).hostname)
    showView(domStorageEditor)
  })
  cookieAdvancedToggle.addEventListener('click', _ => {
    toggleAdvancedProperties()
  })
  defaultOption.addEventListener('click', async _ => {
    try {
      slider.value = 0
      await enablePermSiteException()
    } catch (e) {
      console.error(e)
    }
  })
  denyOption.addEventListener('click', async _ => {
    try {
      slider.value = 1
      await enablePermSiteException()
    } catch (e) {
      console.error(e)
    }
  })
  sessionOption.addEventListener('click', async _ => {
    try {
      slider.value = 2
      await enablePermSiteException()
    } catch (e) {
      console.error(e)
    }
  })
  allowOption.addEventListener('click', async _ => {
    try {
      slider.value = 3
      await enablePermSiteException()
    } catch (e) {
      console.error(e)
    }
  })
  allowTempCheckBox.addEventListener('change', async _ => {
    try {
      if (allowTempCheckBox.checked) {
        await addSiteException(activeTabDomain, 2, true)
      } else {
        await deleteSiteException(activeTabDomain, true)
      }
      await Promise.all([fillSiteInfo(), updateCookieTable(), updateDomStorageTable()])
    } catch (e) {
      console.error(e)
    }
  })
  cookieDeleteAllIcon.addEventListener('click', async _ => {
    try {
      await deleteAllCookies(activeTabUrl, activeTabCookieStore)
      await Promise.all([updateActiveTabsCounts(), updateCookieTable()])
    } catch (e) {
      console.error(e)
    }
  })
  domDeleteAllIcon.addEventListener('click', async _ => {
    try {
      try {
        await clearTabDomStorage(activeTabId)
      } catch (e) {
        console.warn(e)
      }
      await Promise.all([updateActiveTabsCounts(), updateDomStorageTable()])
    } catch (e) {
      console.error(e)
    }
  })
  optionsImage.addEventListener('click', _ => {
    optionsImage.classList.toggle('active')
    optionsDropdown.classList.toggle('hidden')
  })
  window.addEventListener('click', e => {
    if (!e.target.matches('#optionsImage') && !e.target.matches('#optionsImagePath')) {
      if (window.getComputedStyle(optionsDropdown).getPropertyValue('display') === 'block') {
        optionsDropdown.classList.add('hidden')
        optionsImage.classList.remove('active')
      }
    }
  })
  dropdownItemSettings.addEventListener('click', async _ => {
    try {
      await browser.tabs.create({
        url: '/options.html'
      })
    } catch (e) {
      console.error(e)
    }
  })
  dropdownItemClearTemp.addEventListener('click', async _ => {
    try {
      await clearTempSiteExceptions()
      await Promise.all([updateDomStorageTable(), updateActiveTabsCounts(), fillSiteInfo()])
      showView(mainView)
    } catch (e) {
      console.error(e)
    }
  })
  // info icons
  let infoIcons = document.getElementsByClassName('infoIcon')
  for (let i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', async _ => {
      try {
        e.stopPropagation()
        await sendInfoMessage(e.target.title)
      } catch (e) {
        console.error(e)
      }
    })
  }
}