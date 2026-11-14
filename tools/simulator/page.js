const device = document.getElementById('device');
const renderer = new LumeRenderer(device, input => fetch('/input', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
}).catch(e => { document.getElementById('error').textContent = String(e); }));
let generation = 0, since = 0, polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch(`/messages?generation=${generation}&since=${since}`, { cache: 'no-store' });
    const data = await response.json();
    if (data.reset) renderer.reset();
    renderer.replay(data.messages);
    generation = data.generation; since = data.next;
    document.getElementById('error').textContent = data.error || '';
  } catch (e) { document.getElementById('error').textContent = String(e); }
  finally { polling = false; }
}
poll(); setInterval(poll, 120);
