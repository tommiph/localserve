/* Derive the address from this page; never ship a configured server IP. */
(function () {
  'use strict';
  document.getElementById('server-address').value = location.origin;
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.hostname === '[::1]') {
    document.getElementById('lan-hint').textContent = 'Open this page using the server’s private LAN address on your Android device.';
  }
}());
