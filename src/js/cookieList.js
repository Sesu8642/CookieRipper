'use strict'
// selected cookie for the cookie editor
let cookieInEditor
// ui elements
let saveButton, firstPartyDomainArea, cookieTable, tableColumnSelectionArea, cookieEditorError, cookieEditorWarning, domainTextBox, cookieHostOnly, nameTextBox, valueTextBox, sessionCookie, persistentCookie, date, time, pathTextBox, cookieSecure, cookieHttpOnly, sameSiteSelect, deleteButton, firstPartyDomainTextBox, clearButton, cookieStoreSelect
let entryList = []
// table stuff
let table
let selectedAll = false
document.addEventListener('DOMContentLoaded', async _ => {
  assignUiElements()
  addEventlisteners()
  fillCookieEditor(null)
  if (firstPartyIsolationSupported) {
    firstPartyDomainArea.classList.remove('hidden')
  }
  try {
    await fillCookieStores()
    await fillCookieList()
    initTable()
  } catch (e) {
    console.error(e)
  }
})

function initTable() {
  table = new Tabulator('#table', {
    columns: [{
      formatter: 'rowSelection',
      titleFormatter: 'rowSelection',
      titleFormatterParams: {
        rowRange: "active"
      },
      hozAlign: 'center',
      headerSort: false,
      width: '0'
    }, {
      title: 'Domain',
      field: 'domain',
      headerFilter: 'input',
      formatter: 'textarea',
      width: '15%'
    }, {
      title: 'First Party Domain',
      field: 'firstPartyDomain',
      headerFilter: 'input',
      formatter: 'textarea',
      visible: firstPartyIsolationSupported,
      width: '10%'
    }, {
      title: 'Name',
      field: 'name',
      headerFilter: 'input',
      formatter: 'textarea',
      width: '10%'
    }, {
      title: 'Value',
      field: 'value',
      headerFilter: 'input',
      formatter: 'textarea'
    }, {
      title: 'Keep Until',
      field: 'expirationDate',
      formatter: cellDateFormatter,
      headerFilter: 'input',
      headerFilterFunc: dateHeaderFilter,
      headerFilterParams: {
        values: true,
        listItemFormatter: stringDateFormatter
      },
      width: '10%'
    }, {
      title: 'Path',
      field: 'path',
      headerFilter: 'input',
      formatter: 'textarea',
      width: '10%'
    }, {
      title: 'Same Site Status',
      field: 'sameSite',
      headerFilter: 'input',
      formatter: 'textarea',
      width: '10%'
    }, {
      title: 'Host Only',
      field: 'hostOnly',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '3%'
    }, {
      title: 'Secure',
      field: 'secure',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '3%'
    }, {
      title: 'HTTP Only',
      field: 'httpOnly',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '3%'
    }, {
      title: 'Whitelisted',
      field: 'whitelisted',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '3%'
    }, {
      title: 'Edit',
      formatter: editIconFormatter,
      hozAlign: 'center',
      cellClick: (e, cell) => {
        e.stopPropagation()
        fillCookieEditor(cell.getRow().getData())
      },
      headerSort: false,
      width: '3%'
    }],
    groupBy: data => getRuleRelevantPartOfDomain(data.domain),
    groupToggleElement: "header",
    selectable: true,
    layout: 'fitColumns',
    pagination: 'local',
    selectableRangeMode: 'click',
    paginationSize: 15,
    paginationSizeSelector: true,
    reactiveData: true,
    data: entryList,
    initialSort: [{
      column: "name",
      dir: "asc"
    }, {
      column: "domain",
      dir: "asc"
    }],
    columnResized: row => {
      table.redraw()
    },
    rowSelectionChanged: (data, rows) => {
      if (data.length === entryList.length) {
        selectedAll = true
      } else {
        selectedAll = false
      }
    }
  })
  table.getColumnDefinitions().forEach(definition => {
    if (!definition.title || !definition.field || definition.visible === false) {
      return
    }
    let checkbox = document.createElement('input')
    checkbox.type = "checkbox"
    checkbox.id = `${definition.title}ColumnCheckBox`
    checkbox.checked = true
    checkbox.tabulatorField = definition.field
    checkbox.addEventListener('change', e => {
      e.stopPropagation()
      table.toggleColumn(checkbox.tabulatorField)
    })

    let label = document.createElement('label')
    label.htmlFor = checkbox.id
    label.appendChild(document.createTextNode(definition.title))

    tableColumnSelectionArea.appendChild(checkbox)
    tableColumnSelectionArea.appendChild(label)
  })

  function editIconFormatter(cell, formatterParams) {
    return '<img src="/icons/edit.svg" alt="edit" style="height:1.5ch">'
  }

  function cellDateFormatter(cell, formatterParams) {
    return stringDateFormatter(cell.getValue(), formatterParams)
  }

  function stringDateFormatter(value, formatterParams) {
    if (typeof(value) != 'undefined') {
      return formatDate(new Date(value * 1000))
    } else {
      return 'session ends'
    }
  }

  function dateHeaderFilter(headerValue, rowValue, rowData, filterParams) {
    let cellString = stringDateFormatter(rowValue)
    return cellString.includes(headerValue)
  }
}

