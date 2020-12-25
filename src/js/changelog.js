'use strict'
// show update message when there is the updated uri param
document.addEventListener('DOMContentLoaded', async _ => {
  let searchParams = new URLSearchParams(window.location.search)
  if (searchParams.get('updated') === 'true') {
    document.getElementById('updateMessage').classList.remove("hidden")
  }
})