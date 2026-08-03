/**
 * live.js
 *
 * UK Rail Viz — live train positions table.
 * Classic script (no ESM) that loads data/live.json through the shared
 * VIZ.requiresData loader and renders a table of the latest snapshot.
 */

(function () {
  "use strict";

  var $live = $('#live');
  if (!$live.length) { return; }

  function render(live) {
    var trains = (live && live.trains) || [];
    var count = trains.length;
    var refreshed = live && live.refreshed_at ? new Date(live.refreshed_at).toLocaleString() : 'unknown time';
    var status = $('<p class="live-status">').text(
      count + ' train' + (count === 1 ? '' : 's') + ' in the network — refreshed ' + refreshed
    );
    $live.empty().append(status);
    if (count === 0) { return; }

    var table = $('<table class="table table-condensed table-hover live-table">');
    $('<thead>').append(
      $('<tr>').append(
        '<th>Train</th>',
        '<th>Headcode</th>',
        '<th>TOC</th>',
        '<th>Current Station</th>',
        '<th>Lateness</th>',
        '<th>Status</th>',
        '<th>Platform</th>',
        '<th>Origin</th>',
        '<th>Destination</th>'
      )
    ).appendTo(table);
    var body = $('<tbody>');
    trains.forEach(function (t) {
      var late = t.lateness_min;
      var cls = late > 5 ? 'text-danger' : (late < -1 ? 'text-success' : '');
      var lateTxt = (late > 0 ? '+' : '') + late + ' min';
      $('<tr>').append(
        '<td>' + (t.train_id || '') + '</td>',
        '<td>' + (t.headcode || '') + '</td>',
        '<td>' + (t.toc || '') + '</td>',
        '<td>' + (t.crs || '') + '</td>',
        '<td class="lateness ' + cls + '">' + lateTxt + '</td>',
        '<td>' + (t.status || '') + '</td>',
        '<td>' + (t.platform || '') + '</td>',
        '<td>' + (t.origin || '') + '</td>',
        '<td>' + (t.destination || '') + '</td>'
      ).appendTo(body);
    });
    table.append(body);
    $live.append(table);
  }

  function fail(err) {
    $live.empty().append($('<p class="live-error">').text('Could not load live data: ' + (err || 'unknown error')));
  }

  if (window.VIZ && VIZ.requiresData) {
    VIZ.requiresData(['json!data/live.json']).done(render).onerror(fail);
  } else {
    // Fallback if the shared loader is unavailable: plain fetch.
    fetch('data/live.json').then(function (r) { return r.json(); }).then(render).catch(fail);
  }
}());
