'use strict';
//selected exception for the exception editor
let exceptionInEditor = null;
// ui elements
let filterDomain, filterRule, exceptionTable, selectAllCheckBox, selectCheckBoxes, domainTextBox, denyAllRule, allowSessionRule, allowAllRule, entryEditorError, infoIcons, filterTextBoxes, filterSelects, selectAllCheckBoxTd, deleteButton, saveButton, clearButton, pageSpinner;
const maxRows = 25;
let entryList = [];
document.addEventListener('DOMContentLoaded', async function() {
  assignUiElements();
  addEventlisteners();
  try {
    await fillExceptionList();
    await buildTableBody();
  } catch (e) {
    console.error(e);
  }
});
async function fillExceptionList() {
  // filters exceptions and stores them in entryList
  return new Promise(async function(resolve, reject) {
    try {
      entryList = [];
      // get all the entries
      let results = await browser.storage.local.get();
      // create array of all whitelist entries received from storage (the key contains all the information)
      let entries = [];
      for (let result in results) {
        if (result.startsWith('ex|')) {
          let resultContent = result.split('|');
          let resultObj = {};
          resultObj.domain = resultContent[1];
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
              return reject(Error(`invalid rule id: ${resultObj.ruleId}`));
          }
          entries.push(resultObj)
        }
      }
      // filter the entries
      for (let entry in entries) {
        if ((filterDomain.value == '' || entries[entry].domain.toLowerCase().includes(filterDomain.value.toLowerCase())) && (filterRule.value == '' || entries[entry].ruleId == filterRule.value)) {
          entryList.push(entries[entry]);
        }
      }
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
      for (let i = maxRows * (page - 1); i < entryList.length && i < maxRows * page; i++) {
        let entry = entryList[i];
        let tr = document.createElement('TR');
        let td;
        let selectCheckBox;
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
          let evt = document.createEvent('HTMLEvents');
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
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function deleteSelectedEntries() {
  // deletes all selected entries
  return new Promise(async function(resolve, reject) {
    try {
      if (selectAllCheckBox.checked) {
        // delete all entries matching the filters
        if (confirm(`Are you sure you want to delete ${entryList.length} entries?`)) {
          let promises = entryList.map(function(entry) {
            return deleteSiteException(getRuleRelevantPartofDomain(entry.domain));
          });
          await Promise.all(promises);
          await fillExceptionList();
          await buildTableBody();
        }
      } else {
        // delete only the selected entries
        let promises = Array.prototype.map.call(selectCheckBoxes, function(selectCheckBox) {
          if (selectCheckBox.checked) {
            let entry = selectCheckBox.parentElement.parentElement.attachedEntry;
            return deleteSiteException(getRuleRelevantPartofDomain(entry.domain));
          }
        });
        await Promise.all(promises);
        await fillExceptionList();
        await buildTableBody();
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function saveEntry() {
  return new Promise(async function(resolve, reject) {
    try {
      // saves the data from the exception editor
      let rule = null;
      let domain = domainTextBox.value;
      if (denyAllRule.checked) {
        rule = 0;
      } else if (allowSessionRule.checked) {
        rule = 1;
      } else if (allowAllRule.checked) {
        rule = 2;
      } else {
        reject(Error(`Invalid rule input: ${rule}`));
      }
      try {
        await addSiteException(domain, rule, false, exceptionInEditor);
        await fillExceptionList();
        await buildTableBody();
        fillRuleEditor(null);
      } catch (e) {
        entryEditorError.innerText = `${e}\r\n\r\n`;
      }
      resolve();
    } catch (e) {
      reject(e);
    }
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
        console.error(Error(`Invalid ruleID: ${entry.ruleId}`));
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
  for (let i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', async function(e) {
      try {
        await sendInfoMessage(e.target.title);
      } catch (e) {
        console.error(e);
      }
    });
  }
  // filter text boxes
  for (let i = 0; i < filterTextBoxes.length; i++) {
    filterTextBoxes[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterTextBoxes[i].addEventListener('keyup', async function(e) {
      try {
        await fillExceptionList();
        await buildTableBody();
      } catch (e) {
        console.error(e);
      }
    });
  }
  // filter dropdowns
  for (let i = 0; i < filterSelects.length; i++) {
    filterSelects[i].addEventListener('click', function(e) {
      e.stopPropagation();
    });
    filterSelects[i].addEventListener('change', async function(e) {
      try {
        await fillExceptionList();
        await buildTableBody();
      } catch (e) {
        console.error(e);
      }
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
  saveButton.addEventListener('click', async function() {
    try {
      saveEntry();
    } catch (e) {
      console.error(e);
    }
  });
  // clear button
  clearButton.addEventListener('click', function() {
    fillRuleEditor(null);
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