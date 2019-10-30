'use strict';
// selected cookie for the cookie editor
let cookieInEditor;
// ui elements
let saveButton, firstPartyDomainArea, cookieTable, cookieEditorError, domainTextBox, cookieHostOnly, nameTextBox, valueTextBox, sessionCookie, persistentCookie, date, time, pathTextBox, cookieSecure, cookieHttpOnly, deleteButton, firstPartyDomainTextBox, clearButton, cookieStoreSelect;
let entryList = [];
// table stuff
let table;
let selectedAll = false;
document.addEventListener('DOMContentLoaded', async function() {
  assignUiElements();
  addEventlisteners();
  fillCookieEditor(null);
  if (firstPartyIsolationSupported) {
    firstPartyDomainArea.classList.remove('hidden');
  }
  try {
    await fillCookieStores();
    await fillCookieList();
    initTable();
  } catch (e) {
    console.error(e);
  }
});

function initTable() {
  table = new Tabulator('#table', {
    columns: [{
      formatter: 'rowSelection',
      titleFormatter: 'rowSelection',
      align: 'center',
      headerSort: false,
      width: '5%'
    }, {
      title: 'Domain',
      field: 'domain',
      headerFilter: 'input',
      width: '15%'
    }, {
      title: 'Name',
      field: 'name',
      headerFilter: 'input',
      width: '15%'
    }, {
      title: 'Value',
      field: 'value',
      headerFilter: 'input',
      width: '20%'
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
      width: '10%'
    }, {
      title: 'Host Only',
      field: 'hostOnly',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '5%'
    }, {
      title: 'Secure',
      field: 'secure',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '5%'
    }, {
      title: 'HTTP Only',
      field: 'httpOnly',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '5%'
    }, {
      title: 'Whitelisted',
      field: 'whitelisted',
      formatter: "tickCross",
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
      },
      width: '5%'
    }, {
      title: 'Edit',
      formatter: editIconFormatter,
      align: 'center',
      cellClick: function(e, cell) {
        e.stopPropagation();
        fillCookieEditor(cell.getRow().getData());
      },
      headerSort: false,
      width: '5%'
    }],
    selectable: true,
    layout: 'fitDataFill',
    pagination: 'local',
    selectableRangeMode: 'click',
    paginationSize: 15,
    paginationSizeSelector: true,
    reactiveData: true,
    data: entryList,
    columnResized: function(row) {
      table.redraw();
    },
    rowSelectionChanged: function(data, rows) {
      if (data.length === entryList.length) {
        selectedAll = true;
      } else {
        selectedAll = false;
      }
    }
  });

  function editIconFormatter(cell, formatterParams) {
    return '<img src="/icons/edit.svg" alt="edit" style="height:1.5ch">';
  };

  function cellDateFormatter(cell, formatterParams) {
    return stringDateFormatter(cell.getValue(), formatterParams)
  }

  function stringDateFormatter(value, formatterParams) {
    if (typeof(value) != 'undefined') {
      return formatDate(new Date(value * 1000));
    } else {
      return 'session ends';
    }
  }

  function dateHeaderFilter(headerValue, rowValue, rowData, filterParams) {
    let cellString = stringDateFormatter(rowValue);
    return cellString.includes(headerValue);
  }
}
async function fillCookieStores() {
  return new Promise(async function(resolve, reject) {
    try {
      // gets all the cookie stores and puts them in the select ui element
      let cookieStores = await browser.cookies.getAllCookieStores();
      for (let store of cookieStores) {
        let option = document.createElement('option');
        option.text = store.id;
        cookieStoreSelect.add(option);
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function fillCookieList() {
  // filters cookies and stores them in entryList
  return new Promise(async function(resolve, reject) {
    try {
      entryList = [];
      // get all the cookies
      let cookies = await getAllCookies({
        storeId: cookieStoreSelect.value
      });
      // filter the cookies
      let promises = cookies.map(async function(cookie) {
        try {
          let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c');
          cookie.whitelisted = whitelisted;
          // add cookie to list
          entryList.push(cookie);
        } catch (e) {
          return reject(e);
        }
      });
      await Promise.all(promises);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function deleteSelectedCookies() {
  // deletes all selected entries
  return new Promise(async function(resolve, reject) {
    try {
      let selectedData = table.getSelectedData();
      if (selectedData.length > 10) {
        if (!confirm(`Are you sure you want to delete ${selectedData.length} cookies?`)) {
          return resolve();
        }
      }
      let promises = selectedData.map(function(entry) {
        return deleteCookie(entry);
      });
      await Promise.all(promises);
      await fillCookieList();
      table.setData(entryList);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function fillCookieEditor(cookie) {
  // fills the cookie editor ui elements with the given values
  // reset error text
  cookieEditorError.textContent = '';
  let expDate, hour, minute;
  if (cookie !== null) {
    // existing cookie
    saveButton.textContent = 'Save';
    cookieInEditor = cookie;
    domainTextBox.value = cookie.domain;
    cookieHostOnly.checked = cookie.hostOnly;
    nameTextBox.value = cookie.name;
    valueTextBox.value = cookie.value;
    sessionCookie.checked = cookie.session;
    persistentCookie.checked = !cookie.session;
    if (cookie.session) {
      expDate = new Date();
      expDate.setDate(expDate.getDate() + 1);
    } else {
      expDate = new Date(cookie.expirationDate * 1000);
    }
    date.valueAsDate = expDate;
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`;
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`;
    time.value = `${hour}:${minute}`;
    pathTextBox.value = cookie.path;
    cookieSecure.checked = cookie.secure;
    cookieHttpOnly.checked = cookie.httpOnly;
    firstPartyDomainTextBox.value = cookie.firstPartyDomain;
  } else {
    // new cookie
    saveButton.textContent = 'Add';
    cookieInEditor = null;
    domainTextBox.value = '';
    cookieHostOnly.checked = true;
    nameTextBox.value = '';
    valueTextBox.value = '';
    sessionCookie.checked = false;
    persistentCookie.checked = true;
    expDate = new Date();
    expDate.setDate(expDate.getDate() + 1);
    date.valueAsDate = expDate;
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`;
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`;
    time.value = `${hour}:${minute}`;
    pathTextBox.value = '/';
    cookieSecure.checked = false;
    cookieHttpOnly.checked = false;
    firstPartyDomainTextBox.value = '';
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  saveButton = document.getElementById('saveButton');
  firstPartyDomainArea = document.getElementById('firstPartyDomainArea');
  cookieTable = document.getElementById('cookieTable');
  cookieEditorError = document.getElementById('cookieEditorError');
  domainTextBox = document.getElementById('domainTextBox');
  cookieHostOnly = document.getElementById('cookieHostOnly');
  nameTextBox = document.getElementById('nameTextBox');
  valueTextBox = document.getElementById('valueTextBox');
  sessionCookie = document.getElementById('sessionCookie');
  persistentCookie = document.getElementById('persistentCookie');
  date = document.getElementById('date');
  time = document.getElementById('time');
  pathTextBox = document.getElementById('pathTextBox');
  cookieSecure = document.getElementById('cookieSecure');
  cookieHttpOnly = document.getElementById('cookieHttpOnly');
  deleteButton = document.getElementById('deleteButton');
  firstPartyDomainTextBox = document.getElementById('firstPartyDomainTextBox');
  clearButton = document.getElementById('clearButton');
  cookieStoreSelect = document.getElementById('cookieStoreSelect');
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  // info icons
  let infoIcons = document.getElementsByClassName('infoIcon');
  for (let i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', async function(e) {
      await sendInfoMessage(e.target.title);
    });
  }
  // cookie Store select
  cookieStoreSelect.addEventListener('change', async function(e) {
    try {
      await fillCookieList();
      fillCookieEditor(null);
    } catch (e) {
      console.error(e);
    }
  });
  // delete button
  deleteButton.addEventListener('click', async function(e) {
    try {
      await deleteSelectedCookies();
    } catch (e) {
      console.error(e);
    }
  });
  // save button
  saveButton.addEventListener('click', async function() {
    try {
      await addCookie(nameTextBox.value, valueTextBox.value, domainTextBox.value, pathTextBox.value, sessionCookie.checked, date.valueAsDate, time.valueAsDate, cookieHostOnly.checked, cookieSecure.checked, cookieHttpOnly.checked, cookieStoreSelect.value, firstPartyDomainTextBox.value, cookieInEditor);
      await fillCookieList();
      table.setData(entryList);
      fillCookieEditor(null);
    } catch (e) {
      cookieEditorError.textContent = `${e.message}\r\n\r\n`;
    }
  });
  // clear button
  clearButton.addEventListener('click', function() {
    fillCookieEditor(null);
  });
}