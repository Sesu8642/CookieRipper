'use strict';
var activeTabUrl, activeTabId, activeTabCookieStore;
//selected cookie for the cookie editor
var cookieInEditor = null;
var domStorageEntryInEditor = null;
var cookieList = [];
var unwantedCookieList = [];
var domList = [];
var unwantedDomList = [];
// ui elements
var firstPartyDomainArea, denyOption, sessionOption, allowOption, slider, useSiteBehaviourLbl, useSiteBehaviourIcon, useTempBehaviourArea, useSiteBehaviourArea, useTempBehaviour, useSiteBehaviour, headline, cookieStore, nonHttpInfo, mainView, cookieTable, domStorageTable, cookieDomainTextBox, cookieHostOnly, cookieNameTextBox, cookieValueTextBox, cookieSessionCookie, cookiePersistent, cookieDate, cookieTime, cookiePathTextBox, cookieFirstPartyDomainTextBox, cookieSecure, cookieHttpOnly, cookieDeleteButton, domStorageDomainTextBox, domStorageNameTextBox, domStorageValueTextBox, domStorageTemporary, domStoragePermanent, domStorageDeleteButton, makeRulePerm, cookieEditor, domStorageEditor, advancedCookieProperties, cookieAdvancedToggle, cookieCancelButton, domStorageCancelButton, cookieSaveButton, cookieEditorError, domStorageEditorError, domStorageSaveButton, cookieAddIcon, domAddIcon, cookieDeleteAllIcon, domDeleteAllIcon, optionsDropdown, optionsImage, dropdownItemSettings, dropdownItemClearTemp;
document.addEventListener('DOMContentLoaded', async function() {
  assignUiElements();
  addEventlisteners();
  var tab = await getActiveTab();
  activeTabUrl = tab.url;
  activeTabId = tab.id;
  activeTabCookieStore = await getTabCookieStore(activeTabId);
  fillSiteInfo();
  if (firstPartyIsolationSupported) {
    firstPartyDomainArea.classList.remove('hidden');
  }
});

function highlightActiveOption(option) {
  // highlights the active option in ui
  switch (option) {
    case 0:
      // deny
      denyOption.classList.add('selectedBehaviour');
      sessionOption.classList.remove('selectedBehaviour');
      allowOption.classList.remove('selectedBehaviour');
      break;
    case 1:
      // allow session
      denyOption.classList.remove('selectedBehaviour');
      sessionOption.classList.add('selectedBehaviour');
      allowOption.classList.remove('selectedBehaviour');
      break;
    case 2:
      // allow all
      denyOption.classList.remove('selectedBehaviour');
      sessionOption.classList.remove('selectedBehaviour');
      allowOption.classList.add('selectedBehaviour');
      break;
    default:
      // invalid
  }
}

function enableSiteException(temp) {
  // adds a site exception
  var option = Number(slider.value);
  var adding = addSiteException(activeTabUrl, option, temp);
  adding.then(function() {
    fillSiteInfo();
  }, logError);
}
async function fillSiteInfo() {
  // puts site specific info in ui including cookies and dom storage
  async function depictPermException() {
    // deal with permanent exception
    var tempSiteException = await getSiteException(hostname, false)
    if (tempSiteException === null) {
      useSiteBehaviourLbl.textContent = `use site behaviour (default; ${getBehaviourString(await callGetDefaultBehaviour())})`;
      useSiteBehaviourIcon.classList.add('hidden');
    } else {
      useSiteBehaviourLbl.textContent = `use site behaviour (${getBehaviourString(tempSiteException)})`;
      useSiteBehaviourIcon.classList.remove('hidden');
    }
    depictTempException(tempSiteException);
  }
  async function depictTempException(permException) {
    // deal with temporary exception
    var tempSiteException = await getSiteException(hostname, true);
    if (tempSiteException !== null) {
      useTempBehaviourArea.classList.add('selectedBehaviourArea');
      useSiteBehaviourArea.classList.remove('selectedBehaviourArea');
      slider.value = tempSiteException;
      highlightActiveOption(tempSiteException);
      useTempBehaviour.checked = true;
      useSiteBehaviour.checked = false;
    } else if (permException !== null) {
      useTempBehaviourArea.classList.remove('selectedBehaviourArea');
      useSiteBehaviourArea.classList.add('selectedBehaviourArea');
      slider.value = permException;
      useTempBehaviour.checked = false;
      useSiteBehaviour.checked = true;
      highlightActiveOption(permException);
    } else {
      useTempBehaviourArea.classList.remove('selectedBehaviourArea');
      useSiteBehaviourArea.classList.add('selectedBehaviourArea');
      slider.value = await callGetDefaultBehaviour();
      useTempBehaviour.checked = false;
      useSiteBehaviour.checked = true;
      highlightActiveOption(await callGetDefaultBehaviour());
    }
  }
  if (activeTabUrl.startsWith('http')) {
    // get all the dom storage
    fillDomStorageList();
    // get all the cookies
    fillCookieList();
    var hostname = trimSubdomains(activeTabUrl);
    headline.textContent = `Settings For ${hostname}`;
    cookieStore.textContent = `Cookie Store ID: ${activeTabCookieStore}`;
    depictPermException();
  } else {
    nonHttpInfo.classList.remove('hidden');
    mainView.classList.add('hidden');
  }
}

