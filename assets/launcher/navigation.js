/* Remote focus follows layout positions, independent of decorative transforms.
 * Grids use explicit rows so Down cannot select a lifted same-row neighbour. */
(function (root) {
  'use strict';
  function measure(element) {
    var left = 0, top = 0, current = element;
    while (current) {
      left += current.offsetLeft || 0;top += current.offsetTop || 0;
      var parent = current.offsetParent;
      if (parent) { left += parent.clientLeft || 0;top += parent.clientTop || 0; }
      current = parent;
    }
    current = element.parentNode;
    while (current) { left -= current.scrollLeft || 0;top -= current.scrollTop || 0;current = current.parentNode; }
    return {left:left,top:top,width:element.offsetWidth || 0,height:element.offsetHeight || 0,
      right:left + (element.offsetWidth || 0),bottom:top + (element.offsetHeight || 0)};
  }
  function center(item) { return item.rect.left + item.rect.width / 2; }
  function rows(items,group) {
    var result = [];
    items.filter(function (item) { return item.group === group; }).sort(function (a,b) {
      return Math.abs(a.rect.top - b.rect.top) > 4 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left;
    }).forEach(function (item) {
      var row = result[result.length - 1];
      if (!row || Math.abs(row[0].rect.top - item.rect.top) > 4) { row = [];result.push(row); }
      row.push(item);
    });
    return result;
  }
  function nearest(row,active) {
    var best = row[0], distance = Infinity;
    row.forEach(function (item) { var next = Math.abs(center(item) - center(active));if (next < distance) { best = item;distance = next; } });
    return best;
  }
  function spatial(items,active,code) {
    var origin = active.rect, x = center(active), y = origin.top + origin.height / 2, best = active, score = Infinity;
    items.forEach(function (item) {
      if (item === active) return;
      var rect = item.rect, dx = center(item) - x, dy = rect.top + rect.height / 2 - y;
      if (code === 37 && dx >= -1 || code === 39 && dx <= 1 || code === 38 && dy >= -1 || code === 40 && dy <= 1) return;
      var horizontal = code === 37 || code === 39;
      var across = horizontal ? Math.max(0,rect.top - origin.bottom,origin.top - rect.bottom)
        : Math.max(0,rect.left - origin.right,origin.left - rect.right);
      var value = (horizontal ? Math.abs(dx) : Math.abs(dy)) + across * 3 + (horizontal ? Math.abs(dy) : Math.abs(dx)) * .001;
      if (value < score) { best = item;score = value; }
    });
    return best;
  }
  function next(items,active,code,header,preferred) {
    if (!items.length) return null;
    if (!active) return items[0];
    if ([37,38,39,40].indexOf(code) < 0) return active;
    if (active.group === 'keyboard') {
      var keyboard = rows(items,'keyboard'), keyboardRow = -1, keyboardColumn = -1;
      keyboard.forEach(function (row,index) { var at = row.indexOf(active);if (at >= 0) { keyboardRow = index;keyboardColumn = at; } });
      if (code === 37 || code === 39) return keyboard[keyboardRow][keyboardColumn + (code === 37 ? -1 : 1)] || active;
      var adjacent = keyboard[keyboardRow + (code === 38 ? -1 : 1)];if (adjacent) return nearest(adjacent,active);
      var edge = items.filter(function (item) { return item.group === (code === 38 ? 'search-header' : 'search-actions'); });
      return edge.length ? nearest(edge,active) : active;
    }
    if (active.group === 'search-actions') {
      var actions = rows(items,'search-actions')[0];
      if (code === 37 || code === 39) return actions[actions.indexOf(active) + (code === 37 ? -1 : 1)] || active;
      var letters = rows(items,'keyboard');return code === 38 && letters.length ? nearest(letters[letters.length - 1],active) : active;
    }
    if (active.group === 'search-header') {
      var firstLetters = rows(items,'keyboard')[0];return code === 40 && firstLetters ? nearest(firstLetters,active) : active;
    }
    if (active.group === 'header') {
      var headings = items.filter(function (item) { return item.group === 'header'; }).sort(function (a,b) { return a.rect.left - b.rect.left; });
      if (code === 37 || code === 39) return headings[headings.indexOf(active) + (code === 37 ? -1 : 1)] || active;
      if (code === 40) { if (preferred && items.indexOf(preferred) >= 0 && preferred.group === 'primary') return preferred;var entry = rows(items,'primary')[0] || rows(items,'secondary')[0];return entry ? entry[0] : active; }
      return active;
    }
    if (active.group === 'primary' || active.group === 'secondary') {
      var own = rows(items,active.group), rowIndex = -1, column = -1;
      own.forEach(function (row,index) { var at = row.indexOf(active);if (at >= 0) { rowIndex = index;column = at; } });
      if (code === 37 || code === 39) return own[rowIndex][column + (code === 37 ? -1 : 1)] || active;
      var step = code === 38 ? -1 : 1, row = own[rowIndex + step];
      if (row) return nearest(row,active);
      if (code === 38 && active.group === 'secondary') {
        var above = rows(items,'primary');if (above.length) return nearest(above[above.length - 1],active);
      }
      if (code === 40 && active.group === 'primary') {
        var below = rows(items,'secondary');if (below.length) return nearest(below[0],active);
      }
      return code === 38 ? header || items.filter(function (item) { return item.group === 'header'; })[0] || active : active;
    }
    return spatial(items.filter(function (item) { return item.group === active.group; }),active,code);
  }
  root.LauncherNavigation = {measure:measure,next:next};
}(this));
