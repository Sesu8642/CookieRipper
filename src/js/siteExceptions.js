'use strict';
//selected exception for the exception editor
let exceptionInEditor = null;
// ui elements
let domainTextBox, denyAllRule, allowSessionRule, allowAllRule, entryEditorError, infoIcons, deleteButton, saveButton, clearButton;
let ruleIdDict = {
  0: 'Deny all',
  1: 'Allow Session Cookies',
  2: 'Allow All Cookies'
}
let entryList = [];
// table stuff
let table;
let selectedAll = false;
document.addEventListener('DOMContentLoaded', async function() {
  try {
    assignUiElements();
    addEventlisteners();
    fillRuleEditor(null);
    await fillExceptionList();
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
      width: '50%'
    }, {
      title: 'Rule',
      field: 'ruleId',
      formatter: cellRuleFormatter,
      headerFilter: 'select',
      headerFilterParams: {
        values: true,
        listItemFormatter: stringRuleFormatter
      },
      width: '40%'
    }, {
      title: 'Edit',
      formatter: editIconFormatter,
      align: 'center',
      cellClick: function(e, cell) {
        e.stopPropagation();
        fillRuleEditor(cell.getRow().getData());
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

  function stringRuleFormatter(value, formatterParams) {
    return ruleIdDict[value]
  }

  function cellRuleFormatter(cell, formatterParams) {
    return stringRuleFormatter(cell.getValue(), formatterParams)
  }
}
async function fillExceptionList() {
  // filters exceptions and stores them in entryList
  return new Promise(async function(resolve, reject) {
    try {
      entryList = [];
      // get all the entries
      let results = await browser.storage.local.get();
      // create array of all whitelist entries received from storage (the key contains all the information)
      for (let result in results) {
        if (result.startsWith('ex|')) {
          let resultContent = result.split('|');
          let resultObj = {};
          resultObj.domain = resultContent[1];
          entryList.push(resultObj)
        }
      }
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
      let selectedData = table.getSelectedData();
      if (selectedData.length > 10) {
        if (!confirm(`Are you sure you want to delete ${selectedData.length} entries?`)) {
          return resolve();
        }
      }
      let promises = selectedData.map(function(entry) {
        return deleteSiteException(getRuleRelevantPartOfDomain(entry.domain));
      });
      await Promise.all(promises);
      await fillExceptionList();
      table.setData(entryList);
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
        table.setData(entryList);
        fillRuleEditor(null);
      } catch (e) {
        entryEditorError.textContent = `${e.message}\r\n\r\n`;
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
  entryEditorError.textContent = '';
  if (entry !== null) {
    // existing entry
    saveButton.textContent = 'Save';
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
    saveButton.textContent = 'Add';
    exceptionInEditor = null;
    domainTextBox.value = '';
    denyAllRule.checked = true;
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  domainTextBox = document.getElementById('domainTextBox');
  denyAllRule = document.getElementById('denyAllRule');
  allowSessionRule = document.getElementById('allowSessionRule');
  allowAllRule = document.getElementById('allowAllRule');
  entryEditorError = document.getElementById('entryEditorError');
  domainTextBox = document.getElementById('domainTextBox');
  infoIcons = document.getElementsByClassName('infoIcon');
  deleteButton = document.getElementById('deleteButton');
  saveButton = document.getElementById('saveButton');
  clearButton = document.getElementById('clearButton');
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
}