function fillCookieList() {
  // gets cookies and stores them in cookieList
  cookieList = [];
  // get all the cookies
  var getting = getAllCookies({
    url: activeTabUrl,
    storeId: activeTabCookieStore
  });
  getting.then(async function(cookies) {
    var promises = cookies.map(function(cookie) {
      return getObjectWhitelistedState(cookie.domain, cookie.name, 'c').then(async function(whitelisted) {
        cookie.whitelisted = whitelisted;
        // add cookie to list
        cookieList.push(cookie);
      });
    });
    await Promise.all(promises);
    fillUnwantedCookieList();
  }, logError);
}
async function fillUnwantedCookieList() {
  // gets unwanted cookies and stores them in unwantedCookieList
  unwantedCookieList = [];
  var fullDomain = (new URL(activeTabUrl)).hostname;
  var hostname = trimSubdomains(activeTabUrl);
  var unwantedCookies = await callGetUnwantedCookiesForHostname(hostname);
  unwantedCookies.forEach(function(cookie) {
    // remove leading . from cookie domain for comparison
    var cookieDomain = (cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain);
    if (fullDomain === cookieDomain || (!cookie.hostOnly && fullDomain.endsWith(`${cookieDomain}`))) {
      unwantedCookieList.push(cookie);
    }
  });
  buildCookieTableBody();
}

function fillDomStorageList() {
  // gets dom storage and stores it in domList
  domList = [];
  // get all the entries
  var getting = getTabDomStorage(activeTabId);
  getting.then(async function(response) {
      var storageItems = [];
      // create array of entry objects first
      for (var i in response.localStorage) {
        var entry = {};
        entry.name = i;
        entry.value = response.localStorage[i];
        entry.domain = (new URL(activeTabUrl)).hostname;
        entry.permanence = 'permanent';
        storageItems.push(entry);
      }
      for (i in response.sessionStorage) {
        entry = {};
        entry.name = i;
        entry.value = response.sessionStorage[i];
        entry.domain = (new URL(activeTabUrl)).hostname;
        entry.permanence = 'temporary';
        storageItems.push(entry);
      }
      if (storageItems.length === 0) {
        fillUnwantedDomStorageList();
      }
      // add whitelist info
      var promises = storageItems.map(function(storageItem) {
        return getObjectWhitelistedState(storageItem.domain, storageItem.name, 'd').then(function(whitelisted) {
          storageItem.whitelisted = whitelisted
          // add item to list
          domList.push(storageItem);
        });
      });
      await Promise.all(promises);
      fillUnwantedDomStorageList();
    },
    function() {
      // [UGLY] when injected script is not ready wait 50ms and try again
      setTimeout(function() {
        fillDomStorageList();
      }, 50);
    });
}
async function fillUnwantedDomStorageList() {
  // gets unwanted dom storage entries and stores them in unwantedDomList
  unwantedDomList = await getUnwantedDomStoregeEntries(activeTabId);
  // (re)build table
  buildDomStorageTableBody();
}

