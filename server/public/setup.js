(function () {
  var f = document.getElementById('f');
  var err = document.getElementById('err');
  var go = document.getElementById('go');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    var v = function (id) { return document.getElementById(id).value; };
    if (v('pw') !== v('pw2')) { err.textContent = 'The two passwords do not match.'; return; }
    go.disabled = true;
    fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MF': '1' },
      body: JSON.stringify({ name: v('name'), email: v('email'), password: v('pw') })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok) { location.href = '/admin/'; return; }
        err.textContent = (res.j.error && res.j.error.message) || 'Something went wrong.';
        go.disabled = false;
      })
      .catch(function () { err.textContent = 'Could not reach the server.'; go.disabled = false; });
  });
})();
