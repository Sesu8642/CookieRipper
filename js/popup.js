'use strict';
let activeTabUrl, activeTabDomain, activeTabId, activeTabCookieStore;
//selected cookie for the cookie editor
let cookieInEditor = null;
let domStorageEntryInEditor = null;
let cookieList = [];
let unwantedCookieList = [];
let domList = [];
let unwantedDomList = [];
let contentScriptavailable = true;
const connectToContentScriptMaxRetries = 5;
const connectToContentScriptRetryDelayMs = 50;
// ui elements
let firstPartyDomainArea, denyOption, sessionOption, allowOption, slider, useSiteBehaviourLbl, useSiteBehaviourIcon, useTempBehaviourArea, useSiteBehaviourArea, useTempBehaviour, useSiteBehaviour, headline, cookieStore, nonHttpInfo, mainView, cookieTable, domStorageTable, cookieDomainTextBox, cookieHostOnly, cookieNameTextBox, cookieValueTextBox, cookieSessionCookie, cookiePersistent, cookieDate, cookieTime, cookiePathTextBox, cookieFirstPartyDomainTextBox, cookieSecure, cookieHttpOnly, cookieDeleteButton, domStorageDomainTextBox, domStorageNameTextBox, domStorageValueTextBox, domStorageTemporary, domStoragePermanent, domStorageDeleteButton, makeRulePerm, cookieEditor, domStorageEditor, advancedCookieProperties, cookieAdvancedToggle, cookieCancelButton, domStorageCancelButton, cookieSaveButton, cookieEditorError, domStorageEditorError, domStorageSaveButton, cookieAddIcon, domAddIcon, cookieDeleteAllIcon, domDeleteAllIcon, optionsDropdown, optionsImage, dropdownItemSettings, dropdownItemClearTemp;
document.addEventListener('DOMContentLoaded', async function() {
  try {
    assignUiElements();
    addEventlisteners();
    let tab = await getActiveTab();
    activeTabUrl = tab.url;
    activeTabDomain = getRuleRelevantPartofDomain(activeTabUrl);
    activeTabId = tab.id;
    activeTabCookieStore = await getTabCookieStore(activeTabId);
    if (firstPartyIsolationSupported) {
      firstPartyDomainArea.classList.remove('hidden');
    }
    await fillSiteInfo();
  } catch (e) {
    console.error(e);
  }
});
async function enableSiteException(temp) {
  // adds a site exception
  return new Promise(async function(resolve, reject) {
    try {
      let option = Number(slider.value);
      await addSiteException(activeTabDomain, option, temp);
      await fillSiteInfo();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function fillSiteInfo() {
  // puts site specific info in ui including cookies and dom storage
  return new Promise(async function(resolve, reject) {
    try {
      if (activeTabUrl.startsWith('http')) {
        headline.textContent = `Settings For ${activeTabDomain}`;
        cookieStore.textContent = `Cookie Store ID: ${activeTabCookieStore}`;
        let permSiteException, tempSiteException;
        [permSiteException, tempSiteException] = await Promise.all([getSiteException(activeTabDomain, false), getSiteException(activeTabDomain, true)]);
        await Promise.all([depictPermException(permSiteException), depictTempException(permSiteException, tempSiteException)]);
        // get all the dom storage and cookies
        await Promise.all([fillCookieList(), fillUnwantedCookieList()]);
        await buildCookieTableBody();
        if (contentScriptavailable) {
          try {
            await fillDomStorageList();
            await fillUnwantedDomStorageList();
          } catch (e) {
            // getting dom storage can fail if unable to inject the content script
            console.warn(e);
          }
        }
        await buildDomStorageTableBody();
      } else {
        nonHttpInfo.classList.remove('hidden');
        mainView.classList.add('hidden');
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
  async function depictPermException(permSiteException) {
    // deal with permanent exception
    return new Promise(async function(resolve, reject) {
      try {
        if (permSiteException === null) {
          useSiteBehaviourLbl.textContent = `use site behaviour (default; ${getBehaviourString(await callGetDefaultBehaviour())})`;
          useSiteBehaviourIcon.classList.add('hidden');
        } else {
          useSiteBehaviourLbl.textContent = `use site behaviour (${getBehaviourString(permSiteException)})`;
          useSiteBehaviourIcon.classList.remove('hidden');
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }
  async function depictTempException(permSiteException, tempSiteException) {
    // deal with temporary exception
    return new Promise(async function(resolve, reject) {
      try {
        if (tempSiteException !== null) {
          useTempBehaviourArea.classList.add('selectedBehaviourArea');
          useSiteBehaviourArea.classList.remove('selectedBehaviourArea');
          slider.value = tempSiteException;
          highlightActiveOption(tempSiteException);
          useTempBehaviour.checked = true;
          useSiteBehaviour.checked = false;
        } else if (permSiteException !== null) {
          useTempBehaviourArea.classList.remove('selectedBehaviourArea');
          useSiteBehaviourArea.classList.add('selectedBehaviourArea');
          slider.value = permSiteException;
          useTempBehaviour.checked = false;
          useSiteBehaviour.checked = true;
          highlightActiveOption(permSiteException);
        } else {
          useTempBehaviourArea.classList.remove('selectedBehaviourArea');
          useSiteBehaviourArea.classList.add('selectedBehaviourArea');
          slider.value = await callGetDefaultBehaviour();
          useTempBehaviour.checked = false;
          useSiteBehaviour.checked = true;
          highlightActiveOption(await callGetDefaultBehaviour());
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }
  async function highlightActiveOption(option) {
    // highlights the active option in ui
    return new Promise(function(resolve, reject) {
      try {
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
            reject(`Invalid behaviour: ${option}`);
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }
}
async function fillCookieList() {
  // gets cookies and stores them in cookieList
  return new Promise(async function(resolve, reject) {
    try {
      cookieList = [];
      // get all the cookies
      let cookies = await getAllCookies({
        url: activeTabUrl,
        storeId: activeTabCookieStore
      });
      let promises = cookies.map(async function(cookie) {
        try {
          let whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c')
          cookie.whitelisted = whitelisted;
          // add cookie to list
          cookieList.push(cookie);
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
async function fillUnwantedCookieList() {
  // gets unwanted cookies and stores them in unwantedCookieList
  return new Promise(async function(resolve, reject) {
    try {
      unwantedCookieList = [];
      let fullDomain = (new URL(activeTabUrl)).hostname;
      let unwantedCookies = await callgetUnwantedCookiesForDomain(activeTabDomain);
      unwantedCookies.forEach(function(cookie) {
        // remove leading . from cookie domain for comparison
        let cookieDomain = (cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain);
        if (fullDomain === cookieDomain || (!cookie.hostOnly && fullDomain.endsWith(`${cookieDomain}`))) {
          unwantedCookieList.push(cookie);
        }
      });
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function fillDomStorageList(retries = 0) {
  // gets dom storage and stores it in domList
  return new Promise(async function(resolve, reject) {
    try {
      domList = [];
      if (retries === connectToContentScriptMaxRetries) {
        contentScriptavailable = false;
        return reject(Error('Failed to connect to content script.'));
      }
      // get all the entries
      let response;
      try {
        response = await getTabDomStorage(activeTabId);
      } catch (e) {
        console.warn(e);
        console.warn('Trying again in 50 ms');
        // [UGLY] when injected script is not ready wait some ms and try again
        await new Promise(async function(resolve) {
          setTimeout(resolve, connectToContentScriptRetryDelayMs)
        });
        await fillDomStorageList(retries + 1);
      }
      let storageItems = [];
      // create array of entry objects first
      for (let i in response.localStorage) {
        let entry = {};
        entry.name = i;
        entry.value = response.localStorage[i];
        entry.domain = (new URL(activeTabUrl)).hostname;
        entry.permanence = 'permanent';
        entry.persistent = true;
        storageItems.push(entry);
      }
      for (let i in response.sessionStorage) {
        let entry = {};
        entry.name = i;
        entry.value = response.sessionStorage[i];
        entry.domain = (new URL(activeTabUrl)).hostname;
        entry.permanence = 'temporary';
        entry.persistent = false;
        storageItems.push(entry);
      }
      // add whitelist info
      let promises = storageItems.map(async function(storageItem) {
        try {
          let whitelisted = await getObjectWhitelistedState(storageItem.domain, storageItem.name, 'd');
          storageItem.whitelisted = whitelisted
          // add item to list
          domList.push(storageItem);
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
async function fillUnwantedDomStorageList() {
  // gets unwanted dom storage entries and stores them in unwantedDomList
  return new Promise(async function(resolve, reject) {
    try {
      let response = await getUnwantedDomStorageEntries(activeTabId);
      unwantedDomList = response.map(function(entry) {
        entry.domain = (new URL(activeTabUrl)).hostname;
        entry.permanence = entry.persistent ? 'permanent' : 'temporary';
        return entry;
      });
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function buildCookieTableBody() {
  // fills the table using the existing cookieList, unwantedCookieList
  return new Promise(function(resolve, reject) {
    try {
      let newTableBody = document.createElement('tbody');
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
        let tr = document.createElement('TR');
        let td;
        let editIcon, deleteIcon, whitelistedCheckBox;
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
            await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
          } else {
            await deleteWhitelistEntry(e.target.parentElement.parentElement.attachedCookie.domain, e.target.parentElement.parentElement.attachedCookie.name, 'c', null);
            // could be optimized with function that only checks that one cookie
            await deleteExistingUnwantedCookies(activeTabUrl, activeTabCookieStore);
            await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
          }
        });
        td = document.createElement('TD');
        td.appendChild(whitelistedCheckBox);
        td.addEventListener('click', function(e) {
          if (e.target !== this) {
            return;
          }
          this.children[0].checked = !this.children[0].checked;
          let evt = document.createEvent('HTMLEvents');
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
          await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
        });
        td = document.createElement('TD');
        td.appendChild(deleteIcon);
        tr.appendChild(td);
        // add row to table body
        newTableBody.appendChild(tr);
      });
      // add unwanted cookies to list
      unwantedCookieList.forEach(function(cookie) {
        let tr = document.createElement('TR');
        let td = document.createElement('TD');
        let editIcon, deleteIcon, whitelistedCheckBox;
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
            await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
          }
        });
        td = document.createElement('TD');
        td.appendChild(whitelistedCheckBox);
        td.addEventListener('click', function(e) {
          if (e.target !== this) {
            return;
          }
          this.children[0].checked = !this.children[0].checked;
          let evt = document.createEvent('HTMLEvents');
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
          await fillSiteInfo();
        });
        td = document.createElement('TD');
        td.appendChild(deleteIcon);
        tr.appendChild(td);
        // add row to table body
        newTableBody.appendChild(tr);
      });
      // replace old table body with new one
      cookieTable.replaceChild(newTableBody, cookieTable.childNodes[0]);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
async function buildDomStorageTableBody() {
  // fills the table using the existing domList, unwantedDomList
  return new Promise(function(resolve, reject) {
    try {
      let newTableBody = document.createElement('tbody');
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
        let tr = document.createElement('TR');
        let td;
        let editIcon, deleteIcon, whitelistedCheckBox;
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
            await addWhitelistEntry(e.target.parentElement.parentElement.attachedEntry.domain, e.target.parentElement.parentElement.attachedEntry.name, 'd');
            await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
          } else {
            await deleteWhitelistEntry(e.target.parentElement.parentElement.attachedEntry.domain, e.target.parentElement.parentElement.attachedEntry.name, 'd');
            await deleteExistingUnwantedDomStorageEntries(activeTabId);
            await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
          }
        });
        td = document.createElement('TD');
        td.appendChild(whitelistedCheckBox);
        td.addEventListener('click', function(e) {
          if (e.target !== this) {
            return;
          }
          this.children[0].checked = !this.children[0].checked;
          let evt = document.createEvent('HTMLEvents');
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
          await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
        });
        td = document.createElement('TD');
        td.appendChild(deleteIcon);
        tr.appendChild(td);
        // add row to table body
        newTableBody.appendChild(tr);
      });
      // add unwanted entries to list
      unwantedDomList.forEach(function(entry) {
        let tr = document.createElement('TR');
        let td;
        let editIcon, deleteIcon, whitelistedCheckBox;
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
            await addWhitelistEntry(e.target.parentElement.parentElement.attachedEntry.domain, e.target.parentElement.parentElement.attachedEntry.name, 'd');
            // whitelist does not differentiate between local and session storage
            let entryVariation1 = {
              name: e.target.parentElement.parentElement.attachedEntry.name,
              permanence: 'permanent'
            };
            let entryVariation2 = {
              name: e.target.parentElement.parentElement.attachedEntry.name,
              permanence: 'temporary'
            };
            await Promise.all([restoreUnwantedDomStorageEntry(activeTabId, entryVariation1), restoreUnwantedDomStorageEntry(activeTabId, entryVariation2)]);
            await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
          }
        });
        td = document.createElement('TD');
        td.appendChild(whitelistedCheckBox);
        td.addEventListener('click', function(e) {
          if (e.target !== this) {
            return;
          }
          this.children[0].checked = !this.children[0].checked;
          let evt = document.createEvent('HTMLEvents');
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
          await deleteUnwantedDomStorageEntry(activeTabId, e.target.parentElement.parentElement.attachedEntry);
          await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
        });
        td = document.createElement('TD');
        td.appendChild(deleteIcon);
        tr.appendChild(td);
        // add row to table body
        newTableBody.appendChild(tr);
      });
      // replace old table body with new one
      domStorageTable.replaceChild(newTableBody, domStorageTable.childNodes[5]);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function fillCookieEditor(cookie, domain) {
  // fills the cookie editor ui elements with the given values
  // reset error text
  cookieEditorError.textContent = "";
  let expDate, hour, minute;
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
      expDate = new Date();
      expDate.setDate(expDate.getDate() + 1);
    } else {
      expDate = new Date(cookie.expirationDate * 1000);
    }
    cookieDate.valueAsDate = expDate;
    hour = `${(expDate.getHours() < 10 ? '0' : '')}${expDate.getHours()}`;
    minute = `${(expDate.getMinutes() < 10 ? '0' : '')}${expDate.getMinutes()}`;
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
  let section = advancedCookieProperties;
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
  slider.addEventListener('change', async function() {
    try {
      await enableSiteException(true);
    } catch (e) {
      console.error(e);
    }
  });
  makeRulePerm.addEventListener('click', async function() {
    try {
      await enableSiteException(false);
    } catch (e) {
      console.error(e);
    }
  });
  useTempBehaviour.addEventListener('click', async function() {
    try {
      await enableSiteException(true);
    } catch (e) {
      console.error(e);
    }
  });
  useSiteBehaviour.addEventListener('click', async function() {
    try {
      await deleteSiteException(activeTabDomain, true);
      await fillSiteInfo();
    } catch (e) {
      console.error(e);
    }
  });
  useSiteBehaviourIcon.addEventListener('click', async function() {
    try {
      await deleteSiteException(activeTabDomain, false);
      await fillSiteInfo();
    } catch (e) {
      console.error(e);
    }
  });
  cookieCancelButton.addEventListener('click', function() {
    showView(mainView);
  });
  domStorageCancelButton.addEventListener('click', function() {
    showView(mainView);
  });
  cookieDeleteButton.addEventListener('click', async function() {
    try {
      await deleteSiteException(activeTabDomain, true);
      await deleteCookie(cookieInEditor);
      await fillSiteInfo();
      showView(mainView);
      await updateActiveTabsCounts();
    } catch (e) {
      console.error(e);
    }
  });
  domStorageDeleteButton.addEventListener('click', async function() {
    try {
      await deleteDomStorageEntry(activeTabId, domStorageEntryInEditor);
      await fillSiteInfo();
      showView(mainView);
      await updateActiveTabsCounts();
    } catch (e) {
      console.error(e);
    }
  });
  cookieSaveButton.addEventListener('click', async function() {
    try {
      await addCookie(cookieNameTextBox.value, cookieValueTextBox.value, cookieDomainTextBox.value, cookiePathTextBox.value, cookieSessionCookie.checked, cookieDate.valueAsDate, cookieTime.valueAsDate, cookieHostOnly.checked, cookieSecure.checked, cookieHttpOnly.checked, activeTabCookieStore, cookieFirstPartyDomainTextBox.value, cookieInEditor);
      // return to overview
      await updateActiveTabsCounts();
      showView(mainView);
      await fillSiteInfo();
    } catch (e) {
      cookieEditorError.textContent = e.message;
    }
  });
  domStorageSaveButton.addEventListener('click', async function() {
    try {
      await addDomStorageEntry(activeTabId, domStoragePermanent.checked, domStorageNameTextBox.value, domStorageValueTextBox.value, domStorageEntryInEditor);
      // return to overview
      await updateActiveTabsCounts();
      await fillSiteInfo();
      showView(mainView);
    } catch (e) {
      domStorageEditorError.textContent = e;
    }
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
  denyOption.addEventListener('click', async function() {
    try {
      slider.value = 0;
      await enableSiteException(true);
    } catch (e) {
      console.error(e);
    }
  });
  sessionOption.addEventListener('click', async function() {
    try {
      slider.value = 1;
      await enableSiteException(true);
    } catch (e) {
      console.error(e);
    }
  });
  allowOption.addEventListener('click', async function() {
    try {
      slider.value = 2;
      await enableSiteException(true);
    } catch (e) {
      console.error(e);
    }
  });
  cookieDeleteAllIcon.addEventListener('click', async function() {
    try {
      await deleteAllCookies(activeTabUrl, activeTabCookieStore);
      await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
    } catch (e) {
      console.error(e);
    }
  });
  domDeleteAllIcon.addEventListener('click', async function() {
    try {
      try {
        await clearTabDomStorage(activeTabId);
      } catch (e) {
        console.warn(e);
      }
      await Promise.all([updateActiveTabsCounts(), fillSiteInfo()]);
    } catch (e) {
      console.error(e);
    }
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
  dropdownItemSettings.addEventListener('click', async function() {
    try {
      await browser.tabs.create({
        url: '/options.html'
      });
    } catch (e) {
      console.error(e);
    }
  });
  dropdownItemClearTemp.addEventListener('click', async function() {
    try {
      await clearTempSiteExceptions();
      await fillSiteInfo();
    } catch (e) {
      console.error(e);
    }
  });
  // info icons
  let infoIcons = document.getElementsByClassName('infoIcon');
  for (let i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', async function(e) {
      try {
        e.stopPropagation();
        await sendInfoMessage(e.target.title);
      } catch (e) {
        console.error(e);
      }
    });
  }
}