function buildCookieTableBody() {
  // fills the table using the existing cookieList, unwantedCookieList
  var newTableBody = document.createElement('tbody');
  newTableBody.id = 'cookieTableBody';
  // sort cookies by whitelisted and name
  cookieList.sort(function(cookie1, cookie2) {
    if (cookie1.whitelisted < cookie2.whitelisted) {
      return 1;
    } else if (cookie1.whitelisted > cookie2.whitelisted) {
      return -1;
    } else {
      if (cookie1.name.toUpperCase() > cookie2.name.toUpperCase()) {
        return 1;
      } else if (cookie1.name.toUpperCase() < cookie2.name.toUpperCase()) {
        return -1;
      } else {
        return 0;
      }
    }
  });
  // sort unwanted cookies by name (cant be whitelisted)
  unwantedCookieList.sort(function(cookie1, cookie2) {
    if (cookie1.name.toUpperCase() > cookie2.name.toUpperCase()) {
      return 1;
    } else if (cookie1.name.toUpperCase() < cookie2.name.toUpperCase()) {
      return -1;
    } else {
      return 0;
    }
  });
  // add cookies to list
  cookieList.forEach(function(cookie) {
    var tr = document.createElement('TR');
    var td;
    var editIcon, deleteIcon, whitelistedCheckBox;
    Object.defineProperty(tr, 'attachedCookie', {
      value: cookie,
      writable: true,
      enumerable: true,
      configurable: true
    });
    // name and value can cause lag when too long (especially in chromium based browsers) and therefore get cut
    // name
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(cookie.name.substr(0, 50)));
    td.title = cookie.name;
    tr.appendChild(td);
    // keep until
    td = document.createElement('TD');
    if (typeof(cookie.expirationDate) != 'undefined') {
      td.appendChild(document.createTextNode(formatDate(new Date(cookie.expirationDate * 1000))));
      td.title = new Date(cookie.expirationDate * 1000);
    } else {
      td.appendChild(document.createTextNode('session ends'));
    }
    tr.appendChild(td);
    // value
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(cookie.value.substr(0, 50)));
    td.title = cookie.value;
    tr.appendChild(td);
    // whitelisted checkbox
    whitelistedCheckBox = document.createElement('INPUT');
    whitelistedCheckBox.type = 'checkbox';
    whitelistedCheckBox.title = 'whitelist';
    if (cookie.whitelisted) {
      whitelistedCheckBox.checked = true;
    }
    whitelistedCheckBox.classList.add('tableCheckBox');
    whitelistedCheckBox.addEventListener('change', async function(e) {
      if (e.target.checked) {
        await addWhitelistEntry(e.target.parentElement.parentElement.attachedCookie.domain, e.target.parentElement.parentElement.attachedCookie.name, 'c');
        updateActiveTabsCounts();
        fillSiteInfo();
      } else {
        await deleteWhitelistEntry(e.target.parentElement.parentElement.attachedCookie.domain, e.target.parentElement.parentElement.attachedCookie.name, 'c', null);
        // could be optimized with function that only checks that one cookie
        await deleteExistingUnwantedCookies(activeTabUrl, activeTabCookieStore);
        updateActiveTabsCounts();
        fillSiteInfo();
      }
    });
    td = document.createElement('TD');
    td.appendChild(whitelistedCheckBox);
    td.addEventListener('click', function(e) {
      if (e.target !== this) {
        return;
      }
      this.children[0].checked = !this.children[0].checked;
      var evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', false, true);
      this.children[0].dispatchEvent(evt);
    });
    td.classList.add('checkbox-td');
    tr.appendChild(td);
    // edit icon
    editIcon = document.createElement('IMG');
    editIcon.src = '/icons/edit.svg';
    editIcon.alt = 'edit';
    editIcon.title = 'edit';
    editIcon.classList.add('tableIcon');
    editIcon.addEventListener('click', function(e) {
      showView(cookieEditor);
      fillCookieEditor(e.target.parentElement.parentElement.attachedCookie, null);
    });
    td = document.createElement('TD');
    td.appendChild(editIcon);
    tr.appendChild(td);
    // delete icon
    deleteIcon = document.createElement('IMG');
    deleteIcon.src = '/icons/trash-alt.svg';
    deleteIcon.alt = 'delete';
    deleteIcon.title = 'delete';
    deleteIcon.classList.add('tableIcon');
    deleteIcon.addEventListener('click', async function(e) {
      await deleteCookie(e.target.parentElement.parentElement.attachedCookie);
      fillSiteInfo();
      updateActiveTabsCounts();
    });
    td = document.createElement('TD');
    td.appendChild(deleteIcon);
    tr.appendChild(td);
    // add row to table body
    newTableBody.appendChild(tr);
  });
  // add unwanted cookies to list
  unwantedCookieList.forEach(function(cookie) {
    var tr = document.createElement('TR');
    var td = document.createElement('TD');
    var editIcon, deleteIcon, whitelistedCheckBox;
    tr.classList.add('blocked');
    Object.defineProperty(tr, 'attachedCookie', {
      value: cookie,
      writable: true,
      enumerable: true,
      configurable: true
    });
    // name and value can cause lag when too long (especially in chromium based browsers) and therefore get cut
    // name
    td.appendChild(document.createTextNode(cookie.name.substr(0, 50)));
    tr.appendChild(td);
    // keep until
    td = document.createElement('TD');
    if (typeof(cookie.expirationDate) != 'undefined') {
      td.appendChild(document.createTextNode(formatDate(new Date(cookie.expirationDate * 1000))));
    } else {
      td.appendChild(document.createTextNode('session ends'));
    }
    tr.appendChild(td);
    // value
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(cookie.value.substr(0, 50)));
    tr.appendChild(td);
    // whitelisted checkbox
    whitelistedCheckBox = document.createElement('INPUT');
    whitelistedCheckBox.type = 'checkbox';
    whitelistedCheckBox.classList.add('tableCheckBox');
    whitelistedCheckBox.addEventListener('change', async function(e) {
      if (e.target.checked) {
        await addWhitelistEntry(e.target.parentElement.parentElement.attachedCookie.domain, e.target.parentElement.parentElement.attachedCookie.name, 'c');
        await callRestoreUnwantedCookie(e.target.parentElement.parentElement.attachedCookie.domain, e.target.parentElement.parentElement.attachedCookie.name, activeTabCookieStore);
        updateActiveTabsCounts();
        fillSiteInfo();
      }
    });
    td = document.createElement('TD');
    td.appendChild(whitelistedCheckBox);
    td.addEventListener('click', function(e) {
      if (e.target !== this) {
        return;
      }
      this.children[0].checked = !this.children[0].checked;
      var evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', false, true);
      this.children[0].dispatchEvent(evt);
    });
    tr.appendChild(td);
    // edit icon
    editIcon = document.createElement('IMG');
    editIcon.src = '/icons/edit.svg';
    editIcon.alt = 'edit';
    editIcon.title = 'edit';
    editIcon.classList.add('tableIconDisabled');
    td = document.createElement('TD');
    td.appendChild(editIcon);
    tr.appendChild(td);
    // delete icon
    deleteIcon = document.createElement('IMG');
    deleteIcon.src = '/icons/trash-alt.svg';
    deleteIcon.alt = 'delete';
    deleteIcon.title = 'delete';
    deleteIcon.classList.add('tableIcon');
    deleteIcon.addEventListener('click', async function(e) {
      await callDeleteUnwantedCookie(e.target.parentElement.parentElement.attachedCookie.domain, e.target.parentElement.parentElement.attachedCookie.name);
      fillSiteInfo();
    });
    td = document.createElement('TD');
    td.appendChild(deleteIcon);
    tr.appendChild(td);
    // add row to table body
    newTableBody.appendChild(tr);
  });
  // replace old table body with new one
  cookieTable.replaceChild(newTableBody, cookieTable.childNodes[0]);
}
async function buildDomStorageTableBody() {
  // fills the table using the existing domList, unwantedDomList
  var newTableBody = document.createElement('tbody');
  newTableBody.id = 'domStorageTableBody';
  // sort entries by the following criteria: whitelisted, permanence, name
  domList.sort(function(entry1, entry2) {
    if (entry1.whitelisted < entry2.whitelisted) {
      return 1;
    } else if (entry1.whitelisted > entry2.whitelisted) {
      return -1;
    } else {
      if (entry1.permanence == 'permanent' && entry2.permanence == 'temporary') {
        return 1;
      } else if (entry1.permanence == 'temporary' && entry2.permanence == 'permanent') {
        return -1;
      } else {
        if (entry1.name.toUpperCase() > entry2.name.toUpperCase()) {
          return 1;
        } else if (entry1.name.toUpperCase() < entry2.name.toUpperCase()) {
          return -1;
        } else {
          return 0;
        }
      }
    }
  });
  // sort unwanted entries by the following criteria: permanence, name
  unwantedDomList.sort(function(entry1, entry2) {
    if (entry1.whitelisted > entry2.whitelisted) {
      return -1;
    } else {
      if (entry1.permanence == 'permanent' && entry2.permanence == 'temporary') {
        return 1;
      } else if (entry1.permanence == 'temporary' && entry2.permanence == 'permanent') {
        return -1;
      } else {
        if (entry1.name.toUpperCase() > entry2.name.toUpperCase()) {
          return 1;
        } else if (entry1.name.toUpperCase() < entry2.name.toUpperCase()) {
          return -1;
        } else {
          return 0;
        }
      }
    }
  });
  // add entries to list
  domList.forEach(function(entry) {
    var tr = document.createElement('TR');
    var td;
    var editIcon, deleteIcon, whitelistedCheckBox;
    Object.defineProperty(tr, 'attachedEntry', {
      value: entry,
      writable: true,
      enumerable: true,
      configurable: true
    });
    // name and value can cause lag when too long (especially in chromium based browsers) and therefore get cut
    // name
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.name.substr(0, 50)));
    td.title = entry.name;
    tr.appendChild(td);
    // keep until
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.permanence));
    td.title = entry.permanence;
    tr.appendChild(td);
    // value
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.value.substr(0, 50)));
    td.title = entry.value;
    tr.appendChild(td);
    // whitelisted checkbox
    whitelistedCheckBox = document.createElement('INPUT');
    whitelistedCheckBox.type = 'checkbox';
    whitelistedCheckBox.title = 'whitelist';
    if (entry.whitelisted) {
      whitelistedCheckBox.checked = true;
    }
    whitelistedCheckBox.classList.add('tableCheckBox');
    whitelistedCheckBox.addEventListener('change', async function(e) {
      if (e.target.checked) {
        var adding = addWhitelistEntry(e.target.parentElement.parentElement.attachedEntry.domain, e.target.parentElement.parentElement.attachedEntry.name, 'd');
        adding.then(function() {
          updateActiveTabsCounts();
          fillSiteInfo();
        }, logError);
      } else {
        await deleteWhitelistEntry(e.target.parentElement.parentElement.attachedEntry.domain, e.target.parentElement.parentElement.attachedEntry.name, 'd');
        updateActiveTabsCounts();
        fillSiteInfo();
      }
    });
    td = document.createElement('TD');
    td.appendChild(whitelistedCheckBox);
    td.addEventListener('click', function(e) {
      if (e.target !== this) {
        return;
      }
      this.children[0].checked = !this.children[0].checked;
      var evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', false, true);
      this.children[0].dispatchEvent(evt);
    });
    tr.appendChild(td);
    // edit icon
    editIcon = document.createElement('IMG');
    editIcon.src = '/icons/edit.svg';
    editIcon.alt = 'edit';
    editIcon.title = 'edit';
    editIcon.classList.add('tableIcon');
    editIcon.addEventListener('click', function(e) {
      showView(domStorageEditor);
      fillDomStorageEditor(e.target.parentElement.parentElement.attachedEntry, null);
    });
    td = document.createElement('TD');
    td.appendChild(editIcon);
    tr.appendChild(td);
    // delete icon
    deleteIcon = document.createElement('IMG');
    deleteIcon.src = '/icons/trash-alt.svg';
    deleteIcon.alt = 'delete';
    deleteIcon.title = 'delete';
    deleteIcon.classList.add('tableIcon');
    deleteIcon.addEventListener('click', async function(e) {
      await deleteDomStorageEntry(activeTabId, e.target.parentElement.parentElement.attachedEntry);
      fillSiteInfo();
      updateActiveTabsCounts();
    });
    td = document.createElement('TD');
    td.appendChild(deleteIcon);
    tr.appendChild(td);
    // add row to table body
    newTableBody.appendChild(tr);
  });
  // add unwanted entries to list
  unwantedDomList.forEach(function(entry) {
    var tr = document.createElement('TR');
    var td;
    var editIcon, deleteIcon, whitelistedCheckBox;
    tr.classList.add('blocked');
    Object.defineProperty(tr, 'attachedEntry', {
      value: entry,
      writable: true,
      enumerable: true,
      configurable: true
    });
    // name and value can cause lag when too long (especially in chromium based browsers) and therefore get cut
    // name
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.name.substr(0, 50)));
    td.title = entry.name;
    tr.appendChild(td);
    // keep until
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.permanence));
    td.title = entry.permanence;
    tr.appendChild(td);
    // value
    td = document.createElement('TD');
    td.appendChild(document.createTextNode(entry.value.substr(0, 50)));
    td.title = entry.value;
    tr.appendChild(td);
    // whitelisted checkbox
    whitelistedCheckBox = document.createElement('INPUT');
    whitelistedCheckBox.type = 'checkbox';
    whitelistedCheckBox.title = 'whitelist';
    whitelistedCheckBox.classList.add('tableCheckBox');
    whitelistedCheckBox.addEventListener('change', async function(e) {
      if (e.target.checked) {
        var adding = addWhitelistEntry(trimSubdomains(activeTabUrl), e.target.parentElement.parentElement.attachedEntry.name, 'd');
        adding.then(function() {
          updateActiveTabsCounts();
          fillSiteInfo();
        }, logError);
      } else {
        await deleteWhitelistEntry(trimSubdomains(activeTabUrl), e.target.parentElement.parentElement.attachedEntry.name, 'd');
        updateActiveTabsCounts();
        fillSiteInfo();
      }
    });
    td = document.createElement('TD');
    td.appendChild(whitelistedCheckBox);
    td.addEventListener('click', function(e) {
      if (e.target !== this) {
        return;
      }
      this.children[0].checked = !this.children[0].checked;
      var evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', false, true);
      this.children[0].dispatchEvent(evt);
    });
    tr.appendChild(td);
    // edit icon
    editIcon = document.createElement('IMG');
    editIcon.src = '/icons/edit.svg';
    editIcon.alt = 'edit';
    editIcon.title = 'edit';
    editIcon.classList.add('tableIcon');
    editIcon.classList.add('tableIconDisabled');
    td = document.createElement('TD');
    td.appendChild(editIcon);
    tr.appendChild(td);
    // delete icon
    deleteIcon = document.createElement('IMG');
    deleteIcon.src = '/icons/trash-alt.svg';
    deleteIcon.alt = 'delete';
    deleteIcon.title = 'delete';
    deleteIcon.classList.add('tableIcon');
    deleteIcon.addEventListener('click', async function(e) {
      await deleteDomStorageEntry(activeTabId, e.target.parentElement.parentElement.attachedEntry);
      fillSiteInfo();
      updateActiveTabsCounts();
    });
    td = document.createElement('TD');
    td.appendChild(deleteIcon);
    tr.appendChild(td);
    // add row to table body
    newTableBody.appendChild(tr);
  });
  // replace old table body with new one
  domStorageTable.replaceChild(newTableBody, domStorageTable.childNodes[5]);
}

