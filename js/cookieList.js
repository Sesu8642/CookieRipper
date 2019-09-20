'use strict';
// selected cookie for the cookie editor
let cookieInEditor;
// ui elements
let filterDomain, filterName, filterValue, filterDate, filterPath, filterHostOnly, filterSecure, filterHttpOnly, filterWhitelist, saveButton, firstPartyDomainArea, cookieTable, selectAllCheckBox, selectCheckBoxes, cookieEditorError, domainTextBox, cookieHostOnly, nameTextBox, valueTextBox, sessionCookie, persistentCookie, date, time, pathTextBox, cookieSecure, cookieHttpOnly, selectAll, selectAllCheckBoxTd, deleteButton, firstPartyDomainTextBox, clearButton, pageSpinner, cookieStoreSelect;
const maxRows = 25;
let entryList = [];
document.addEventListener('DOMContentLoaded', async function() {
  assignUiElements();
  addEventlisteners();
  fillCookieEditor(null);
  try {
    await fillCookieStores();
    await fillCookieList();
    await buildTableBody();
  } catch (e) {
    console.error(e);
  }
  if (firstPartyIsolationSupported) {
    firstPartyDomainArea.classList.remove('hidden');
  }
});
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
          if ((filterDomain.value == '' || cookie.domain.toLowerCase().includes(filterDomain.value.toLowerCase())) && (filterName.value == '' || cookie.name.toLowerCase().includes(filterName.value.toLowerCase())) && (filterValue.value == '' || cookie.value.toLowerCase().includes(filterValue.value.toLowerCase())) && (filterDate.value == '' || (`${new Date(cookie.expirationDate * 1000)}`).includes(filterDate.value)) && (filterPath.value == '' || cookie.path.toLowerCase().includes(filterPath.value.toLowerCase())) && (filterHostOnly.value == '' || `${cookie.hostOnly}` == filterHostOnly.value) && (filterSecure.value == '' || `${cookie.secure}` == filterSecure.value) && (filterHttpOnly.value == '' || `${cookie.httpOnly}` == filterHttpOnly.value)) {
            let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c');
            cookie.whitelisted = whitelisted;
            if (filterWhitelist.value == '' || (`${cookie.whitelisted}`).includes(filterWhitelist.value)) {
              // add cookie to list
              entryList.push(cookie);
            }
          }
        } catch (e) {
          return reject(e);
        }
      });
      await Promise.all(promises);
      // reset page
      pageSpinner.value = 1;
      pageSpinner.max = Math.ceil(entryList.length / maxRows);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function buildTableBody(page = 1) {
  // fills the table using the existing entryList and given page number
  return new Promise(function(resolve, reject) {
    try {
      let newTableBody = document.createElement('tbody');
      newTableBody.id = 'cookieTableBody';
      // sort entries by name first
      entryList.sort(function(cookie1, cookie2) {
        if (cookie1.name.toUpperCase() > cookie2.name.toUpperCase()) {
          return 1;
        } else if (cookie1.name.toUpperCase() < cookie2.name.toUpperCase()) {
          return -1;
        } else {
          return 0;
        }
      });
      // add cookies to list
      for (let i = maxRows * (page - 1); i < entryList.length && i < maxRows * page; i++) {
        let entry = entryList[i];
        let tr = document.createElement('TR');
        let td;
        let selectCheckBox;
        tr.addEventListener('click', function(e) {
          fillCookieEditor(this.attachedCookie);
        });
        Object.defineProperty(tr, 'attachedCookie', {
          value: entry,
          writable: true,
          enumerable: true,
          configurable: true
        });
        // checkbox
        selectCheckBox = document.createElement('INPUT');
        selectCheckBox.type = 'checkbox';
        selectCheckBox.classList.add('selectCheckBox');
        selectCheckBox.addEventListener('change', function(e) {
          this.parentElement.parentElement.classList.toggle('selectedRow');
          if (selectAll.checked && !this.checked) {
            selectAllCheckBox.checked = false;
          }
          e.stopPropagation();
        });
        td = document.createElement('TD');
        td.appendChild(selectCheckBox);
        td.addEventListener('click', function(e) {
          // not to trigger parent elements click event
          e.stopPropagation();
          if (e.target !== this) {
            return;
          }
          this.children[0].checked = !this.children[0].checked;
          let evt = document.createEvent('HTMLEvents');
          evt.initEvent('change', false, true);
          this.children[0].dispatchEvent(evt);
        });
        tr.appendChild(td);
        // domain
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.domain));
        tr.appendChild(td);
        // name
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.name));
        tr.appendChild(td);
        // value
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.value));
        tr.appendChild(td);
        // keep until
        td = document.createElement('TD');
        if (typeof(entry.expirationDate) != 'undefined') {
          td.appendChild(document.createTextNode(formatDate(new Date(entry.expirationDate * 1000))));
        } else {
          td.appendChild(document.createTextNode('session ends'));
        }
        tr.appendChild(td);
        // path
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.path));
        tr.appendChild(td);
        // host only
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.hostOnly));
        tr.appendChild(td);
        // secure
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.secure));
        tr.appendChild(td);
        // http only
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.httpOnly));
        tr.appendChild(td);
        // whitelisted
        td = document.createElement('TD');
        td.appendChild(document.createTextNode(entry.whitelisted));
        tr.appendChild(td);
        // add row to table body
        newTableBody.appendChild(tr);
      }
      // replace old table body with new one
      cookieTable.replaceChild(newTableBody, cookieTable.childNodes[5]);
      // reset checkbox
      selectAll.checked = false;
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function deleteSelectedCookies() {
  return new Promise(async function(resolve, reject) {
    try {
      // deletes all selected entries
      if (selectAllCheckBox.checked) {
        // delete all cookies matching the filters
        if (confirm(`Are you sure you want to delete ${entryList.length} cookies?`)) {
          let promises = entryList.map(function(entry) {
            return deleteCookie(entry);
          });
          await Promise.all(promises);
        }
      } else {
        // delete only the selected cookies
        let promises = Array.prototype.map.call(selectCheckBoxes, function(selectCheckBox) {
          if (selectCheckBox.checked) {
            return deleteCookie(selectCheckBox.parentElement.parentElement.attachedCookie);
          }
        });
        await Promise.all(promises);
      }
      await fillCookieList();
      await buildTableBody();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function fillCookieEditor(cookie) {
  // fills the cookie editor ui elements with the given values
  // reset error text
  cookieEditorError.innerText = '';
  let expDate, hour, minute;
  if (cookie !== null) {
    // existing cookie
    saveButton.innerText = 'Save';
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
    saveButton.innerText = 'Add';
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
  filterDomain = document.getElementById('filterDomain');
  filterName = document.getElementById('filterName');
  filterValue = document.getElementById('filterValue');
  filterDate = document.getElementById('filterDate');
  filterPath = document.getElementById('filterPath');
  filterHostOnly = document.getElementById('filterHostOnly');
  filterSecure = document.getElementById('filterSecure');
  filterHttpOnly = document.getElementById('filterHttpOnly');
  filterWhitelist = document.getElementById('filterWhitelisted');
  saveButton = document.getElementById('saveButton');
  firstPartyDomainArea = document.getElementById('firstPartyDomainArea');
  cookieTable = document.getElementById('cookieTable');
  selectAllCheckBox = document.getElementById('selectAll');
  selectCheckBoxes = document.getElementsByClassName('selectCheckBox');
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
  selectAll = document.getElementById('selectAll');
  selectAllCheckBoxTd = document.getElementById('selectAllCheckBoxTd');
  deleteButton = document.getElementById('deleteButton');
  firstPartyDomainTextBox = document.getElementById('firstPartyDomainTextBox');
  clearButton = document.getElementById('clearButton');
  pageSpinner = document.getElementById('pageSpinner');
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
      await buildTableBody();
      fillCookieEditor(null);
    } catch (e) {
      console.error(e);
    }
  });
  // filter text boxes
  let filterTextBoxes = document.getElementsByClassName('filterTextBox');
  for (let i = 0; i < filterTextBoxes.length; i++) {
    filterTextBoxes[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterTextBoxes[i].addEventListener('keyup', async function(e) {
      try {
        await fillCookieList();
        await buildTableBody();
      } catch (e) {
        console.error(e);
      }
    });
  }
  // filter dropdowns
  let filterSelects = document.getElementsByClassName('filterSelect');
  for (let i = 0; i < filterSelects.length; i++) {
    filterSelects[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterSelects[i].addEventListener('change', async function(e) {
      try {
        await fillCookieList();
        await buildTableBody();
      } catch (e) {
        console.error(e);
      }
    });
  }
  // select all checkbox
  selectAll.addEventListener('change', function(e) {
    let selectCheckBoxes = document.getElementsByClassName('selectCheckBox');
    for (let i = 0; i < selectCheckBoxes.length; i++) {
      if (selectCheckBoxes[i].checked !== this.checked) {
        selectCheckBoxes[i].checked = this.checked;
        let evt = document.createEvent('HTMLEvents');
        evt.initEvent('change', false, true);
        selectCheckBoxes[i].dispatchEvent(evt);
      }
    }
  });
  // select all checkbox td
  selectAllCheckBoxTd.addEventListener('click', function(e) {
    if (e.target !== this) {
      return;
    }
    this.children[1].checked = !this.children[1].checked;
    let evt = document.createEvent('HTMLEvents');
    evt.initEvent('change', false, true);
    this.children[1].dispatchEvent(evt);
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
      await buildTableBody();
      fillCookieEditor(null);
    } catch (e) {
      cookieEditorError.innerText = `${e}\r\n\r\n`;
    }
  });
  // clear button
  clearButton.addEventListener('click', function() {
    fillCookieEditor(null);
  });
  // page spinner
  pageSpinner.addEventListener('input', async function() {
    if (parseInt(pageSpinner.value, 10) > parseInt(pageSpinner.max, 10)) {
      pageSpinner.value = pageSpinner.max;
    } else if (parseInt(pageSpinner.value, 10) < 1) {
      pageSpinner.value = 1;
    } else if (pageSpinner.value != '') {
      try {
        await buildTableBody(pageSpinner.value);
      } catch (e) {
        console.error(e);
      }
    }
  });
}