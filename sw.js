/* sw.js — keeps Quill openable offline and serves library images.
 *
 * The app files are cached at install (the build writes their list into PRECACHE), so the
 * home-screen app opens in airplane mode. Requests under __vfs/ are images from the library,
 * which lives in the page's memory: the worker asks that page for the bytes. */
const VERSION = "0e6a2badc7f1"
const PRECACHE = ["./","aicontext.js","app/ai.js","app/app.js","app/assets/quill-icon.png","app/board.js","app/casebuilder.js","app/chapter.js","app/concept-art.js","app/context-drawer.js","app/dnd.js","app/editor.bundle.js","app/editor.js","app/escape.js","app/fonts/GFSBaskerville.otf","app/fonts/LiberationMono-Italic.ttf","app/fonts/LiberationMono-Regular.ttf","app/fonts/LiberationSans-Bold.ttf","app/fonts/LiberationSans-BoldItalic.ttf","app/fonts/LiberationSans-Italic.ttf","app/fonts/LiberationSans-Regular.ttf","app/fonts/Lora-Italic-Variable.ttf","app/fonts/Lora-Variable.ttf","app/fonts/Poppins-Italic.ttf","app/fonts/Poppins-Light.ttf","app/fonts/Poppins-LightItalic.ttf","app/fonts/Poppins-Medium.ttf","app/fonts/Poppins-Regular.ttf","app/fonts/Poppins-SemiBold.ttf","app/fonts/readme.md","app/help.js","app/ideas.js","app/index.html","app/landing.js","app/manuscript-docx.js","app/models.js","app/photo-crop.js","app/quill-web.js","app/read-draft.js","app/recovery-diff.js","app/revisions.js","app/scenebuilder.js","app/scraps.js","app/settings.js","app/sprint.js","app/story-date.js","app/structurebuilder.js","app/style.css","app/stylelab-reader.js","app/stylelab-study.js","app/stylelab-whatif.js","app/stylelab.js","app/toolbar.js","app/tree.js","app/ui.css","app/web.css","case.js","data/thesaurus.json","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest","revisions.js","structure.js","study.js","words.js"]
const CACHE = `quill-${VERSION}`

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('quill-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

async function fromPage(clientId, path) {
  const clients = await self.clients.matchAll({ type: 'window' })
  const client = clients.find(c => c.id === clientId) || clients[0]
  if (!client) return new Response('', { status: 404 })
  const reply = await new Promise(resolve => {
    const channel = new MessageChannel()
    channel.port1.onmessage = event => resolve(event.data)
    client.postMessage({ type: 'vfs-read', path }, [channel.port2])
    setTimeout(() => resolve({ ok: false }), 5000)
  })
  if (!reply.ok) return new Response('', { status: 404 })
  return new Response(reply.data, { headers: { 'Content-Type': reply.type, 'Cache-Control': 'no-store' } })
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== location.origin) return
  const marker = url.pathname.indexOf('/__vfs/')
  if (marker !== -1) {
    const path = decodeURIComponent(url.pathname.slice(marker + '/__vfs'.length))
    event.respondWith(fromPage(event.clientId || event.resultingClientId, path))
    return
  }
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(hit => hit || fetch(event.request)))
})