function fillCookieEditor(cookie, domain) {
  // fills the cookie editor ui elements with the given values
  // reset error text
  cookieEditorError.textContent = "";
  if (cookie !== null) {
    // existing cookie
    cookieInEditor = cookie;
    cookieDomainTextBox.value = cookie.domain;
    cookieHostOnly.checked = cookie.hostOnly;
    cookieNameTextBox.value = cookie.name;
    cookieValueTextBox.value = cookie.value;
    cookieSessionCookie.checked = cookie.session;
    cookiePersistent.checked = !cookie.session;
    if (cookie.session) {
      var expDate = new Date();
      expDate.setDate(expDate.getDate() + 1);
    } else {
      expDate = new Date(cookie.expirationDate * 1000);
    }
    cookieDate.valueAsDate = expDate;
    var hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`;
    var minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`;
    cookieTime.value = `${hour}:${minute}`;
    cookiePathTextBox.value = cookie.path;
    cookieFirstPartyDomainTextBox.value = cookie.firstPartyDomain;
    cookieSecure.checked = cookie.secure;
    cookieHttpOnly.checked = cookie.httpOnly;
    cookieDeleteButton.disabled = false;
  } else {
    // new cookie
    cookieInEditor = null;
    cookieDomainTextBox.value = domain;
    cookieHostOnly.checked = true;
    cookieNameTextBox.value = '';
    cookieValueTextBox.value = '';
    cookieSessionCookie.checked = false;
    cookiePersistent.checked = true;
    expDate = new Date();
    expDate.setDate(expDate.getDate() + 1);
    cookieDate.valueAsDate = expDate;
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`;
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`;
    cookieTime.value = `${hour}:${minute}`;
    cookiePathTextBox.value = '/';
    cookieFirstPartyDomainTextBox.value = '';
    cookieSecure.checked = false;
    cookieHttpOnly.checked = false;
    cookieDeleteButton.disabled = true;
  }
}

