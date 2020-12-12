'use strict'
/*
 * this script is injected into websites using a script tag to be able to overwrite the functions used by the website's js
 */
const CONVERT_PREFIX = '__CR_'
// overwrite setItem (applies to both local and session storage)
let _setItem = Object.getPrototypeOf(localStorage).setItem
let _localStorage = window.localStorage
let _sessionStorage = window.sessionStorage
Object.getPrototypeOf(localStorage).setItem = function(name, value) {
  // prevent websites from trying to manupulate the extension by using the prefix themselves
  if (name.startsWith(CONVERT_PREFIX)) {
    return
  }
  window.postMessage({
    type: 'cookieRipper_domStorageSet',
    persistent: this === _localStorage,
    name: name,
    value: value
  }, window.location.href)
  _setItem.apply(this, arguments)
}
// overwrite getItem(applies to both local and session storage)
let _getItem = Object.getPrototypeOf(localStorage).getItem
Object.getPrototypeOf(localStorage).getItem = function(name) {
  if (this === _localStorage) {
    // when reading from local storage and there is no item, read from session storage with prefix instead
    let result = _getItem.apply(this, arguments)
    if (result !== null) {
      return result
    } else {
      return _getItem.apply(_sessionStorage, [CONVERT_PREFIX + name])
    }
  } else {
    // when reading from session storage and an item starts with the prefix, ignore it
    if (name == null || name.startsWith(CONVERT_PREFIX)) {
      return null
    } else {
      return _getItem.apply(this, arguments)
    }
  }
}
// overwrite setter (storage.key=value) as well as getters for values, length and key (key is for accessing properties by index)
let localStorageProxy = new Proxy(localStorage, {
  set: function(target, name, value, receiver) {
    // prevent websites from trying to manupulate the extension by using the prefix themselves
    if (name.startsWith(CONVERT_PREFIX)) {
      return
    }
    window.postMessage({
      type: 'cookieRipper_domStorageSet',
      persistent: true,
      name: name,
      value: value
    }, window.location.href)
    return Reflect.set(target, name, value)
  },
  get: function(target, property, receiver) {
    // overwrite length (include the converted entries from session storage)
    if (property === 'length') {
      let length = target.length
      for (let i = 0; i < _sessionStorage.length; i++) {
        name = _sessionStorage.key(i)
        // entries might exist in the original and converted form for a brief moment of time; do not count those twice
        if (name.startsWith(CONVERT_PREFIX) && target.getItem(name) === null) {
          length++
        }
      }
      return length
    }
    let val = target[property]
    if (typeof val !== 'function') {
      // reading data using storage.key
      // when reading from local storage and there is no item, read from session storage with prefix instead
      return val !== undefined ? val : _sessionStorage[CONVERT_PREFIX + property]
    }
    // overwrite key function (include the converted entries from session storage)
    if (property === 'key') {
      return function(...args) {
        if (args[0] > _localStorage.length - 1) {
          // localStorage has no more keys but sessionStorage may have some more that are converted
          let extra = args[0] - _localStorage.length + 1
          for (let i = 0; i < _sessionStorage.length; i++) {
            if (_sessionStorage.key(i).startsWith(CONVERT_PREFIX)) {
              extra--
              if (extra === 0) {
                return _sessionStorage.key(i).substring(CONVERT_PREFIX.length)
              }
            }
          }
          return null
        } else {
          let thisVal = this === receiver ? target : this
          return Reflect.apply(val, thisVal, args)
        }
      }
    }
    // overwrite hasOwnProperty
    if (property === 'hasOwnProperty') {
      return function(key) {
        return target.hasOwnProperty(key) || _sessionStorage.hasOwnProperty(CONVERT_PREFIX + key)
      }
    }
    // overwrite removeItem function (redirect to session storage when prefix is given)
    if (property === "removeItem") {
      return function(...args) {
        if (_sessionStorage[CONVERT_PREFIX + args[0]] !== undefined) {
          return _sessionStorage.removeItem(CONVERT_PREFIX + args[0])
        } else {
          return target.removeItem(args[0])
        }
      }
    }
    // overwrite clear function (also remove prefixed entries from session storage)
    if (property === "clear") {
      for (let i = 0; i < _sessionStorage.length; i++) {
        let key = _sessionStorage.key(i)
        if (key.startsWith(CONVERT_PREFIX)) {
          _sessionStorage.removeItem(key)
          i--;
        }
      }
      // fall through
    }
    // just proxy all the other functions
    return function(...args) {
      let thisVal = this === receiver ? target : this
      let result = Reflect.apply(val, thisVal, args)
      return result
    }
  },
  // handle for key in obj
  ownKeys: function(target) {
    let keys = []
    for (let i = 0; i < target.length; i++) {
      keys.push(target.key(i))
    }
    for (let i = 0; i < _sessionStorage.length; i++) {
      let possibleKey = _sessionStorage.key(i)
      if (possibleKey.startsWith(CONVERT_PREFIX)) {
        keys.push(_sessionStorage.key(i).substring(CONVERT_PREFIX.length))
      }
    }
    return keys
  },
  // handle hasOwnProperty
  getOwnPropertyDescriptor: function(target, key) {
    let val = target[key] === undefined ? _sessionStorage[CONVERT_PREFIX + key] : target[key]
    return val === undefined ? undefined : {
      value: val,
      enumerable: true,
      configurable: true
    }
  }
})
delete window.localStorage
window.localStorage = localStorageProxy
let sessionStorageProxy = new Proxy(sessionStorage, {
  set: function(target, name, value, receiver) {
    // prevent websites from trying to manupulate the extension by using the prefix themselves
    if (name.startsWith(CONVERT_PREFIX)) {
      return
    }
    window.postMessage({
      type: 'cookieRipper_domStorageSet',
      persistent: false,
      name: name,
      value: value
    }, window.location.href)
    let result = Reflect.set(target, name, value)
    return result
  },
  get: function(target, property, receiver) {
    // overwrite length (exclude the converted entries here from local storage)
    if (property === 'length') {
      let length = 0
      for (let i = 0; i < target.length; i++) {
        if (!target.key(i).startsWith(CONVERT_PREFIX)) {
          length++
        }
      }
      return length
    }
    let val = target[property]
    if (typeof val !== 'function') {
      // reading data using storage.key
      // when reading from session storage and an item starts with the prefix, ignore it
      if (property.startsWith(CONVERT_PREFIX)) {
        return undefined
      } else {
        return val
      }
    }
    // overwrite key function (exclude the converted entries here from local storage)
    if (property === 'key') {
      return function(...args) {
        let correctedIndex = 0
        for (let i = 0; i < target.length; i++) {
          let key = target.key(i)
          if (!key.startsWith(CONVERT_PREFIX)) {
            if (correctedIndex === args[0]) {
              return key
            }
            correctedIndex++
          }
        }
        return null
      }
    }
    // overwrite hasOwnProperty
    if (property === 'hasOwnProperty') {
      return function(key) {
        return key.startsWith(CONVERT_PREFIX) ? false : target.hasOwnProperty(key)
      }
    }
    // overwrite removeItem function (ignore entries starting with the prefix)
    if (property === "removeItem") {
      return function(...args) {
        if (args[0].startsWith(CONVERT_PREFIX)) {
          return
        }
        let thisVal = this === receiver ? target : this
        let result = Reflect.apply(val, thisVal, args)
        return result
      }
    }
    // overwrite clear function (do not remove prefixed entries)
    if (property === "clear") {
      for (let i = 0; i < target.length; i++) {
        let key = target.key(i)
        if (!key.startsWith(CONVERT_PREFIX)) {
          _sessionStorage.removeItem(key)
          i--
        }
      }
      return function() {}
    }
    // just proxy all the other functions
    return function(...args) {
      let thisVal = this === receiver ? target : this
      let result = Reflect.apply(val, thisVal, args)
      return result
    }
  },
  // handle for key in obj
  ownKeys: function(target) {
    let keys = []
    for (let i = 0; i < target.length; i++) {
      let possibleKey = target.key(i)
      if (!possibleKey.startsWith(CONVERT_PREFIX)) {
        keys.push(possibleKey)
      }
    }
    return keys
  },
  // handle hasOwnProperty
  getOwnPropertyDescriptor: function(target, key) {
    return target[key].startsWith(CONVERT_PREFIX) ? undefined : {
      value: target[key],
      enumerable: true,
      configurable: true
    };
  }
})
delete window.sessionStorage
window.sessionStorage = sessionStorageProxy
// when done, delete unwanted entries the site may have placed already
window.postMessage({
  type: 'cookieRipper_injectedScriptIsDone'
}, window.location.href)