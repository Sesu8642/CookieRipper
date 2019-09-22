'use strict';
/*
 * this script is injected into websites using a script tag to be able to overwrite the functions used by the website's js
 */
let _setItem = Storage.prototype.setItem;
Storage.prototype.setItem = function(name, value) {
  // overwrite setItem
  window.postMessage({
    type: 'cookieRipper_domStorageSet',
    persistent: this === window.localStorage,
    name: name,
    value: value
  }, window.location.href);
  _setItem.apply(this, arguments);
}
// overwrite setter (storage.key=value)
let localStorageProxy = new Proxy(localStorage, {
  set: function(target, name, value, receiver) {
    window.postMessage({
      type: 'cookieRipper_domStorageSet',
      persistent: true,
      name: name,
      value: value
    }, window.location.href);
    return Reflect.set(target, name, value, receiver);
  },
  get: function(target, property, receiver) {
    var val = target[property];
    if (typeof val !== 'function') return val;
    return function(...args) {
      var thisVal = this === receiver ? target : this;
      return Reflect.apply(val, thisVal, args);
    }
  }
})
delete window.localStorage;
window.localStorage = localStorageProxy;
let sessionStorageProxy = new Proxy(sessionStorage, {
  set: function(target, name, value, receiver) {
    window.postMessage({
      type: 'cookieRipper_domStorageSet',
      persistent: false,
      name: name,
      value: value
    }, window.location.href);
    return Reflect.set(target, name, value, receiver);
  },
  get: function(target, property, receiver) {
    var val = target[property];
    if (typeof val !== 'function') return val;
    return function(...args) {
      var thisVal = this === receiver ? target : this;
      return Reflect.apply(val, thisVal, args);
    }
  }
})
delete window.sessionStorage;
window.sessionStorage = sessionStorageProxy;
// when done, delete unwanted entries the site may have placed already
window.postMessage({
  type: 'cookieRipper_injectedScriptIsDone'
}, window.location.href);