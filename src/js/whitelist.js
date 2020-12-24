'use strict'
// selected entry for the entry editor
let entryInEditor = null
// ui elements
let http, domainTextBox, nameTextBox, entryEditorError, dom, infoIcons, deleteButton, saveButton, clearButton
let whitelistTypeDict = {
  c: 'HTTP Cookie',
  d: 'Web Storage'
}
let entryList = []
// table stuff
let table
let selectedAll = false
document.addEventListener('DOMContentLoaded', async _ => {
  try {
    assignUiElements()
    addEventlisteners()
    fillEntryEditor(null)
    await fillWhitelist()
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
      width: '30%'
    }, {
      title: 'Name',
      field: 'name',
      formatter: 'textarea',
      headerFilter: 'input'
    }, {
      title: 'Type',
      field: 'type',
      formatter: cellTypeFormatter,
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
        listItemFormatter: stringTypeFormatter
      },
      width: '15%'
    }, {
      title: 'Edit',
      formatter: editIconFormatter,
      hozAlign: 'center',
      cellClick: (e, cell) => {
        e.stopPropagation()
        fillEntryEditor(cell.getRow().getData())
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

  function editIconFormatter(cell, formatterParams) {
    return '<img src="/icons/edit.svg" alt="edit" style="height:1.5ch">'
  }

  function stringTypeFormatter(value, formatterParams) {
    return whitelistTypeDict[value]
  }

  function cellTypeFormatter(cell, formatterParams) {
    return stringTypeFormatter(cell.getValue(), formatterParams)
  }
}

async function updateTable() {
  // updates the table data
  await fillWhitelist()
  table.replaceData(entryList)
}

async function fillWhitelist() {
  // filters whitelist entries and stores them in entryList
  entryList = []
  // get all the entries
  let results = await browser.storage.local.get()
  // create array of all whitelist entries received from storage (the key contains all the information)
  for (let result in results) {
    if (result.startsWith('wl|')) {
      let resultContent = result.split('|')
      let resultObj = {}
      resultObj.domain = decodeURI(resultContent[1])
      resultObj.name = decodeURI(resultContent[2])
      resultObj.type = resultContent[3]
      entryList.push(resultObj)
    }
  }
}
async function deleteSelectedEntries() {
  // deletes all selected entries
  let selectedData = table.getSelectedData()
  if (selectedData.length > 10) {
    if (!confirm(`Are you sure you want to delete ${selectedData.length} entries?`)) {
      return
    }
  }
  let promises = selectedData.map(entry => {
    return deleteWhitelistEntry(entry.domain, entry.name, entry.type).then(async _ => {
      if (entry.type === 'c') {
        await deleteAllTabsExistingUnwantedCookies()
      } else {
        await handleExistingUnwantedDomStorageEntriesByName(entry.domain, entry.name)
      }
    })
  })
  await Promise.all(promises)
  await Promise.all([updateActiveTabsCounts(), updateTable()])
}
async function saveEntry() {
  // saves the data from the entry editor
  let type = (http.checked ? 'c' : 'd')
  try {
    await addWhitelistEntry(domainTextBox.value, nameTextBox.value, type, entryInEditor)
  } catch (e) {
    entryEditorError.textContent = `${e.message}\r\n\r\n`
    return
  }
  if (type === 'c') {
    await bgPage.restoreUnwantedCookie(domainTextBox.value, nameTextBox.value)
  } else {
    await restoreUnwantedDomStorageEntriesByName(domainTextBox.value, nameTextBox.value)
    await handleExistingUnwantedDomStorageEntriesByName(domainTextBox.value, nameTextBox.value)
  }
  await Promise.all([updateActiveTabsCounts(), updateTable()])
  fillEntryEditor(null)
}

function fillEntryEditor(entry) {
  // fills the entry editor ui elements with the given values
  // reset error text
  entryEditorError.textContent = ''
  if (entry !== null) {
    // existing entry
    saveButton.textContent = 'Save'
    entryInEditor = entry
    if (entry.type === 'c') {
      http.checked = true
    } else {
      dom.checked = true
    }
    domainTextBox.value = entry.domain
    nameTextBox.value = entry.name
  } else {
    // new entry
    saveButton.textContent = 'Add'
    entryInEditor = null
    http.checked = true
    dom.checked = false
    domainTextBox.value = ''
    nameTextBox.value = ''
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  http = document.getElementById('http')
  domainTextBox = document.getElementById('domainTextBox')
  nameTextBox = document.getElementById('nameTextBox')
  entryEditorError = document.getElementById('entryEditorError')
  dom = document.getElementById('dom')
  infoIcons = document.getElementsByClassName('infoIcon')
  deleteButton = document.getElementById('deleteButton')
  saveButton = document.getElementById('saveButton')
  clearButton = document.getElementById('clearButton')
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  addInfoIconEventListeners()
  // delete button
  deleteButton.addEventListener('click', _e => {
    deleteSelectedEntries()
  })
  // save button
  saveButton.addEventListener('click', async _e => {
    try {
      await saveEntry()
    } catch (e) {
      console.error(e)
    }
  })
  // clear button
  clearButton.addEventListener('click', _e => {
    fillEntryEditor(null)
  })
}