async function updateTable() {
  // updates the table data
  await fillCookieList()
  table.replaceData(entryList)
}

async function fillCookieStores() {
  // gets all the cookie stores and puts them in the select ui element
  let cookieStores = await browser.cookies.getAllCookieStores()
  for (let store of cookieStores) {
    let option = document.createElement('option')
    option.text = store.id
    cookieStoreSelect.add(option)
  }
}
async function fillCookieList() {
  // filters cookies and stores them in entryList
  entryList = []
  // get all the cookies
  let cookies = await getAllCookies({
    storeId: cookieStoreSelect.value
  })
  // filter the cookies
  let promises = cookies.map(async cookie => {
    let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c')
    cookie.whitelisted = whitelisted
    // add cookie to list
    entryList.push(cookie)
  })
  await Promise.all(promises)
}
async function deleteSelectedCookies() {
  // deletes all selected entries
  let selectedData = table.getSelectedData()
  if (selectedData.length > 10) {
    if (!confirm(`Are you sure you want to delete ${selectedData.length} cookies?`)) {
      return
    }
  }
  let promises = selectedData.map(entry => {
    return deleteCookie(entry)
  })
  await Promise.all(promises)
  await updateTable()
}

async function fillCookieEditor(cookie) {
  // fills the cookie editor ui elements with the given values
  // reset error and warning text
  cookieEditorError.textContent = ''
  let expDate, hour, minute
  if (cookie !== null) {
    // existing cookie
    saveButton.textContent = 'Save'
    cookieInEditor = cookie
    domainTextBox.value = cookie.domain
    cookieHostOnly.checked = cookie.hostOnly
    nameTextBox.value = cookie.name
    valueTextBox.value = cookie.value
    sessionCookie.checked = cookie.session
    persistentCookie.checked = !cookie.session
    if (cookie.session) {
      expDate = new Date()
      expDate.setDate(expDate.getDate() + 1)
    } else {
      expDate = new Date(cookie.expirationDate * 1000)
    }
    date.valueAsDate = expDate
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`
    time.value = `${hour}:${minute}`
    pathTextBox.value = cookie.path
    cookieSecure.checked = cookie.secure
    cookieHttpOnly.checked = cookie.httpOnly
    firstPartyDomainTextBox.value = cookie.firstPartyDomain
    sameSiteSelect.value = cookie.sameSite
    await checkForUnwantedCookieAndDisplayWarning()
  } else {
    // new cookie
    saveButton.textContent = 'Add'
    cookieInEditor = null
    domainTextBox.value = ''
    cookieHostOnly.checked = true
    nameTextBox.value = ''
    valueTextBox.value = ''
    sessionCookie.checked = false
    persistentCookie.checked = true
    expDate = new Date()
    expDate.setDate(expDate.getDate() + 1)
    date.valueAsDate = expDate
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`
    time.value = `${hour}:${minute}`
    pathTextBox.value = '/'
    cookieSecure.checked = false
    cookieHttpOnly.checked = false
    firstPartyDomainTextBox.value = ''
    sameSiteSelect.value = 'lax'
    await checkForUnwantedCookieAndDisplayWarning()
  }
}

