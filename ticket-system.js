/* ticket-system.js
   Single-file Node.js + Express application that implements:
   - In-memory seat state (available / locked / booked)
   - Seat locking with 60-second expiry
   - Endpoints: GET /, GET /seats, POST /lock/:seatId, POST /confirm/:seatId, POST /unlock/:seatId
   - Serves two simple frontend pages: index (manual actions) and simulate (concurrent simulation)
   Save as `ticket-system.js` and run with: `node ticket-system.js`
   Requires: express, body-parser (install with: npm i express body-parser)
*/

const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// --- In-memory seats ---
// We'll create 10 seats: ids 1..10
// State: { status: 'available'|'locked'|'booked', lockInfo: { userId, expiresAt, timeoutId } | null }
const NUM_SEATS = 10;
const seats = {};
for (let i = 1; i <= NUM_SEATS; i++) {
  seats[i] = { status: 'available', lockInfo: null };
}

// Helper: clear a lock (used on expiry or explicit unlock)
function clearLock(seatId) {
  const seat = seats[seatId];
  if (!seat || seat.lockInfo == null) return;
  if (seat.lockInfo.timeoutId) {
    clearTimeout(seat.lockInfo.timeoutId);
  }
  seat.lockInfo = null;
  if (seat.status === 'locked') seat.status = 'available';
}

// Helper: lock seat
function lockSeat(seatId, userId, lockDurationMs = 60000) {
  const seat = seats[seatId];
  if (!seat) return { ok: false, error: 'Seat not found' };
  if (seat.status === 'booked') return { ok: false, error: 'Seat already booked' };
  if (seat.status === 'locked') return { ok: false, error: 'Seat already locked' };
  // Acquire lock
  const expiresAt = Date.now() + lockDurationMs;
  const timeoutId = setTimeout(() => {
    // expire lock automatically
    if (seat.lockInfo && seat.lockInfo.userId === userId) {
      clearLock(seatId);
      console.log(`Lock on seat ${seatId} by user ${userId} expired (auto).`);
    }
  }, lockDurationMs);
  seat.status = 'locked';
  seat.lockInfo = { userId, expiresAt, timeoutId };
  return { ok: true, seat };
}

// Helper: confirm booking
function confirmSeat(seatId, userId) {
  const seat = seats[seatId];
  if (!seat) return { ok: false, error: 'Seat not found' };
  if (seat.status === 'booked') return { ok: false, error: 'Seat already booked' };
  if (seat.status !== 'locked' || !seat.lockInfo) return { ok: false, error: 'Seat is not locked' };
  if (seat.lockInfo.userId !== userId) return { ok: false, error: 'You do not own the lock for this seat' };
  // Confirm booking
  if (seat.lockInfo.timeoutId) clearTimeout(seat.lockInfo.timeoutId);
  seat.lockInfo = null;
  seat.status = 'booked';
  return { ok: true, seat };
}

// --- API Endpoints ---

// Home - simple instructions
app.get('/', (req, res) => {
  res.send(`
    <h2>Concurrent Ticket Booking System (Single-file)</h2>
    <p>Endpoints:</p>
    <ul>
      <li>GET /seats — view seat states (JSON)</li>
      <li>POST /lock/:seatId — lock a seat; JSON body: { "userId": "user1" }</li>
      <li>POST /confirm/:seatId — confirm a locked seat; JSON body: { "userId": "user1" }</li>
      <li>POST /unlock/:seatId — release your lock early; JSON body: { "userId": "user1" }</li>
      <li>GET /ui — open interactive UI</li>
      <li>GET /simulate — open concurrent simulation UI</li>
    </ul>
    <p>Open <a href="/ui">interactive UI</a> or <a href="/simulate">concurrency simulation</a>.</p>
  `);
});

// Get seats state
app.get('/seats', (req, res) => {
  // Return a sanitized view (no timeout ids)
  const view = {};
  for (const id in seats) {
    const s = seats[id];
    view[id] = {
      status: s.status,
      lockInfo: s.lockInfo ? { userId: s.lockInfo.userId, expiresAt: s.lockInfo.expiresAt } : null
    };
  }
  res.json({ ok: true, seats: view, now: Date.now() });
});

// Lock a seat
app.post('/lock/:seatId', (req, res) => {
  const seatId = String(req.params.seatId);
  const userId = req.body.userId;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required in JSON body' });
  // Validate seatId exists
  if (!seats[seatId]) return res.status(404).json({ ok: false, error: 'Seat not found' });
  // Check if already locked/booked
  if (seats[seatId].status === 'booked') {
    return res.status(409).json({ ok: false, error: 'Seat already booked' });
  }
  if (seats[seatId].status === 'locked') {
    return res.status(409).json({ ok: false, error: 'Seat already locked' });
  }
  const result = lockSeat(seatId, userId, 60000); // 60s lock
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, message: `Seat ${seatId} locked for user ${userId} for 60 seconds`, seat: { id: seatId, status: seats[seatId].status, lockInfo: { userId, expiresAt: seats[seatId].lockInfo.expiresAt } } });
});

