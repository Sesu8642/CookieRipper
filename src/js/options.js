'use strict'
// ui elements
let slider, enableCookieCounterCheckbox, successText, denyOption, sessionOption, allowOption, saveButton, infoIcons
document.addEventListener('DOMContentLoaded', function() {
  assignUiElements()
  addEventlisteners()
  restoreOptions()
})
async function saveOptions() {
  // saves the options from ui
  try {
    let defaultBehaviour = slider.value
    let enableCookieCounter = enableCookieCounterCheckbox.checked
    await browser.storage.sync.set({
      defaultBehaviour: defaultBehaviour,
      enableCookieCounter: enableCookieCounter
    })
    successText.textContent = 'Settings were saved!'
    setTimeout(function() {
      successText.textContent = ''
    }, 1000)
    await bgPage.loadSettings()
  } catch (e) {
    console.error(e)
  }
}
async function restoreOptions() {
  // loads the current options and puts them into the ui
  try {
    let items = await browser.storage.sync.get({
      // defaults
      defaultBehaviour: 1,
      enableCookieCounter: false
    })
    slider.value = items.defaultBehaviour
    highlightActiveOption(Number(items.defaultBehaviour))
    enableCookieCounterCheckbox.checked = items.enableCookieCounter
  } catch (e) {
    console.error(e)
  }
}

function highlightActiveOption(option) {
  // highlights the active option in ui
  switch (option) {
    case 0:
      // deny
      denyOption.classList.add('selectedBehaviour')
      sessionOption.classList.remove('selectedBehaviour')
      allowOption.classList.remove('selectedBehaviour')
      break
    case 1:
      // allow session
      denyOption.classList.remove('selectedBehaviour')
      sessionOption.classList.add('selectedBehaviour')
      allowOption.classList.remove('selectedBehaviour')
      break
    case 2:
      // allow all
      denyOption.classList.remove('selectedBehaviour')
      sessionOption.classList.remove('selectedBehaviour')
      allowOption.classList.add('selectedBehaviour')
      break
    default:
      // invalid
  }
}

function assignUiElements() {
  // gets all the needed ui elements and stores them in variables for later use
  slider = document.getElementById('slider')
  enableCookieCounterCheckbox = document.getElementById('enableCookieCounterCheckbox')
  successText = document.getElementById('successText')
  denyOption = document.getElementById('denyOption')
  sessionOption = document.getElementById('sessionOption')
  allowOption = document.getElementById('allowOption')
  saveButton = document.getElementById('saveButton')
  infoIcons = document.getElementsByClassName('infoIcon')
}

function addEventlisteners() {
  // adds all the event listeners to ui elements
  slider.addEventListener('change', _ => {
    highlightActiveOption(Number(this.value))
  })
  saveButton.addEventListener('click', saveOptions)
  denyOption.addEventListener('click', _ => {
    slider.value = 0
    highlightActiveOption(0)
  })
  sessionOption.addEventListener('click', _ => {
    slider.value = 1
    highlightActiveOption(1)
  })
  allowOption.addEventListener('click', _ => {
    slider.value = 2
    highlightActiveOption(2)
  })
  // info icons
  for (let i = 0; i < infoIcons.length; i++) {
    infoIcons[i].addEventListener('click', async e => {
      try {
        e.stopPropagation()
        await sendInfoMessage(e.target.title)
      } catch (e) {
        console.error(e)
      }
    })
  }
}