async function checkForUnwantedCookieAndDisplayWarning() {
  cookieEditorWarning.textContent = ''
  if (domainTextBox.value === '') {
    return
  }
  let allowedState = await getCookieAllowedState({
    domain: domainTextBox.value,
    name: nameTextBox.value,
    session: sessionCookie.checked
  });
  switch (allowedState) {
    case 'd':
      cookieEditorWarning.textContent = `Warning: this cookie is unwanted and will be deleted when you click save.\r\n\r\n`
      break
    case 'c':
      cookieEditorWarning.textContent = `Warning: this cookie is unwanted and will be converted to a session cookie when you click save.\r\n\r\n`
      break
    default:
      // no action needed to keep the cookie as is
      break
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  saveButton = document.getElementById('saveButton')
  firstPartyDomainArea = document.getElementById('firstPartyDomainArea')
  cookieTable = document.getElementById('cookieTable')
  cookieEditorWarning = document.getElementById('cookieEditorWarning')
  cookieEditorError = document.getElementById('cookieEditorError')
  domainTextBox = document.getElementById('domainTextBox')
  cookieHostOnly = document.getElementById('cookieHostOnly')
  nameTextBox = document.getElementById('nameTextBox')
  valueTextBox = document.getElementById('valueTextBox')
  sessionCookie = document.getElementById('sessionCookie')
  persistentCookie = document.getElementById('persistentCookie')
  date = document.getElementById('date')
  time = document.getElementById('time')
  pathTextBox = document.getElementById('pathTextBox')
  cookieSecure = document.getElementById('cookieSecure')
  cookieHttpOnly = document.getElementById('cookieHttpOnly')
  sameSiteSelect = document.getElementById('sameSiteSelect')
  deleteButton = document.getElementById('deleteButton')
  firstPartyDomainTextBox = document.getElementById('firstPartyDomainTextBox')
  clearButton = document.getElementById('clearButton')
  cookieStoreSelect = document.getElementById('cookieStoreSelect')
  tableColumnSelectionArea = document.getElementById('tableColumnSelectionArea')
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  // info icons
  let infoIcons = document.getElementsByClassName('infoIcon')
  for (let i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', async e => {
      await sendInfoMessage(e.target.title)
    })
  }
  // cookie Store select
  cookieStoreSelect.addEventListener('change', async e => {
    try {
      await Promise.all([fillCookieList(), fillCookieEditor(null)])
    } catch (e) {
      console.error(e)
    }
  })
  // delete button
  deleteButton.addEventListener('click', async e => {
    try {
      await deleteSelectedCookies()
    } catch (e) {
      console.error(e)
    }
  })
  // save button
  saveButton.addEventListener('click', async e => {
    try {
      try {
        await addCookie(nameTextBox.value, valueTextBox.value, domainTextBox.value, pathTextBox.value, sessionCookie.checked, date.valueAsDate, time.valueAsDate, cookieHostOnly.checked, cookieSecure.checked, cookieHttpOnly.checked, cookieStoreSelect.value, firstPartyDomainTextBox.value, sameSiteSelect.value, cookieInEditor)
      } catch (e) {
        cookieEditorError.textContent = `${e.message}\r\n\r\n`
        return
      }
      await Promise.all([updateTable(), updateActiveTabsCounts(), fillCookieEditor(null)])
    } catch (e) {
      console.error(e)
    }
  })
  // clear button
  clearButton.addEventListener('click', async _ => {
    await fillCookieEditor(null)
  })
  // triggers for cookie warning
  domainTextBox.addEventListener('input', checkForUnwantedCookieAndDisplayWarning)
  nameTextBox.addEventListener('input', checkForUnwantedCookieAndDisplayWarning)
  sessionCookie.addEventListener('change', checkForUnwantedCookieAndDisplayWarning)
}