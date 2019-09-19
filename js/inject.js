'use strict';
/*
 * this script is injected into websites using a script tag to be able to overwrite the functions used by the website's js
 */
let _setItem = Storage.prototype.setItem;
Storage.prototype.setItem = function(name, value) {
  window.postMessage({
    type: 'cookieRipper_domStorageSet',
    persistent: this === window.localStorage,
    name: name,
    value: value
  }, window.location.href);
  _setItem.apply(this, arguments);
}