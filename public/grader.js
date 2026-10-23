(function () {
  var f = document.getElementById('gradeForm'), out = document.getElementById('gOut'), btn = document.getElementById('gBtn');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Grading...'; out.innerHTML = '';
    fetch('/api/grade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review: document.getElementById('gReview').value, reply: document.getElementById('gReply').value, rating: document.getElementById('gRating').value }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); })
      .then(function (j) {
        var h = '<h2 style="margin:0">Score: ' + j.score + '/100 (' + esc(j.grade) + ')</h2>';
        if (j.strengths && j.strengths.length) h += '<h3>What works</h3><ul>' + j.strengths.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
        if (j.tips && j.tips.length) h += '<h3>How to improve it</h3><ul>' + j.tips.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
        h += '<p><a class="btn" href="/#generator">Get 3 better replies with ReviewLoom AI</a></p>';
        out.innerHTML = h;
      })
      .catch(function (err) { out.innerHTML = '<p class="small" style="color:#b91c1c">' + esc(err.message) + '</p>'; })
      .finally(function () { btn.disabled = false; btn.textContent = 'Grade my reply'; });
  });
})();
