'use strict';
// selected entry for the entry editor
let entryInEditor = null;
// ui elements
let filterDomain, filterName, filterType, whitelistTable, selectAllCheckBox, selectCheckBoxes, http, domainTextBox, nameTextBox, entryEditorError, dom, infoIcons, filterTextBoxes, filterSelects, selectAllCheckBoxTd, deleteButton, saveButton, clearButton, pageSpinner;
const maxRows = 25;
let entryList = [];
document.addEventListener('DOMContentLoaded', function() {
  assignUiElements();
  addEventlisteners();
  fillEntryEditor(null);
  fillWhitelist();
});

function fillWhitelist() {
  // filters whitelist entries and stores them in entryList
  entryList = [];
  // get all the entries
  let getting = browser.storage.local.get();
  getting.then(function(results) {
    // create array of all whitelist entries received from storage (the key contains all the information)
    let entries = [];
    for (let result in results) {
      if (result.startsWith('wl|')) {
        let resultContent = result.split('|');
        let resultObj = {};
        resultObj.domain = decodeURI(resultContent[1]);
        resultObj.name = decodeURI(resultContent[2]);
        resultObj.type = resultContent[3];
        entries.push(resultObj)
      }
    }
    // filter the entries
    for (let entry in entries) {
      if ((filterDomain.value == '' || entries[entry].domain.toLowerCase().includes(filterDomain.value.toLowerCase())) && (filterName.value == '' || entries[entry].name.toLowerCase().includes(filterName.value.toLowerCase())) && (filterType.value == '' || entries[entry].type.includes(filterType.value))) {
        entryList.push(entries[entry]);
      }
    }
    // reset page
    pageSpinner.value = 1;
    pageSpinner.max = Math.ceil(entryList.length / maxRows);
    // (re)build table
    buildTableBody(1);
  }, logError);
}

function buildTableBody(page) {
  // fills the table using the existing entryList and given page number
  let newTableBody = document.createElement('tbody');
  newTableBody.id = 'whitelistTableBody';
  // sort entries by name first
  entryList.sort(function(entry1, entry2) {
    if (entry1.name.toUpperCase() > entry2.name.toUpperCase()) {
      return 1;
    } else if (entry1.name.toUpperCase() < entry2.name.toUpperCase()) {
      return -1;
    } else {
      return 0;
    }
  });
  // add entries to list
  for (let i = maxRows * (page - 1); i < entryList.length && i < maxRows * page; i++) {
    let entry = entryList[i];
    let tr = document.createElement('TR');
    let td;
    let selectCheckBox;
    tr.addEventListener('click', function(e) {
      fillEntryEditor(this.attachedEntry);
    });
    Object.defineProperty(tr, 'attachedEntry', {
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
      if (selectAllCheckBox.checked && !this.checked) {
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
    // type
    td = document.createElement('TD');
    if (entry.type === 'c') {
      td.appendChild(document.createTextNode('Http Cookie'));
    } else {
      td.appendChild(document.createTextNode('Web Storage'));
    }
    tr.appendChild(td);
    // add row to table body
    newTableBody.appendChild(tr);
  }
  // replace old table body with new one
  whitelistTable.replaceChild(newTableBody, whitelistTable.childNodes[5]);
  // reset checkbox
  selectAllCheckBox.checked = false;
}
async function deleteSelectedEntries() {
  // deletes all selected entries
  if (selectAllCheckBox.checked) {
    // delete all entries matching the filters
    if (confirm(`Are you sure you want to delete ${entryList.length} entries?`)) {
      let promises = entryList.map(function(entry) {
        return deleteWhitelistEntry(entry.domain, entry.name, entry.type);
      });
      await Promise.all(promises);
      fillWhitelist();
    }
  } else {
    // delete only the selected entries
    let promises = Array.prototype.map.call(selectCheckBoxes, function(selectCheckBox) {
      if (selectCheckBox.checked) {
        let entry = selectCheckBox.parentElement.parentElement.attachedEntry;
        return deleteWhitelistEntry(entry.domain, entry.name, entry.type);
      }
    });
    await Promise.all(promises);
    fillWhitelist();
  }
}

function saveEntry() {
  // saves the data from the entry editor
  let type = (http.checked ? 'c' : 'd');
  let adding = addWhitelistEntry(domainTextBox.value, nameTextBox.value, type, entryInEditor);
  adding.then(function() {
    fillWhitelist();
    fillEntryEditor(null);
  }, function(error) {
    entryEditorError.innerText = `${error.message}\r\n\r\n`;
  });
}

function fillEntryEditor(entry) {
  // fills the entry editor ui elements with the given values
  // reset error text
  entryEditorError.innerText = '';
  if (entry !== null) {
    // existing entry
    saveButton.innerText = 'Save';
    entryInEditor = entry;
    if (entry.type === 'c') {
      http.checked = true;
    } else {
      dom.checked = true;
    }
    domainTextBox.value = entry.domain;
    nameTextBox.value = entry.name;
  } else {
    // new entry
    saveButton.innerText = 'Add';
    entryInEditor = null;
    http.checked = true;
    dom.checked = false;
    domainTextBox.value = '';
    nameTextBox.value = '';
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  filterDomain = document.getElementById('filterDomain');
  filterName = document.getElementById('filterName');
  filterType = document.getElementById('filterType');
  whitelistTable = document.getElementById('whitelistTable');
  selectAllCheckBox = document.getElementById('selectAll');
  selectCheckBoxes = document.getElementsByClassName('selectCheckBox');
  http = document.getElementById('http');
  domainTextBox = document.getElementById('domainTextBox');
  nameTextBox = document.getElementById('nameTextBox');
  entryEditorError = document.getElementById('entryEditorError');
  dom = document.getElementById('dom');
  infoIcons = document.getElementsByClassName('infoIcon');
  filterTextBoxes = document.getElementsByClassName('filterTextBox');
  filterSelects = document.getElementsByClassName('filterSelect');
  selectAllCheckBoxTd = document.getElementById('selectAllCheckBoxTd');
  deleteButton = document.getElementById('deleteButton');
  saveButton = document.getElementById('saveButton');
  clearButton = document.getElementById('clearButton');
  pageSpinner = document.getElementById('pageSpinner');
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  // info icons
  for (let i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', function(e) {
      sendInfoMessage(e.target.title);
    });
  }
  // filter text boxes
  for (let i = 0; i < filterTextBoxes.length; i++) {
    filterTextBoxes[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterTextBoxes[i].addEventListener('keyup', function(e) {
      fillWhitelist();
    });
  }
  // filter dropdowns
  for (let i = 0; i < filterSelects.length; i++) {
    filterSelects[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterSelects[i].addEventListener('change', function(e) {
      fillWhitelist();
    });
  }
  // select all checkbox
  selectAllCheckBox.addEventListener('change', function(e) {
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
  deleteButton.addEventListener('click', function(e) {
    deleteSelectedEntries();
  });
  // save button
  saveButton.addEventListener('click', function() {
    saveEntry();
  });
  // clear button
  clearButton.addEventListener('click', function() {
    fillEntryEditor(null);
  });
  // page spinner
  pageSpinner.addEventListener('input', function() {
    if (parseInt(pageSpinner.value, 10) > parseInt(pageSpinner.max, 10)) {
      pageSpinner.value = pageSpinner.max;
    } else if (parseInt(pageSpinner.value, 10) < 1) {
      pageSpinner.value = 1;
    } else if (pageSpinner.value != '') {
      buildTableBody(pageSpinner.value);
    }
  });
}