function fillDomStorageEditor(entry, domain) {
  // fills the dom storage editor ui elements with the given values
  // reset error text
  domStorageEditorError.textContent = "";
  if (entry !== null) {
    // existing entry
    domStorageEntryInEditor = entry;
    domStorageDomainTextBox.value = entry.domain;
    domStorageNameTextBox.value = entry.name;
    domStorageValueTextBox.value = entry.value;
    if (entry.permanence === 'permanent') {
      domStorageTemporary.checked = false;
      domStoragePermanent.checked = true;
    } else {
      domStorageTemporary.checked = true;
      domStoragePermanent.checked = false;
    }
    domStorageDeleteButton.disabled = false;
  } else {
    // new entry
    domStorageEntryInEditor = null;
    domStorageDomainTextBox.value = domain;
    domStorageNameTextBox.value = '';
    domStorageValueTextBox.value = '';
    domStorageTemporary.checked = false;
    domStoragePermanent.checked = true;
    domStorageDeleteButton.disabled = true;
  }
}

function showView(view) {
  // shows the given view area (div) and hides the other ones
  const viewAreas = [mainView, cookieEditor, domStorageEditor];
  viewAreas.forEach(function(item) {
    item.classList.add('hidden');
  });
  view.classList.remove('hidden');
}

function toggleAdvancedProperties() {
  // toggles the advanced property area visibility in cookie editor
  var section = advancedCookieProperties;
  section.classList.toggle('hidden');
  if (window.getComputedStyle(section).getPropertyValue('display') === 'none') {
    cookieAdvancedToggle.innerText = '[show advanced]';
  } else {
    cookieAdvancedToggle.innerText = '[hide advanced]';
  }
}