// Confirm a seat
app.post('/confirm/:seatId', (req, res) => {
  const seatId = String(req.params.seatId);
  const userId = req.body.userId;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required in JSON body' });
  if (!seats[seatId]) return res.status(404).json({ ok: false, error: 'Seat not found' });
  const result = confirmSeat(seatId, userId);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, message: `Seat ${seatId} confirmed/booked by ${userId}`, seat: { id: seatId, status: seats[seatId].status } });
});

// Unlock a seat (release lock early) - only by lock owner
app.post('/unlock/:seatId', (req, res) => {
  const seatId = String(req.params.seatId);
  const userId = req.body.userId;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required in JSON body' });
  if (!seats[seatId]) return res.status(404).json({ ok: false, error: 'Seat not found' });
  const seat = seats[seatId];
  if (seat.status !== 'locked' || !seat.lockInfo) return res.status(400).json({ ok: false, error: 'Seat is not locked' });
  if (seat.lockInfo.userId !== userId) return res.status(403).json({ ok: false, error: 'You do not own this lock' });
  clearLock(seatId);
  res.json({ ok: true, message: `Lock on seat ${seatId} released by ${userId}` });
});

// -- Simple UI to interact --
app.get('/ui', (req, res) => {
  res.send(`
  <!doctype html>
  <html>
  <head><meta charset="utf-8"><title>Ticket UI</title></head>
  <body>
    <h2>Ticket Booking UI</h2>
    <p>Seats: 1..${NUM_SEATS}</p>
    <label>User ID: <input id="userId" value="user1"></label>
    <button onclick="refresh()">Refresh seats</button>
    <div id="seats"></div>
    <script>
      async function refresh() {
        const r = await fetch('/seats').then(r=>r.json());
        const seats = r.seats;
        const container = document.getElementById('seats');
        container.innerHTML = '';
        for (const id in seats) {
          const s = seats[id];
          const div = document.createElement('div');
          div.innerHTML = '<strong>Seat ' + id + '</strong> - ' + s.status + (s.lockInfo ? ' (locked by ' + s.lockInfo.userId + ')' : '') +
            ' <button onclick="doLock(' + id + ')">Lock</button>' +
            ' <button onclick="doConfirm(' + id + ')">Confirm</button>' +
            ' <button onclick="doUnlock(' + id + ')">Unlock</button>';
          container.appendChild(div);
        }
      }
      async function doLock(id) {
        const userId = document.getElementById('userId').value;
        const res = await fetch('/lock/' + id, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId }) });
        alert(JSON.stringify(await res.json()));
        refresh();
      }
      async function doConfirm(id) {
        const userId = document.getElementById('userId').value;
        const res = await fetch('/confirm/' + id, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId }) });
        alert(JSON.stringify(await res.json()));
        refresh();
      }
      async function doUnlock(id) {
        const userId = document.getElementById('userId').value;
        const res = await fetch('/unlock/' + id, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId }) });
        alert(JSON.stringify(await res.json()));
        refresh();
      }
      refresh();
    </script>
  </body>
  </html>
  `);
});

// -- Simulation UI to demonstrate concurrent locking attempts --
app.get('/simulate', (req, res) => {
  res.send(`
  <!doctype html>
  <html>
  <head><meta charset="utf-8"><title>Concurrent Simulation</title></head>
  <body>
    <h2>Concurrent Lock Simulation</h2>
    <p>Choose seat and two users will attempt to lock at nearly the same time.</p>
    <label>Seat ID: <input id="seat" value="1" /></label><br/>
    <label>User A ID: <input id="userA" value="alice" /></label><br/>
    <label>User B ID: <input id="userB" value="bob" /></label><br/>
    <button onclick="runSim()">Run concurrent lock (A & B)</button>
    <pre id="log"></pre>
    <script>
      function log(msg){ document.getElementById('log').textContent += msg + '\\n'; }
      async function attemptLock(userId, seat) {
        try {
          const r = await fetch('/lock/' + seat, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId }) });
          const j = await r.json();
          return { status: r.status, body: j };
        } catch (e) {
          return { status: 0, body: { ok:false, error: e.message } };
        }
      }
      async function runSim() {
        document.getElementById('log').textContent = '';
        const seat = document.getElementById('seat').value;
        const userA = document.getElementById('userA').value;
        const userB = document.getElementById('userB').value;
        log('Starting concurrent attempts to lock seat ' + seat);
        // Fire two requests without awaiting between them to simulate concurrency
        const pA = attemptLock(userA, seat);
        const pB = attemptLock(userB, seat);
        const results = await Promise.all([pA, pB]);
        log('Result A: ' + JSON.stringify(results[0]));
        log('Result B: ' + JSON.stringify(results[1]));
        log('Current seats state: (fetching)');
        const s = await fetch('/seats').then(r=>r.json());
        log(JSON.stringify(s, null, 2));
      }
    </script>
  </body>
  </html>
  `);
});

// Start server
const PORT = 4000;
app.listen(PORT, () => {
  console.log('Ticket booking app running on http://localhost:' + PORT);
  console.log('UI: http://localhost:' + PORT + '/ui    Simulation: http://localhost:' + PORT + '/simulate');
});
