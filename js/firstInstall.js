'use strict';
/* alert does not work from background page in ff */
alert('Thank you for installing Cookie Ripper!\nMake sure cookies are enabled in your browser and the third party cookie setting is adjusted to your liking (I suggest not accepting those). After that, adjust the cookie ripper default behaviour and you are good to go!');
window.location.replace(chrome.runtime.getURL('/options.html'));