function getBehaviourString(behaviour) {
  // returns the correct string for each behaviour number
  switch (behaviour) {
    case 0:
      // deny
      return 'deny all cookies';
      break;
    case 1:
      // allow session
      return 'allow session cookies only';
      break;
    case 2:
      // allow all
      return 'allow all cookies';
      break;
    default:
      // invalid
      return 'invalid behaviour';
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  firstPartyDomainArea = document.getElementById('firstPartyDomainArea');
  denyOption = document.getElementById('denyOption');
  sessionOption = document.getElementById('sessionOption');
  allowOption = document.getElementById('allowOption');
  slider = document.getElementById('slider');
  useSiteBehaviourLbl = document.getElementById('useSiteBehaviourLbl');
  useSiteBehaviourIcon = document.getElementById('useSiteBehaviourIcon');
  useTempBehaviourArea = document.getElementById('useTempBehaviourArea');
  useSiteBehaviourArea = document.getElementById('useSiteBehaviourArea');
  useTempBehaviour = document.getElementById('useTempBehaviour');
  useSiteBehaviour = document.getElementById('useSiteBehaviour');
  headline = document.getElementById('headline');
  cookieStore = document.getElementById('cookieStore');
  nonHttpInfo = document.getElementById('nonHttpInfo');
  mainView = document.getElementById('mainView');
  cookieEditor = document.getElementById('cookieEditor');
  domStorageEditor = document.getElementById('domStorageEditor');
  cookieTable = document.getElementById('cookieTable');
  domStorageTable = document.getElementById('domStorageTable');
  cookieDomainTextBox = document.getElementById('cookieDomainTextBox');
  cookieHostOnly = document.getElementById('cookieHostOnly');
  cookieNameTextBox = document.getElementById('cookieNameTextBox');
  cookieValueTextBox = document.getElementById('cookieValueTextBox');
  cookieSessionCookie = document.getElementById('cookieSessionCookie');
  cookiePersistent = document.getElementById('cookiePersistent');
  cookieDate = document.getElementById('cookieDate');
  cookieTime = document.getElementById('cookieTime');
  cookiePathTextBox = document.getElementById('cookiePathTextBox');
  cookieFirstPartyDomainTextBox = document.getElementById('cookieFirstPartyDomainTextBox');
  cookieSecure = document.getElementById('cookieSecure');
  cookieHttpOnly = document.getElementById('cookieHttpOnly');
  cookieDeleteButton = document.getElementById('cookieDeleteButton');
  domStorageDomainTextBox = document.getElementById('domStorageDomainTextBox');
  domStorageNameTextBox = document.getElementById('domStorageNameTextBox');
  domStorageValueTextBox = document.getElementById('domStorageValueTextBox');
  domStorageTemporary = document.getElementById('domStorageTemporary');
  domStoragePermanent = document.getElementById('domStoragePermanent');
  domStorageDeleteButton = document.getElementById('domStorageDeleteButton');
  makeRulePerm = document.getElementById('makeRulePerm');
  advancedCookieProperties = document.getElementById('advancedCookieProperties');
  cookieAdvancedToggle = document.getElementById('cookieAdvancedToggle');
  cookieCancelButton = document.getElementById('cookieCancelButton');
  domStorageCancelButton = document.getElementById('domStorageCancelButton');
  cookieSaveButton = document.getElementById('cookieSaveButton');
  cookieEditorError = document.getElementById('cookieEditorError');
  domStorageEditorError = document.getElementById('domStorageEditorError');
  domStorageSaveButton = document.getElementById('domStorageSaveButton');
  cookieAddIcon = document.getElementById('cookieAddIcon');
  domAddIcon = document.getElementById('domAddIcon');
  cookieDeleteAllIcon = document.getElementById('cookieDeleteAllIcon');
  domDeleteAllIcon = document.getElementById('domDeleteAllIcon');
  optionsDropdown = document.getElementById('optionsDropdown');
  optionsImage = document.getElementById('optionsImage');
  dropdownItemSettings = document.getElementById('dropdownItemSettings');
  dropdownItemClearTemp = document.getElementById('dropdownItemClearTemp');
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  slider.addEventListener('change', function() {
    enableSiteException(true);
  });
  makeRulePerm.addEventListener('click', function() {
    enableSiteException(false);
  });
  useTempBehaviour.addEventListener('click', function() {
    enableSiteException(true);
  });
  useSiteBehaviour.addEventListener('click', async function() {
    await deleteSiteException(activeTabUrl, true);
    fillSiteInfo();
  });
  useSiteBehaviourIcon.addEventListener('click', async function() {
    await deleteSiteException(activeTabUrl, false);
    fillSiteInfo();
  });
  cookieCancelButton.addEventListener('click', function() {
    showView(mainView);
  });
  domStorageCancelButton.addEventListener('click', function() {
    showView(mainView);
  });
  cookieDeleteButton.addEventListener('click', async function() {
    await deleteCookie(cookieInEditor);
    fillSiteInfo();
    showView(mainView);
    updateActiveTabsCounts();
  });
  domStorageDeleteButton.addEventListener('click', async function() {
    await deleteDomStorageEntry(activeTabId, domStorageEntryInEditor);
    fillSiteInfo();
    showView(mainView);
    updateActiveTabsCounts();
  });
  cookieSaveButton.addEventListener('click', function() {
    var adding = addCookie(cookieNameTextBox.value, cookieValueTextBox.value, cookieDomainTextBox.value, cookiePathTextBox.value, cookieSessionCookie.checked, cookieDate.valueAsDate, cookieTime.valueAsDate, cookieHostOnly.checked, cookieSecure.checked, cookieHttpOnly.checked, activeTabCookieStore, cookieFirstPartyDomainTextBox.value, cookieInEditor);
    adding.then(function() {
      // return to overview
      updateActiveTabsCounts();
      showView(mainView);
      fillSiteInfo();
    }, function(error) {
      cookieEditorError.textContent = error.message;
    });
  });
  domStorageSaveButton.addEventListener('click', function() {
    var adding = addDomStorageEntry(activeTabId, domStoragePermanent.checked, domStorageNameTextBox.value, domStorageValueTextBox.value, domStorageEntryInEditor);
    adding.then(function() {
      // return to overview
      updateActiveTabsCounts();
      fillSiteInfo();
      showView(mainView);
    }, function(error) {
      domStorageEditorError.textContent = error.message;
    });
  });
  cookieAddIcon.addEventListener('click', function() {
    fillCookieEditor(null, (new URL(activeTabUrl)).hostname);
    showView(cookieEditor);
  });
  domAddIcon.addEventListener('click', function() {
    fillDomStorageEditor(null, (new URL(activeTabUrl)).hostname);
    showView(domStorageEditor);
  });
  cookieAdvancedToggle.addEventListener('click', function() {
    toggleAdvancedProperties();
  });
  denyOption.addEventListener('click', function() {
    slider.value = 0;
    enableSiteException(true);
  });
  sessionOption.addEventListener('click', function() {
    slider.value = 1;
    enableSiteException(true);
  });
  allowOption.addEventListener('click', function() {
    slider.value = 2;
    enableSiteException(true);
  });
  cookieDeleteAllIcon.addEventListener('click', async function() {
    await deleteAllCookies(activeTabUrl, activeTabCookieStore);
    updateActiveTabsCounts();
    fillSiteInfo();
  });
  domDeleteAllIcon.addEventListener('click', async function() {
    await clearTabDomStorage(activeTabId);
    updateActiveTabsCounts();
    fillSiteInfo();
  });
  optionsImage.addEventListener('click', function() {
    optionsImage.classList.toggle('active');
    optionsDropdown.classList.toggle('hidden');
  });
  window.addEventListener('click', function(e) {
    if (!e.target.matches('#optionsImage') && !e.target.matches('#optionsImagePath')) {
      if (window.getComputedStyle(optionsDropdown).getPropertyValue('display') === 'block') {
        optionsDropdown.classList.add('hidden');
        optionsImage.classList.remove('active');
      }
    }
  });
  dropdownItemSettings.addEventListener('click', function() {
    var creating = browser.tabs.create({
      url: '/options.html'
    });
    creating.then(function() {}, logError);
  });
  dropdownItemClearTemp.addEventListener('click', async function() {
    await clearTempSiteExceptions();
    fillSiteInfo();
  });
  // info icons
  var infoIcons = document.getElementsByClassName('infoIcon');
  var i;
  for (i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', function(e) {
      e.stopPropagation();
      sendInfoMessage(e.target.title);
    });
  }
}