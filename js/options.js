'use strict';
// ui elements
var slider, enableCookieCounterCheckbox, successText, denyOption, sessionOption, allowOption, saveButton, infoIcons;
document.addEventListener('DOMContentLoaded', function() {
  assignUiElements();
  addEventlisteners();
  restoreOptions();
});

function saveOptions() {
  // saves the options from ui
  var defaultBehaviour = slider.value;
  var enableCookieCounter = enableCookieCounterCheckbox.checked;
  var setting = browser.storage.sync.set({
    defaultBehaviour: defaultBehaviour,
    enableCookieCounter: enableCookieCounter
  });
  setting.then(function() {
    successText.textContent = 'Settings were saved!';
    setTimeout(function() {
      successText.textContent = '';
    }, 1000);
  }, logError);
  callLoadSettings();
}

function restoreOptions() {
  // loads the current options and puts them into the ui
  var getting = browser.storage.sync.get({
    // defaults
    defaultBehaviour: 2,
    enableCookieCounter: false
  });
  getting.then(function(items) {
    slider.value = items.defaultBehaviour;
    highlightActiveOption(Number(items.defaultBehaviour));
    enableCookieCounterCheckbox.checked = items.enableCookieCounter;
  }, logError);
}

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

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  slider = document.getElementById('slider');
  enableCookieCounterCheckbox = document.getElementById('enableCookieCounterCheckbox');
  successText = document.getElementById('successText');
  denyOption = document.getElementById('denyOption');
  sessionOption = document.getElementById('sessionOption');
  allowOption = document.getElementById('allowOption')
  saveButton = document.getElementById('saveButton');
  infoIcons = document.getElementsByClassName('infoIcon');
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  slider.addEventListener('change', function() {
    highlightActiveOption(Number(this.value));
  });
  saveButton.addEventListener('click', saveOptions);
  denyOption.addEventListener('click', function() {
    slider.value = 0;
    highlightActiveOption(0);
  });
  sessionOption.addEventListener('click', function() {
    slider.value = 1;
    highlightActiveOption(1);
  });
  allowOption.addEventListener('click', function() {
    slider.value = 2;
    highlightActiveOption(2);
  });
  // info icons
  var i;
  for (i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', function(e) {
      e.stopPropagation();
      alert(e.target.title);
    });
  }
}