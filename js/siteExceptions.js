'use strict';
//selected exception for the exception editor
var exceptionInEditor = null;
// ui elements
var filterDomain, filterRule, exceptionTable, selectAllCheckBox, selectCheckBoxes, domainTextBox, denyAllRule, allowSessionRule, allowAllRule, entryEditorError, infoIcons, filterTextBoxes, filterSelects, selectAllCheckBoxTd, deleteButton, saveButton, clearButton, pageSpinner;
const maxRows = 25;
var entryList = [];
document.addEventListener('DOMContentLoaded', function() {
  assignUiElements();
  addEventlisteners();
  fillExceptionList();
});

function fillExceptionList() {
  // filters exceptions and stores them in entryList
  entryList = [];
  // get all the entries
  var getting = browser.storage.local.get();
  getting.then(function(results) {
    // create array of all whitelist entries received from storage (the key contains all the information)
    var entries = [];
    for (var result in results) {
      if (result.startsWith('ex|')) {
        var resultContent = result.split('|');
        var resultObj = {};
        resultObj.domain = decodeURI(resultContent[1]);
        resultObj.ruleId = results[result];
        switch (resultObj.ruleId) {
          case 0:
            // deny
            resultObj.rule = 'Deny all';
            break;
          case 1:
            // allow session
            resultObj.rule = 'Allow Session Cookies';
            break;
          case 2:
            // allow
            resultObj.rule = 'Allow All Cookies';
            break;
          default:
            // invalid
            logError(Error(`invalid rule id: ${resultObj.ruleId}`));
        }
        entries.push(resultObj)
      }
    }
    // filter the entries
    for (var entry in entries) {
      if ((filterDomain.value == '' || entries[entry].domain.toLowerCase().includes(filterDomain.value.toLowerCase())) && (filterRule.value == '' || entries[entry].ruleId == filterRule.value)) {
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
  var newTableBody = document.createElement('tbody');
  newTableBody.id = 'exceptionTableBody';
  // sort entries by domain first
  entryList.sort(function(entry1, entry2) {
    if (entry1.domain.toUpperCase() > entry2.domain.toUpperCase()) {
      return 1;
    } else if (entry1.domain.toUpperCase() < entry2.domain.toUpperCase()) {
      return -1;
    } else {
      return 0;
    }
  });
  // add entries to list
  for (var i = maxRows * (page - 1); i < entryList.length && i < maxRows * page; i++) {
    var entry = entryList[i];
    var tr = document.createElement('TR');
    var td;
    var selectCheckBox;
    tr.addEventListener('click', function(e) {
      fillRuleEditor(this.attachedEntry);
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
      var evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', false, true);
      this.children[0].dispatchEvent(evt);
    });
    tr.appendChild(td);
    // domain
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.domain));
    tr.appendChild(td);
    // rule
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.rule));
    tr.appendChild(td);
    // add row to table body
    newTableBody.appendChild(tr);
  }
  // replace old table body with new one
  exceptionTable.replaceChild(newTableBody, exceptionTable.childNodes[5]);
  // reset checkbox
  selectAllCheckBox.checked = false;
}
async function deleteSelectedEntries() {
  // deletes all selected entries
  if (selectAllCheckBox.checked) {
    // delete all entries matching the filters
    if (confirm(`Are you sure you want to delete ${entryList.length} entries?`)) {
      var promises = entryList.map(function(entry) {
        return deleteSiteException(`https://${entry.domain}`);
      });
      await Promise.all(promises);
      fillExceptionList();
    }
  } else {
    // delete only the selected entries
    promises = Array.prototype.map.call(selectCheckBoxes, function(selectCheckBox) {
      if (selectCheckBox.checked) {
        var entry = selectCheckBox.parentElement.parentElement.attachedEntry;
        return deleteSiteException(`https://${entry.domain}`);
      }
    });
    await Promise.all(promises);
    fillExceptionList();
  }
}

function saveEntry() {
  // saves the data from the exception editor
  var rule = null;
  var domain = domainTextBox.value;
  if (denyAllRule.checked) {
    rule = 0;
  } else if (allowSessionRule.checked) {
    rule = 1;
  } else if (allowAllRule.checked) {
    rule = 2;
  } else {
    logError(Error(`Invalid rule input: ${rule}`));
  }
  var adding = addSiteException(domain, rule, false, exceptionInEditor);
  adding.then(function() {
    fillExceptionList();
    fillRuleEditor(null);
  }, function(error) {
    entryEditorError.innerText = `${error}\r\n\r\n`;
  });
}

function fillRuleEditor(entry) {
  // fills the rule editor ui elements with the given values
  // reset error text
  entryEditorError.innerText = '';
  if (entry !== null) {
    // existing entry
    saveButton.innerText = 'Save';
    exceptionInEditor = entry;
    domainTextBox.value = entry.domain;
    switch (entry.ruleId) {
      case 0:
        // deny
        denyAllRule.checked = true;
        break;
      case 1:
        // allow session
        allowSessionRule.checked = true;
        break;
      case 2:
        // allow
        allowAllRule.checked = true;
        break;
      default:
        // invalid
        logError(Error(`Invalid ruleID: ${entry.ruleId}`));
    }
  } else {
    // new entry
    saveButton.innerText = 'Add';
    exceptionInEditor = null;
    domainTextBox.value = '';
    denyAllRule.checked = true;
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  filterDomain = document.getElementById('filterDomain');
  filterRule = document.getElementById('filterRule');
  exceptionTable = document.getElementById('exceptionTable');
  selectAllCheckBox = document.getElementById('selectAll');
  selectCheckBoxes = document.getElementsByClassName('selectCheckBox');
  domainTextBox = document.getElementById('domainTextBox');
  denyAllRule = document.getElementById('denyAllRule');
  allowSessionRule = document.getElementById('allowSessionRule');
  allowAllRule = document.getElementById('allowAllRule');
  entryEditorError = document.getElementById('entryEditorError');
  domainTextBox = document.getElementById('domainTextBox');
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
  var i;
  for (i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', function(e) {
      sendInfoMessage(e.target.title);
    });
  }
  // filter text boxes
  for (i = 0; i < filterTextBoxes.length; i++) {
    filterTextBoxes[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterTextBoxes[i].addEventListener('keyup', function(e) {
      fillExceptionList();
    });
  }
  // filter dropdowns
  for (i = 0; i < filterSelects.length; i++) {
    filterSelects[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterSelects[i].addEventListener('change', function(e) {
      fillExceptionList();
    });
  }
  // select all checkbox
  selectAllCheckBox.addEventListener('change', function(e) {
    for (i = 0; i < selectCheckBoxes.length; i++) {
      if (selectCheckBoxes[i].checked !== this.checked) {
        selectCheckBoxes[i].checked = this.checked;
        var evt = document.createEvent('HTMLEvents');
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
    var evt = document.createEvent('HTMLEvents');
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
    fillRuleEditor(null);
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