// What a programme from the TV guide is (#487). The app sends the programmes it has no answer for - each its key, its
// name, a line of its description and its channel - and gets back each one's genre, kind, the name it is known by and
// a picture. Claude reads the names and descriptions (one request for a batch); IMDb's own search gives the picture.
// Every answer is kept in guide_meta, so a programme is asked about once for the whole household - every device, every
// profile. Any device gets what is already known; only a signed-in household member (the request carries the
// account's access token) makes it ask Claude - the app's public key is in a public repository, the Anthropic key is not
// to be spent by whoever finds it. Deployed with verify_jwt off: this function does its own checking.
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@1.12.0'
import { betaZodOutputFormat } from 'npm:@anthropic-ai/sdk@1.12.0/helpers/beta/zod'
import * as z from 'npm:zod@4/v4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })

const GENRES = ['kids', 'reality', 'drama', 'comedy', 'news', 'talk', 'docu', 'life', 'movies', 'other'] as const
const KINDS = ['series', 'show', 'film', 'event', 'filler'] as const
const MAX_ITEMS = 40
const DAILY_MAX = 6000                   // programmes answered in a day, at most

const Answer = z.object({
  items: z.array(z.object({
    key: z.string(),
    genre: z.enum(GENRES),
    kind: z.enum(KINDS),
    imdb_query: z.string(),           // the name to look it up by on IMDb (English, or transliterated); '' when hopeless
    year: z.number().int().nullable(),
  })),
})

const SYSTEM = `You classify programmes from an Israeli TV guide (cable and free-to-air channels, mostly Hebrew).
For every item return:
- genre: kids (children's programmes), reality (reality, competitions, game shows, dating formats), drama (scripted drama,
  thrillers, crime, telenovelas, soaps), comedy (sitcoms, sketch, satire, stand-up), news (news, current affairs,
  investigations, economy, politics), talk (talk shows, interviews, entertainment magazines), docu (documentaries,
  nature, history, science, travel documentaries), life (cooking, food, home, design, health, beauty, travel shows),
  movies (feature films), other (religion, sport, music clips, anything else).
- kind: series (scripted, with episodes), show (a recurring non-scripted programme), film, event (a one-off broadcast),
  filler (clips, promos, station breaks).
- imdb_query: the title as IMDb lists it - the original (usually English) title of a foreign programme or film, or the
  transliterated Hebrew title of an Israeli one (e.g. "Ramzor", "Hisardut"). Israeli channels give foreign series loose
  Hebrew names ("כבאי קליפורניה" is Fire Country, not Station 19; "השריף של קליפורניה" is Sheriff Country): identify the
  programme from its description - its characters, places and story - not from the Hebrew name alone. If you are not sure
  which programme it is, return an empty string: no picture is better than the wrong one.
- year: the first year of the series or the film's year, if you are sure of it; otherwise null.
Return one entry per item, with the same key.`

let anthropic: Anthropic | null = null

/** The picture and id of what IMDb finds by [query]: of the right kind, and the right year or the very name. */
async function imdb(query: string, kind: string, year: number | null) {
  if (!query) return null
  try {
    const r = await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query.toLowerCase())}.json`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!r.ok) return null
    const want = kind === 'film' ? ['movie', 'tvMovie'] : ['tvSeries', 'tvMiniSeries', 'tvSpecial', 'tvShort']
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    // the name it asked for, and its year when it gave one (the US Masked Singer is not the Israeli one); a year alone is
    // never enough, nor a name merely close without one
    const q = norm(query)
    const all = ((await r.json()).d || []).filter((x: any) => String(x.id).startsWith('tt') && want.includes(x.qid))
    const yearOk = (x: any) => Math.abs((x.y || 0) - (year || 0)) <= 1
    const near = (x: any) => norm(x.l || '').includes(q) || q.includes(norm(x.l || ''))
    const hit = year ? all.find((x: any) => norm(x.l || '') === q && yearOk(x)) || all.find((x: any) => near(x) && yearOk(x))
                     : all.find((x: any) => norm(x.l || '') === q)
    if (!hit) return null
    const img = hit.i?.imageUrl ? String(hit.i.imageUrl).replace(/\._V1_.*\.(jpg|png)$/i, '._V1_SX400.$1') : null
    return { imdb: hit.id as string, poster: img, title: hit.l as string, year: (hit.y as number) || year }
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  // a household member, or a device that is not signed in (it gets only what is known)
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const member = token.startsWith('ey') ? !!(await admin.auth.getUser(token)).data?.user : false

  let items: { key: string, name: string, descr?: string, channel?: string }[] = []
  try { ({ items } = await req.json()) } catch { return reply({ error: 'bad request' }, 400) }
  items = (Array.isArray(items) ? items : []).filter(i => i && typeof i.key === 'string' && i.key && typeof i.name === 'string')
    .slice(0, MAX_ITEMS).map(i => ({ key: i.key.slice(0, 200), name: i.name.slice(0, 200),
      descr: String(i.descr || '').slice(0, 300), channel: String(i.channel || '').slice(0, 80) }))
  if (!items.length) return reply({ items: [] })

  // what is already known
  const { data: known } = await admin.from('guide_meta').select('*').in('key', items.map(i => i.key))
  const have = new Map((known || []).map((r: any) => [r.key, r]))
  const ask = items.filter(i => !have.has(i.key))
  // a ceiling on what one day may cost, whoever asks: a household's whole guide is a few thousand programmes, once
  const { count: today } = await admin.from('guide_meta').select('key', { count: 'exact', head: true })
    .gt('created_at', new Date(Date.now() - 864e5).toISOString())
  if (ask.length && member && (today ?? 0) < DAILY_MAX) {
    if (!anthropic) {
      const { data: apiKey } = await admin.rpc('anthropic_key')
      if (!apiKey) return reply({ error: 'no key', items: [...have.values()] }, 503)
      anthropic = new Anthropic({ apiKey })
    }
    let answer: z.infer<typeof Answer> | null = null
    try {
      const msg = await anthropic.beta.messages.parse({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(Answer) },
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(ask) }],
      })
      if (msg.stop_reason !== 'refusal') answer = msg.parsed_output
    } catch (e) {
      console.error('claude', e)
      return reply({ error: 'model', items: [...have.values()] }, 502)
    }
    const asked = new Set(ask.map(i => i.key))
    const rows = await Promise.all((answer?.items || []).filter(a => asked.has(a.key)).map(async a => {
      const pic = a.kind === 'filler' || a.kind === 'event' ? null : await imdb(a.imdb_query, a.kind, a.year)
      return { key: a.key, genre: a.genre, kind: a.kind, title: pic?.title || a.imdb_query || null,
        year: pic?.year ?? a.year, imdb: pic?.imdb || null, poster: pic?.poster || null }
    }))
    if (rows.length) {
      const { error } = await admin.from('guide_meta').upsert(rows)
      if (error) console.error('upsert', error)
      rows.forEach(r => have.set(r.key, r))
    }
  }
  return reply({ items: items.map(i => have.get(i.key)).filter(Boolean) })
})
