import { marked } from "https://esm.run/marked"
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai"
import { OpenAI} from "https://cdn.jsdelivr.net/npm/openai@4.73.1/+esm"

const geminiModels = ['gemini-1.5-flash-8b']
const geminiModel = geminiModels[0]

const groqModels = ['llama-3.1-8b-instant']
const deepInfraModels = ['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo']

const API_KEY = window.localStorage.API_KEY

const jsonGenerationConfig = {
  temperature: 0,
  "response_mime_type": "application/json",
}
const model = await getGenerativeModel(API_KEY, { model: geminiModel, generationConfig: { temperature: 0.0 } });
const jsonModel = await getGenerativeModel(API_KEY, { model: geminiModel, generationConfig: jsonGenerationConfig });

const GROQ_API_KEY = window.localStorage.GROQ_API_KEY

let openai = null
const DEEP_INFRA_API_KEY = window.localStorage.DEEP_INFRA_API_KEY
if (DEEP_INFRA_API_KEY) {
  openai = new OpenAI({
    apiKey: DEEP_INFRA_API_KEY,
    baseURL: 'https://api.deepinfra.com/v1/openai',
    dangerouslyAllowBrowser: true,
  });
}

const params = new URLSearchParams(window.location.search)
let currentProvider = params.get('model') || geminiModel

let languageCode = params.get('language')// || 'en'
const followingAudio = true
const chapterDelta = 1000
let chapters = []
let jumped = null
let userJumps = false
let videoId = params.get('id') || params.get('v')
let highlights = []
let ytPlayer = null

async function initVideoPlayer(videoId) {
    function onPlayerReady(event) {
        ytPlayer = event.target;
    }
    function onPlayerStateChange(state) {
        try {
            // Disable captions completelly
            ytPlayer.unloadModule("captions");
            ytPlayer.unloadModule("cc");
        } catch (e) { console.log(e) }
        if (state.data === 1) {
            setPlaying(true)
        } else if (state.data === 2) {
            setPlaying(false)
        }
    }
    function onPlayerError(event) {
        console.log('player error', event.data);
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    let firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    window.onYouTubeIframeAPIReady = function () {
        const ytPlayer = new YT.Player("player", {
            height: "270",
            width: "480",
            host: 'https://www.youtube-nocookie.com',
            videoId: videoId,
            playerVars: {
                playsinline: 1,
                autoplay: 0,
                loop: 0,
                controls: 1,
                disablekb: 0,
                rel: 0,
            },
            events: {
                "onReady": onPlayerReady,
                "onStateChange": onPlayerStateChange,
                "onError": onPlayerError,
            }
        });
        let iframeWindow = ytPlayer.getIframe().contentWindow;
        window.addEventListener("message", function (event) {
            if (event.source === iframeWindow) {
                let data = JSON.parse(event.data);
                if (data.event === "infoDelivery" && data.info) {
                    if (data.info.currentTime !== undefined) {
                        let time = data.info.currentTime
                        audioTimeUpdate(time)
                    }
                }
            }
        });
    }
}


function endOfSentence2(text) {
    return text.endsWith('. ') || text.endsWith('? ') || text.endsWith('! ')
}

function audioTimeUpdate(timeSeconds) {
    let time = timeSeconds * 1000
    let ps = document.body.querySelectorAll('.p')
    let last = -1
    let lastHighlightedWord = null
    let lastHighlightedParagraph = null
    for (let i = 0; i < ps.length; i++) {
        let p = ps[i]
        if (p.start !== -1 && p.start <= time)
            last = i
        let words = p.querySelectorAll('span')
        for (let w of words) {
            if (!w.start)
                continue
            const delta = 1000
            const highlight = w.start >= (time - delta) && w.end <= time + delta
            //let c = []
            if (highlight && !w.classList.contains('highlighted')) {
                w.classList.add('highlighted')
                lastHighlightedWord = w
                lastHighlightedParagraph = p
            }
            if (!highlight && w.classList.contains('highlighted'))
                w.classList.remove('highlighted')
        }
    }
    for (let i = 0; i < ps.length; i++) {
        let p = ps[i]
        if (i !== last) {
            if (p.classList.contains('livep')) {
                p.classList.remove('livep')
            }
        } else {
            if (!p.classList.contains('livep')) {
                p.classList.add('livep')
                if (followingAudio) {
                    let y = p.getBoundingClientRect().top + window.pageYOffset - player.offsetHeight
                    if (jumped) {
                        y = jumped
                        jumped = null
                    }
                    if (userJumps) {
                        userJumps = false
                        window.scrollTo({ left: 0, top: y, behavior: 'smooth' })
                    }
                }
            }
        }
    }

    for (let c of chapters) {
        c.currentChapter = false
    }
    for (let i = chapters.length - 1; i >= 0; --i) {
        if (chapters[i].start <= time) {
            chapters[i].currentChapter = true
            break
        }
    }
}

function setPlaying(p) {
    //console.log('setPlaying',p)
}

function getGenerativeModel(API_KEY, params) {
    const genAI = new GoogleGenerativeAI(API_KEY);
    return genAI.getGenerativeModel(params);
}

function chunkText(text, maxWords = 4000) {
    const words = text.split(/\s+/); // Split the text into words
    const chunks = [];
    let currentChunk = [];
    for (let i = 0; i < words.length; i++) {
        currentChunk.push(words[i]);

        if (currentChunk.length >= maxWords || i === words.length - 1) {
            chunks.push(currentChunk.join(" "));
            currentChunk = [];
        }
    }

    return chunks;
}

async function ytsr(q) {
    if (!q)
        return {}
    let trimmed = q.trim()
    if (!(trimmed.length > 0))
        return {}
    try {
        let response = await fetchData('https://vercel-scribe.vercel.app/api/hello?url=' + encodeURIComponent('https://www.youtube.com/search?q=' + trimmed), true)
        let html = response.data
        let preamble = "var ytInitialData = {"
        let idx1 = html.indexOf(preamble)
        let sub = html.substring(idx1)
        let idx2 = sub.indexOf("};")
        let ytInitialData = sub.substring(0, idx2 + 1)
        let jsonString = ytInitialData.substring(preamble.length - 1)
        let json = JSON.parse(jsonString)
        let res = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents
        let results = []
        for (let r of res) {
            if (!(r.itemSectionRenderer && r.itemSectionRenderer.contents))
                continue
            let items = r.itemSectionRenderer.contents
            for (let i of items) {
                if (i.videoRenderer && i.videoRenderer.publishedTimeText) {
                    let r = i.videoRenderer
                    let obj = { id: r.videoId, name: r.title.runs[0].text, duration: r.lengthText.simpleText, publishedTimeText: r.publishedTimeText.simpleText }
                    results.push(obj)
                }
            }
        }
        return { items: results }
    } catch (e) {
        console.log('setSearch error', e)
        return {}
    }
}

function spin(text = '') {
  return `<div class="simplerow"><i class="spinner fa-solid fa-circle-notch"></i> ${text}</div>`
}

function displayItems(jsonItems) {
  items.innerHTML = ''
  for (let item of jsonItems) {
      let d = document.createElement('div')
      d.className = 'r'
      let duration = item.duration
      if (typeof duration === 'number') {
        duration = msToTime(duration * 1000)
      }
      d.innerHTML = `<a href="./?id=${item.id || item.videoId}"><img src="https://img.youtube.com/vi/${item.id || item.videoId}/mqdefault.jpg"></a><div><a href="?id=${item.id || item.videoId}">${item.name || item.title}</a><div>${duration} - ${item.publishedTimeText || item.published || new Date(item.publishDate).toLocaleDateString()}</div></div><br>`
      items.appendChild(d)
  }
  items.style.display = 'flex'
}

async function search(q, redirect = true) {
  if (redirect)
    window.location.href = './?q=' + encodeURIComponent(q)
  items.style.display = 'flex'
  items.innerHTML = spin('Searching')
  let json = await ytsr(q)
    if (json.error)
        items.innerHTML = 'Error: ' + json.error
    else if (json.items) {
        displayItems(json.items)
    }
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let apiCalls = 0
let outputTokens = 0
let inputTokens = 0
let totalTokens = 0
let totalPrice = 0

const llmProviders = {
  'gemini-1.5-flash-8b': {
    inputPrice: 0.0375,
    outputPrice: 0.15,
  },
  'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo': {
    inputPrice: 0.05,
    outputPrice: 0.05,
  },
  'llama-3.1-8b-instant': {
    inputPrice: 0.05,
    outputPrice: 0.08,
  }/*,
  'llama-3.2-1b-preview': {
    inputPrice: 0.04,
    outputPrice: 0.04,
  },
  'llama-3.2-3b-preview': {
    inputPrice: 0.06,
    outputPrice: 0.06,
  }*/
}

function computePrice(token, pricePerMillion) {
    return token * pricePerMillion / 1000000
}

function formatPrice(price) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5, style: "currency", currency: "USD" })
}

async function llmChapters(text) {
  let paragraphs = text.split('\n\n')
  let items = paragraphs.map((p,idx) => idx + '=' + p.trim())
  let res = await getJSONAnswer('Given the list of numbered paragraphs, group paragraphs into meaningful chapters and return a list with chapter_name and first_paragraph_number of that chapter. Chapters should always contain several paragraphs. Here is the list of numbered paragraphs: ' + items)
  res  = JSON.parse(res)
  let elements = [...punctuatedDiv.querySelectorAll('.p')]
  for (let item of res) {
    const n = +item.first_paragraph_number
    const name = item.chapter_name
    const header = document.createElement('div')
    header.className = 'header llm'
    header.textContent = name
    elements[n].parentElement.insertBefore(header, elements[n])
  }
}

async function getChapters(chunks, languageCode = 'en') {
  let lines = chunks.map(c => parseInt(c.start) + ": " + c.text.trim())
  let transcript = lines.join('\n')
  const chaptersPrompt = `
- Please break down the following transcript into topic changes, providing a concise title for each section.
- Make sure the sections are not too short.
- Please write the titles in ${languageName(json, languageCode)}.
- Please return the result as a JSON array with 'title', 'start'.
Here is the text:
${transcript}`
  const result = await getJSONAnswer(chaptersPrompt)
  if (!result)
      return []
  const chapters = JSON.parse(result)
  const finalChapters = chapters.map(c => new Object({text: c.title, start: parseInt(c.start)})).sort((a,b) => a.start - b.start)
  return finalChapters
}

window.llmChapters = () => llmChapters(json.en.punctuatedText)
window.getChapters = () => getChapters(json.en.chunks)
function updateEstimatedPrice( inputTokens, outputTokens, totalTokens) {
  totalTokensSpan.textContent = totalTokens
  const data = llmProviders[currentProvider]
  if (!data) {
      return
  }
  const priceInput = computePrice(inputTokens, data.inputPrice)
  const priceOutput = computePrice(outputTokens, data.outputPrice)
  const priceTotal = (priceInput + priceOutput)
  costSpan.textContent = `${formatPrice(priceTotal)}`
}

const SYSTEM_PROMPT = 'You are a helpful assistant and only return the result without extra explanation.'

async function getDeepInfra(prompt, systemPrompt = SYSTEM_PROMPT) {
  const completion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    model: currentProvider,
    stream: false,
  });
  let text = completion.choices[0].message.content
  inputTokens += completion.usage.prompt_tokens
  outputTokens += completion.usage.completion_tokens
  totalTokens += completion.usage.total_tokens
  totalPrice += completion.usage.estimated_cost
  updateEstimatedPrice(inputTokens, outputTokens, totalTokens, totalPrice)
return text
}

async function getGroq(prompt, systemPrompt = SYSTEM_PROMPT) {
  const obj = {
    "messages": [
      {
          "role": "system",
          "content": systemPrompt
      },
      {
          "role": "user",
          "content": prompt
      }
    ],
    "model": currentProvider,
    "temperature": 0,
  }
  try {
    let result = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      'method': 'POST',
      'headers': {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
      },
      'body': JSON.stringify(obj)
    });
    let res = await result.json();
    inputTokens += res.usage.prompt_tokens
    outputTokens += res.usage.completion_tokens
    totalTokens += res.usage.total_tokens
    updateEstimatedPrice(inputTokens, outputTokens, totalTokens)
    let text = res.choices[0].message.content
    return text
  } catch (e) {
    console.log('error groq',e)
    return null
  }
}

window.getGroq = getGroq

async function getJSONAnswer(prompt) {
  apiCalls++
  apiCallsSpan.textContent = apiCalls
  const res = await jsonModel.generateContent([prompt])
  inputTokens += res.response.usageMetadata.promptTokenCount
  outputTokens += res.response.usageMetadata.candidatesTokenCount
  totalTokens += res.response.usageMetadata.totalTokenCount
  updateEstimatedPrice(inputTokens, outputTokens, totalTokens)
  return res.response.text()
}

async function getModelAnswer(prompt, maxretry = 4, retryDelayMs = 4000) {
    if (!API_KEY) {
      summary.innerHTML = '<p>Please set your API KEY on the <a href="./">home page</a><p>'
      return null
    }

    for (let i = 0; i < maxretry; i++) {
        apiCalls++
        apiCallsSpan.textContent = apiCalls
        try {
            let res = null
            if (deepInfraModels.indexOf(currentProvider) !== -1) {
              return await getDeepInfra(prompt)
            } else if (groqModels.indexOf(currentProvider) !== -1) {
              return await getGroq(prompt)
            } else {
              res = await model.generateContent([prompt])
              inputTokens += res.response.usageMetadata.promptTokenCount
              outputTokens += res.response.usageMetadata.candidatesTokenCount
              totalTokens += res.response.usageMetadata.totalTokenCount
              updateEstimatedPrice(inputTokens, outputTokens, totalTokens)
              return res.response.text()
            }
        } catch (error) {
            console.log(error)
            if (error.message && error.message.indexOf('API_KEY_INVALID') !== -1) {
              console.log('error: API_KEY_INVALID')
              return null
            }
            await timeout(retryDelayMs)
        }
    }
}
window.getModelAnswer = getModelAnswer

function languageName(json, lang) {
    return json.translationLanguages[lang] || 'English'
}

const chunkSize = 512 // longer context makes the AI hallucinate more
//const chunkSize = 1200 // longer context makes the AI hallucinate more
async function punctuateText(json, c, vocab = '', lang = 'en', p = null) {
    const oldprompt = `- fix the grammar and typos of the given video text transcript
  - do not rephrase: keep the original wording but fix errors
  - write in the ${languageName(json, lang)} language
  - add paragraphs where appropriate
  - do not add paragraphs numbers
  - use this list of words as context to help you fix typos: """${vocab}"""
  - answer with plain text only
  Here is the video text transcript to fix:
  """${c}"""`
    const prompt = `You are an AI assistant tasked with cleaning up raw ASR transcripts. Your goal is to add correct punctuation and capitalization while ensuring that you do not introduce or remove any information from the original text.

Guidelines:

Preserve Content: Do not add new words or alter the meaning of any phrases.
Punctuation: Insert periods, commas, and other punctuation marks where appropriate to improve readability.
Capitalization: Apply correct capitalization, especially at the beginning of sentences and for proper nouns.
Grammar: Correct minor grammatical issues if they clearly align with the spoken context, but avoid rephrasing.
No Hallucinations: If a word or phrase is unclear, retain the original text or indicate uncertainty rather than guessing.
Write in the ${languageName(json, lang)} language
Add paragraphs where appropriate, especially if a question is followed by an answer
Do not add paragraphs numbers
Use this list of words as context to help you fix typos: ${vocab}

Here is the ASR transcript to clean up:
${c}
`
    let finalPrompt = p ? p + c : prompt
    let res = await getModelAnswer(finalPrompt)
    return new Promise((a, r) => {
        if (!res)
            a('')
        let text = res
        if (text.indexOf(lang) === 0)
            text = text.substring(lang.length)
        a(text)
    })
}

async function mergeSentences(json, a, b, vocab, languageCode = 'en') {
    const cleanA = clean(a)
    const cleanB = clean(b)
    let res = await punctuateText(json, cleanA + ' ' + cleanB, vocab, languageCode, `please fix this sentence, without paragraphrasing, write in ${languageName(json, languageCode)}: `)
    res = res.replace(/\s+/g, ' ')
    return res
}

function findChunkEnd(a) {
    let sa = a.split(/\. /)
    let s1 = sa.pop()
    let start = a.substring(0, a.length - s1.length)
    return { paragraph: start, end: s1 }
}

function findChunkStart(b) {
    let sb = b.split(/\. /)
    let s2 = sb.shift()
    let end = b.substring(s2.length)
    return { paragraph: end, start: s2 }
}

function clean(a) {
    return a.toLowerCase().replace(/[^\w]/g, ' ').replace(/\s+/g,' ').trim()
}

function getWords(text) {
    let paragraphs = text.split('\n').filter(p => p > '')
    let res = []
    for (let p of paragraphs) {
        //let words = p.split(/[\s-]+/).map(a => new Object({ o: a, w: a.trim().toLowerCase().replace(/\W+/g, '') }))
        let words = p.split(/[\s-]+/).map(a => new Object({ o: a, w: keepCharacters(a) }))
        if (words.length > 0 && words[0].o > '') {
            words[0].p = true
        }
        res = res.concat(words.filter(w => w.w > ''))
    }
    return res
}
function prepareWords(chunks) {
    let res = []
    for (let c of chunks) {
        let len = c.cleanText.length
        let start = c.start
        let end = c.start + c.dur
        let words = getWords(c.text)
        let dur = end - start
        if (words.length > 0) {
            for (let w of words) {
                const durWord = w.w.length * dur / len
                let s = start
                let e = Math.min(end, start + durWord)
                start = Math.min(end, start + durWord)
                s = parseInt(s)
                e = parseInt(e)
                let obj = { w: w.w, o: w.o, s, e }
                res.push(obj)
            }
        }
    }
    return res
}
function testDiff(wordTimes = [], punctuated = '') {
    let onea = wordTimes.map(item => item.w)
    let one = onea.join('\n')

    let othera = getWords(punctuated)
    let other = othera.map(w => w.w).join('\n')
    let map = []
    let diff = Diff.diffLines(one, other);
    let source = 0
    let removed = 0
    let added = 0
    for (let part of diff) {
        const n = part.count
        for (let i = 0; i < n; i++) {
            if (part.removed) {
                removed++
                source++
            } else if (part.added) {
                added++
                map.push(-1)
            } else {
                map.push(source)
                source++
            }
        }
    }
    console.log('added=',added, 'removed=', removed)
    let idx = 0
    for (let i of map) {
        if (i !== -1) {
            othera[idx].s = wordTimes[i].s
            othera[idx].e = wordTimes[i].e
        }
        idx++
    }
    let i = 0
    while (i < othera.length) {
        let prevEnd = 0
        while (i < othera.length && othera[i].e !== undefined) {
            prevEnd = othera[i].e
            i++
        }
        while (i < othera.length && othera[i].s === undefined) {
            othera[i].s = prevEnd
            prevEnd += 200
            othera[i].e = prevEnd
            i++
        }
    }
    othera.forEach(o => delete o.w)
    return othera
}
//let shownWords = {}
let startTime = 0

function absorb(evt) {
    if (!evt)
        return
    evt.stopPropagation()
    evt.preventDefault()
}
function insertPlaceholderChapter(p) {
    let header = document.createElement('p')
    header.start = p.start
    header.className = 'header generating'
    if (p.classList.contains('notpro'))
        header.classList.add('notpro')
    header.innerHTML = '<i class="spin spinsmall fa-solid fa-circle-notch"></i>'
    p.chapter = 'generating'
    p.parentElement.insertBefore(header, p)
}
function makeChapterContent(c) {
    if (!c || !c.text)
        return ''
    const text = c.text.replace(/https?:\/\/(?:www\.)?([^\/?#]+).*/g, '$1');

    return `<div class="headername">${text}</div>`
}

function insertChapter(p, c) {
    c.taken = true
    let header = document.createElement('p')
    header.className = 'header'
    if (p.classList.contains('notpro'))
        header.classList.add('notpro')
    header.start = c.start
    header.innerHTML = makeChapterContent(c)
    p.chapter = c
    p.header = header
    //p.innerHTML = '<h4>' + c.text + '</h4>' + p.innerHTML
    p.parentElement.insertBefore(header, p)
}

function numberedItem(w) {
  if (w === '*')
    return true
  return w.match(/^\d\./g) !== null
}
function endOfSentence(w) {
    const ends = ['.', '?', '!']
    if (!(w > ''))
        return false
    let lastChar = w[w.length - 1]
    return ends.indexOf(lastChar) !== -1
}
function msToTime(duration) {
    if (!duration)
        return '0:00'
    let milliseconds = Math.floor((duration % 1000) / 100),
        seconds = Math.floor((duration / 1000) % 60),
        minutes = Math.floor((duration / (1000 * 60)) % 60),
        hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

    seconds = (seconds < 10) ? "0" + seconds : seconds;
    if (hours > 0) {
        minutes = (minutes < 10) ? "0" + minutes : minutes;
        return hours + ":" + minutes + ":" + seconds
    }
    return minutes + ":" + seconds
}
function buildWords(words, r = punctuatedDiv) {
    chapters.forEach(c => c.taken = false)
    let p = null
    let end = false
    //let inBold = false
    let inCode = false

    for (let w of words) {
        if (w.o === '.')
            continue
        if (end) {
            for (let c of chapters) {
                if (!c.taken && c.start <= (w.s + chapterDelta) && !c.taken) {
                    w.p = true
                }
            }
        }
        end = endOfSentence(w.o)
        if (w.p && w.o > '') {
            if (!inCode) {
                p = document.createElement('p')
                p.className = 'p'
                p.start = w.s
              if (w.p && !numberedItem(w.o)) {
                let ts = document.createElement('div')
                ts.className = 'ts'
                ts.start = w.s
                ts.textContent = msToTime(p.start)
                ts.addEventListener('click', () => {
                    play(ts.start)
                })
                p.appendChild(ts)
              } else {
                p.classList.add('plist')
                w.o = '- '
              }
              r.appendChild(p)
              for (let c of chapters) {
                  if (c.start <= (w.s + chapterDelta) && !c.taken) {
                      insertChapter(p, c)
                  }
              }
            }
        }
        if (w.o === '')
            continue
        let span = document.createElement('span')
        let codeDetected = false
        //if (w.o.match(/^\*(.*)\*/)) {
        //  w.o = w.o.replaceAll('*','')
        //  span.classList.add('bold')
        //}
        /*if (w.o.indexOf('```') !== -1) {
          codeDetected = true
          if (!inCode)
            p.classList.add('code')
          inCode = !inCode
        } else {
          if (w.o.indexOf('`') === 0) {
              w.o = w.o.substring(1)
              inBold = true
          }
          if (w.o.indexOf('**') === 0) {
            w.o = w.o.substring(2)
            inBold = true
          }
          if (w.o.indexOf('*') === 0) {
            w.o = w.o.substring(1)
            inBold = true
          }
          if (inBold)
              span.classList.add('bold')
          if (w.o.indexOf('`') > 0) {
            inBold = false
            w.o = w.o.replaceAll('`','')
          }
          if (w.o.indexOf('**') > 0) {
            inBold = false
            w.o = w.o.replaceAll('**','')
          }
          if (inBold) {
            let idx = w.o.indexOf('*')
            let len = w.o.length
            if (idx !== -1 && (idx === len - 1 || idx === len - 2)) {
              w.o = w.o.replaceAll('*','')
              inBold = false
            }
          }
        }*/
        const caption = w.o + ' '
        const addPlay = true
        span.textContent = caption
        if (w.s !== undefined) {
            span.o = w.o
            span.start = w.s
            span.end = w.e
            if (addPlay) {
              span.addEventListener('click', (evt) => {
                  absorb(evt)
                  if (span.classList.contains('highlighted'))
                      pause()
                  else
                      play(span.start)
              })
            }
        }
        if (p && !codeDetected) {
            p.appendChild(span)
        }
    }

    if (!chapters || chapters.length === 0) {
        let paragraphs = r.querySelectorAll('.p')
        let idx = 0
        for (let p of paragraphs) {
            if (idx % 3 === 0 && !p.chapter) {
                insertPlaceholderChapter(p)
            }
            idx += 1
        }
    }
    updateHighlights()
}

function createToc(chapters) {
    for (let c of chapters) {
      let div = document.createElement('div')
      div.className = 'tocitem'
      div.innerHTML = `<div class="tocitemtitle">${c.text}</div><div>${msToTime(c.start)}</div>`
      div.start = c.start
      div.title = c.textContent
      div.onclick = (evt) => {
        evt.preventDefault()
        evt.stopPropagation()
        toggleToc()
        play(div.start)
        let header = Array.from(document.querySelectorAll('.header')).find(h => h.start === div.start)
        if (header) {
          let topPosition = window.scrollY + header.getBoundingClientRect().top - playercontainer.offsetHeight - 16
          console.log('topPosition=',topPosition)
          window.scrollTo({left: 0, top: topPosition, behavior: 'smooth'})
        }
      }
      toc.appendChild(div)
    }
}

function isPlaying() {
    return ytPlayer ? ytPlayer.getPlayerState() === 1 : !realplayer.paused
}
let lastStart = null
function pause() {
  ytPlayer ? ytPlayer.pauseVideo() === 1 : realplayer.pause()
}
function play(start) {
    const playing = isPlaying()
    if (!playing || start !== lastStart) {
        ytPlayer ? ytPlayer.seekTo(start / 1000, /* allowSeekAhead */ true) : realplayer.currentTime = start / 1000
        ytPlayer ? ytPlayer.playVideo() : realplayer.play()
    } else {
        ytPlayer ? ytPlayer.pauseVideo() : realplayer.pause()
    }
    if (!ytPlayer && isPlaying())
        realplayer.muted = false
    lastStart = start
}
function keepCharacters(t) {
    return t.trim().toLowerCase().replace(/\W+/g, '')
}
function createChunks(original) {
    const chunks = JSON.parse(JSON.stringify(original))
    chunks.forEach((c, idx) => {
        c.taken = false
        c.cleanText = keepCharacters(c.text)
        c.end = c.start + c.dur
        if (idx > 0 && c.start < chunks[idx - 1].end) {
            chunks[idx - 1].end = c.start
            chunks[idx - 1].dur = chunks[idx - 1].end - chunks[idx - 1].start
        }
    })
    return chunks.filter(c => c.text.length > 0)
}
function timeCodeToMs(time) {
    const items = time.split(":");
    return (
        items.reduceRight(
            (prev, curr, i, arr) =>
                prev + parseInt(curr) * 60 ** (arr.length - 1 - i),
            0
        ) * 1000
    );
}
function computeChapters(description) {
    if (!description)
        return []
    let res = []
    let lines = description.split('\n')
    const reg = new RegExp(/\(?((\d\d?:)?\d\d?:\d\d)\)? ?(-(\d\d?:)?\d\d?:\d\d)?/)
    let idx = 0
    let previousStart = 0
    for (let l of lines) {
        let m = l.match(reg)
        if (m) {
            const lineNumber = idx
            let ts = m[1].trim()
            let start = timeCodeToMs(ts)
            if (start < previousStart) {
              continue; // e.g. V_0dNE-H2gw (text lookd like a timestamp "7:00 PM CDT")
            }
            previousStart = start
            let text = l.replace(reg, '') // https://www.youtube.com/watch?v=SOxYgUIVq6g captions at the end
            if (text.indexOf('- ') === 0)
                text = text.substring(2)
            text = text.replace(/[_\–]+/g, '').trim() // removed - because Step-by-Step in wBpHQgMrSnE
            text = text.replace(/\(?((\d\d?:)?\d\d?:\d\d)\)?/,'').trim() // remove second timestamp V_0dNE-H2gw
            if (text.length === 0 && lineNumber < lines.length - 1 && !lines[lineNumber + 1].match(reg))
                text = lines[lineNumber + 1].trim()
            res.push({ text, start })
        }
        idx++
    }
    let uniques = []
    for (let r of res) {
        if (uniques.map(u => u.start).indexOf(r.start) === -1) {
            uniques.push(r)
        } else {
        }
    }
    if (uniques.length >= 2)
        return uniques
    else
        return []
}
function parseYTChapters(chapters) {
    if (!chapters)
        return []
    let res = []
    for (let c of chapters) {
        let start = c.start ?? c.start_time * 1000
        let text = c.title ?? c.text
        res.push({ text, start })
    }
    return res
}

async function createVocabulary(json, videoId, description = '', languageCode = 'en') {
    if (json && json[languageCode] && json[languageCode].vocabulary) {
        const cachedVocab = json[languageCode].vocabulary
        console.log('cached vocab', cachedVocab)
        return cachedVocab
    }
    if (!description || description.trim().length === 0)
        return ''
    let res = await getModelAnswer(`Return important words including names from this description and return as a simple list separated by commas: ${description}`)
    if (!res)
        return ''
    let vocabulary = res.replace(/\s+/g, ' ')
    if (json[languageCode])
      json[languageCode].vocabulary = vocabulary
    else
      json[languageCode] = { vocabulary }
    localforage.setItem(videoId, json)
    return vocabulary
}

function addHighlight(evt) {
    absorb(evt)
    let s = window.getSelection().toString().trim()
    if (s.length === 0) {
        alert('Select the text you wish to highlight (expect paragraphs)')
        return
    }
    let selection = highlightSelection()
    if (selection) {
        window.getSelection().removeAllRanges()
        highlights.push(selection)
        updateHighlights()
    }
}
function updateHighlights() {
    let r = punctuatedDiv
    let paragraphs = r.querySelectorAll('p')
    for (let h of highlights) {
        if (h.start === null || h.end === null || h.start === undefined || h.end === undefined)
            continue
        let start = h.start
        let end = h.end
        start *= 100
        end *= 100
        for (let p of paragraphs) {
            let spans = p.querySelectorAll('span')
            let added = []
            for (let s of spans) {
                if (s.start >= start && s.end <= end) {
                    s.classList.add('yawas')
                    added.push(s)
                }
            }
        }
    }
}

function highlightSelection() {
    if (window.getSelection().rangeCount < 1)
        return null
    let range = window.getSelection().getRangeAt(0)
    if (range) {
        if (range.startContainer.parentNode.start === undefined)
            return null
        if (range.endContainer.parentNode.end === undefined)
            return null
        let start = Math.floor(range.startContainer.parentNode.start / 100)
        let end = Math.round(range.endContainer.parentNode.end / 100)
        if (end * 100 < range.endContainer.parentNode.end)
            end += 1
        return { start, end }
    }
    return null
}

// use font shadow like https://x.com/altryne/status/1848188194690408680?s=43&t=nMguAgZPu0YXUmgaqsct3w
function drawStrokedText(ctx, text, x, y, fill = 'yellow', baseline = 'bottom', blur = null) {
    let w = ctx.measureText(text).width
    ctx.textBaseline = baseline
    if (blur) {
        ctx.save()
        ctx.shadowBlur = blur.blur
        ctx.shadowColor = blur.color
        ctx.shadowOffsetX = blur.x
        ctx.shadowOffsetX = blur.y
    }
    ctx.strokeStyle = outlinecolorpicker.value
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill
    ctx.fillText(text, x, y);
    //ctx.restore();
    if (blur) {
        ctx.restore()
    }
}

function wrapText(ctx, text, x, maxWidth, maxHeight, lineHeight) {
    if (!(text > ''))
        return
    let words = text.split(' ');
    let line = '';
    let lineWidth = 0;

    //let y = 0
    ctx.textBaseline = 'bottom'
    let lines = []
    //let w = 0
    for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let w = ctx.measureText(testLine).width;
        if (w > maxWidth) {
            lines.push(line.trim())
            //ctx.fillText(line, x, y);
            line = words[n] + ' ';
            lineWidth = ctx.measureText(line).width;
            //y -= lineHeight;
        } else {
            line = testLine;
            lineWidth = w;
        }
    }
    lines.push(line.trim())
    let y = maxHeight
    //let x = 0
    let w = 0
    for (let line of lines.reverse()) {
        w = Math.max(w, ctx.measureText(line).width)
        //drawStrokedText(ctx, line, (maxWidth - w)/2, y)
        y -= lineHeight
    }
    ctx.fillStyle = `rgba(0,0,0,${opacity.value / 100})`
    const pad = 32
    const padv = 16
    const corner = 18
    roundRect(ctx, x + (maxWidth - w) / 2 - pad, y - padv, w + 2 * pad, maxHeight - y + 2 * padv, corner)

    ctx.fillStyle = colorpicker.value
    y = maxHeight
    for (let line of lines.reverse()) {
        const w = ctx.measureText(line).width
        drawStrokedText(ctx, line, x + (maxWidth - w) / 2, y, colorpicker.value)
        //ctx.fillText(line,x + (maxWidth - w)/2, y)
        y -= lineHeight
    }
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    //ctx.stroke();   

    ctx.fill();
}

function findCaptionAt(time) {
    let p = punctuatedDiv.querySelectorAll('span')
    let res = []
    const delta = 1000
    for (let w of p) {
        const highlight = w.start >= (time - delta) && w.end <= (time + delta)
        if (highlight)
            res.push(w.textContent)
        if (res.length > 10)
            break
    }
    return res
}

function getCachedSummary(json, languageCode = 'en') {
  if (json && json[languageCode] && json[languageCode].summary) {
    console.log('cached summary')
    return json[languageCode].summary
  }
  return null
}

async function getSummary(json, videoId, transcript, languageCode = 'en', vocab) {
    let cachedSummary = getCachedSummary(json, languageCode)
    if (cachedSummary) {
        console.log('cached summary')
        return cachedSummary
    }
    const summaryPrompt = `
  - write a very short summary of the following video transcript
  - use this list of dictionary words: """${vocab}"""
  - write the summary in ${languageName(json, languageCode)}
  - answer in plain text without mentioning the language
  Transcript to summarize:
  """${transcript}"""`
    const result = await getModelAnswer(summaryPrompt)
    if (!result)
        return ''
    let summary = result
    if (summary.indexOf(languageCode) === 0)
        summary = summaryText.substring(languageCode.length)
    if (json[languageCode])
        json[languageCode].summary = summary
    else
        json[languageCode] = { summary }
    localforage.setItem(videoId, json)
    return summary
}
let vw = 0
let vh = 0

async function postData(url = "", data = {}) {
    const response = await fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        redirect: "follow",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(data),
    });

    return response.json();
}
async function getUserData(videoId) {
    let data = await localforage.getItem(videoId)
    if (!data)
        data = { highlights: [] }
    if (!data.highlights)
        data.highlights = []
    let hash = window.location.hash
    if (hash > '') {
        let chunks = hash.substring(1).split(',')
        let hashHighlights = []
        for (let c of chunks) {
            let part = c.split('-')
            if (part.length === 2) {
                try {
                    let start = parseInt(part[0])
                    let end = parseInt(part[1])
                    hashHighlights.push({ start, end, hash: true })
                } catch (e) { }
            }
        }
        let combined = data.highlights.concat(hashHighlights)
        let unique = new Set(combined)
        data.highlights = [...unique.values()]
    }
    return data
}
function getTranscriptURLAndLanguage(yt, preferredLanguage = 'en') {
    const captions = yt.captions ? yt.captions.playerCaptionsTracklistRenderer : null
    if (!captions || !captions.captionTracks)
        return { defaultLanguage: 'en', transcripts: {} }
    const idx = captions.defaultAudioTrackIndex ?? 0
    const audioTrack = captions.audioTracks[idx]
    let defaultCaptionTrackIndex = audioTrack.defaultCaptionTrackIndex ?? 0
    if (!defaultCaptionTrackIndex && audioTrack.captionTrackIndices && audioTrack.captionTrackIndices.length > 0)
        defaultCaptionTrackIndex = audioTrack.captionTrackIndices[0]
    const captionTrack = captions.captionTracks[defaultCaptionTrackIndex]
    const translatable = captions.captionTracks.filter(c => c.isTranslatable === true)
    let defaultLanguage = 'en'
    let obj = {}
    if (captionTrack) {
        defaultLanguage = captionTrack.languageCode
        if (defaultLanguage.indexOf('-') !== -1)
            defaultLanguage = defaultLanguage.split('-')[0]
        obj[defaultLanguage] = captionTrack.baseUrl
    }
    // for iOS, we always want the English track because the DistilBert only works with English for now
    if (!obj['en']) {
        if (captionTrack && captionTrack.isTranslatable) {
            obj['en'] = captionTrack.baseUrl + '&tlang=en'
        } else if (translatable.length > 0) {
            obj['en'] = translatable[0].baseUrl + '&tlang=en'
        }
    }
    if (preferredLanguage !== 'en') {
        if (captionTrack && captionTrack.isTranslatable) {
            obj[preferredLanguage] = captionTrack.baseUrl + '&tlang=' + preferredLanguage
        } else if (translatable.length > 0) {
            obj[preferredLanguage] = translatable[0].baseUrl + '&tlang=' + preferredLanguage
        }
    }
    const translationLanguages = {}
    if (captions.translationLanguages) {
        for (let l of captions.translationLanguages) {
            translationLanguages[l.languageCode] = l.languageName.simpleText
        }
    }
    return { defaultLanguage, transcripts: obj, translationLanguages }
}
async function getLocal(videoId, preferredLanguageCode) {
    const data = await getUserData(videoId)
    if (data && data[preferredLanguageCode]) {
        return data
    }
    try {
      const remoteData = await fetchData('./examples/' + videoId + '.json', true)
      if (remoteData && remoteData['en']) {
        languageCode = 'en'
        return remoteData
      }
    } catch (e) {
      console.log('remote not found, getting video info from client', e)
    }
    const payload = {
        videoId,
        "context": {
            "client": {
                "hl": "en",
                "clientName": "WEB",
                "clientVersion": "2.20210721.00.00",
                "clientScreen": "WATCH",
                "mainAppWebInfo": {
                    "graftUrl": "/watch?v=" + videoId
                }
            },
            "user": {
                "lockedSafetyMode": false
            },
            "request": {
                "useSsl": true,
                "internalExperimentFlags": [],
                "consistencyTokenJars": []
            }
        },
        "playbackContext": {
            "contentPlaybackContext": {
                "vis": 0,
                "splay": false,
                "autoCaptionsDefaultOn": false,
                "autonavState": "STATE_NONE",
                "html5Preference": "HTML5_PREF_WANTS",
                "lactMilliseconds": "-1"
            }
        },
        "racyCheckOk": false,
        "contentCheckOk": false
    }
    // https://stackoverflow.com/questions/67615278/get-video-info-youtube-endpoint-suddenly-returning-404-not-found
    const json = await postData(
        "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player", payload)
    window.yt = json
    const obj = {}
    if (json.error || json.videoDetails === undefined)
        return { error: 'invalid video' }
    obj.videoId = json.videoDetails.videoId
    obj.title = json.videoDetails.title
    obj.description = json.videoDetails.shortDescription

    let chapters = json.videoDetails.chapters
    chapters = parseYTChapters(chapters) ?? []
    if (chapters.length === 0)
        chapters = computeChapters(obj.description)
    obj.chapters = chapters
    obj.viewCount = json.videoDetails.viewCount
    obj.duration = parseInt(json.videoDetails.lengthSeconds)
    if (json.microformat && json.microformat.playerMicroformatRenderer)
        obj.publishDate = json.microformat.playerMicroformatRenderer.publishDate
    obj.thumbnail = `https://img.youtube.com/vi/${obj.videoId}/mqdefault.jpg`
    const { defaultLanguage, transcripts, translationLanguages } = getTranscriptURLAndLanguage(json, languageCode)
    obj.translationLanguages = translationLanguages
    obj.defaultLanguage = defaultLanguage ?? 'en'
    for (let languageCode in transcripts) {
        const chunks = await getChunks(transcripts[languageCode])
        obj[languageCode] = { chunks }
    }
    return obj
}
function formatXML(xml) {
    const docParser = new DOMParser()
    const doc = docParser.parseFromString(xml, 'application/xml')
    let texts = doc.querySelectorAll('text')
    let chunks = []
    for (let t of texts) {
        let start = parseFloat(t.getAttribute('start')) * 1000
        let dur = parseFloat(t.getAttribute('dur')) * 1000
        if (isNaN(dur))
            dur = 0.01
        let end = start + dur
        let text = unescapeXml(t.textContent, docParser)
        text = text.replace(/\s+/g, ' ')
        if (text > '') {
            chunks.push({ text, start, end, dur })
        }
    }
    return chunks
}

function unescapeXml(escapedXml, parser) {
    const doc = parser.parseFromString(escapedXml, "text/html")
    return doc.documentElement.textContent;
}

async function fetchData(url, json = false) {
  try {
    const response = await fetch(url)
    if (json)
        return await response.json()
    else
        return await response.text()
  } catch (e) {
    return null
  }
}

async function getChunks(url) {
    try {
        const transcript = await fetchData(url)
        return formatXML(transcript)
    } catch (e) {
        return []
    }
}

async function computeSummary(json, videoid, transcript, languageCode, vocab) {
  const summaryText = await getSummary(json, videoid, transcript, languageCode, vocab)
  summary.innerHTML = marked(summaryText)
}

function showError(msg) {
  summary.textContent = ''
  punctuatedDiv.textContent = msg
}

let transcript = null
let vocab = null
async function punctuate(videoId, preferedLanguageCode) {
    apiCalls = 0
    totalPrice = 0
    inputTokens = 0
    outputTokens = 0
    totalTokens = 0
    updateEstimatedPrice(inputTokens, outputTokens, totalTokens, totalPrice)
    let json = await getLocal(videoId, preferedLanguageCode)
    if (!preferedLanguageCode && json && json.defaultLanguage) {
      languageCode = json.defaultLanguage
    }
    console.log('languageCode',languageCode, preferedLanguageCode)
    window.json = json
    if (json.error) {
        container.style.display = 'none'
        items.innerHTML = '<b>No transcript for this video</b>'
        return
    }
    if (!json.chapters || json.chapters.length === 0) {
      console.log('computing chapters')
      json.chapters = await getChapters(json[languageCode].chunks)
      console.log('chapters=',json.chapters)
    }
    chapters = JSON.parse(JSON.stringify(json.chapters))
    createToc(chapters)

    videoDuration = json.duration
    vtitle.innerHTML = `<a target="_blank" href="https://www.youtube.com/watch?v=${videoId}">${json.title}</a>`
    vurl.textContent = vurl.href = `https://www.youtube.com/watch?v=${videoId}`
    vduration.textContent = msToTime(videoDuration * 1000)
    
    thumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    const img = new Image(thumb.src)
    window.document.title = 'Scribe - ' + json.title
    initVideoPlayer(videoId)

    if (!json[languageCode]) {
      showError('No transcript for this video')
      return
    }
    for (let l in json.translationLanguages) {
      let option = document.createElement('option')
      option.value = l
      option.textContent = json.translationLanguages[l]
      option.selected = l === languageCode
      selectLanguage.appendChild(option)
    }
    selectLanguage.onchange = () => window.location.href = './?id=' + videoId + '&language=' + selectLanguage.value + (currentProvider ? '&model=' + currentProvider : '')

    await localforage.setItem(videoId, json)
    transcript = json[languageCode].chunks.map(c => c.text).join(' ')
    window.originalText = transcript
    const videoTitle = json.title || ''
    const videoDescription = json.description || ''

    const wordTimes = prepareWords(createChunks(json[languageCode].chunks))
    const originalWithParagraphs = chunkText(transcript, 64).join('\n')
    const alignedOriginalTimes = testDiff(wordTimes, originalWithParagraphs)
    buildWords(alignedOriginalTimes, originalDiv)

    let startTime = Date.now()

    let durationInterval = setInterval(() => {
      const endTime = Date.now()
      durationSpan.textContent = msToTime(endTime - startTime)
    }, 1000)
    vocab = await createVocabulary(json, videoId, videoTitle + ' ' + videoDescription, languageCode)
    //computeSummary(json, videoId, transcript, languageCode, vocab)
    let cachedSummary = getCachedSummary(json, languageCode)
    if (cachedSummary) {
      summary.innerHTML = marked(cachedSummary)
    }
    punctuatedDiv.innerHTML = '<p>' + spin('Transcribing...') + '</p>'
    const cachedPunctuatedText = json[languageCode].punctuatedText
    if (cachedPunctuatedText) {
        console.log('cached punctuatedText')
        updateEstimatedPrice(0,0,0,0)
        apiCallsSpan.textContent = '0'
        clearInterval(durationInterval)
        durationSpan.textContent = '0:00'
        let punctuatedText = cachedPunctuatedText
        let punctuatedTimes = testDiff(wordTimes, punctuatedText)
        punctuatedDiv.innerHTML = ''
        buildWords(punctuatedTimes)
        return
    }
    let chunks = chunkText(transcript, chunkSize)
    console.log('n chunks=', chunks.length)
  
    let promises = []
    let i = 0
    for (let c of chunks) {
        let p = punctuateText(json, c, vocab, languageCode)
        promises.push(p)
    }
    let res = await Promise.all(promises)
    console.log('paragraphs done')
    if (res.length === 0) {
        punctuatedDiv.innerHTML = 'No transcript was found'
        return
    } else if (res.length === 1) {
        let punctuatedText = res[0]
        let endTime = Date.now()
        clearInterval(durationInterval)
        durationSpan.textContent = msToTime(endTime - startTime)
        json[languageCode].punctuatedText = punctuatedText
        localforage.setItem(videoId, json)
        let punctuatedTimes = testDiff(wordTimes, punctuatedText)
        punctuatedDiv.innerHTML = ''
        buildWords(punctuatedTimes)
        return
    }
    let s = Date.now()
    let merges = []
    let parts = []
    let sentencesToFix = []
    for (let i = 0; i < res.length - 1; i++) {
        let a = findChunkEnd(res[i])
        let b = findChunkStart(res[i + 1])
        if (i < res.length - 2) {
            let t = findChunkEnd(b.paragraph)
            b.paragraph = t.paragraph
        }
        parts.push({ left: a.paragraph, right: b.paragraph })
        const sentence = clean(a.end) + ' ' + clean(b.start)
        sentencesToFix.push('- ' + sentence)
        console.log(sentence)
        let merged = mergeSentences(json, a.end, b.start, vocab, languageCode)
        merges.push(merged)
    }
    console.log('merging sentences', sentencesToFix.length)
    let fragments = await Promise.all(merges)
    /*const fix = 'please fix types and punctuation in each line, independently. Answer as a JSON array with "sentence_fixed" as the key for each sentence:\n' + sentencesToFix.join('\n')
    let fragments = await getJSONAnswer(fix)*/
    let duration = Date.now() - s
    console.log('merged sentences in',duration)
    //fragments = JSON.parse(fragments)
    let punctuatedText = parts[0].left
    for (let i = 0; i < fragments.length; i++) {
        //punctuatedText += ' ' + fragments[i].sentence_fixed + ' ' + parts[i].right
        punctuatedText += ' ' + fragments[i] + ' ' + parts[i].right
    }
    punctuatedText = punctuatedText.replace(/,\s+/g, ', ')
    clearInterval(durationInterval)
    let endTime = Date.now()
    durationSpan.textContent = msToTime(endTime - startTime)
    json[languageCode].punctuatedText = punctuatedText
    localforage.setItem(videoId, json)
    let punctuatedTimes = testDiff(wordTimes, punctuatedText)
    punctuatedDiv.innerHTML = ''
    buildWords(punctuatedTimes)
}

let videoDuration = 0
function scrollToLive() {
    let p = punctuatedDiv.querySelector('.livep')
    if (!p)
        return
    let y = p.getBoundingClientRect().top + window.pageYOffset - player.offsetHeight
    window.scrollTo({ left: 0, top: y, behavior: 'smooth' })
}
if (videoId) {
    punctuate.innerHTML = spin('Cleaning transcripts')
    myform.style.display = 'none'
    tools.style.display = 'flex'
    punctuate(videoId, languageCode)
    container.style.display = 'block'
} else {
    document.body.classList.add('top')
    const examples = ['V_0dNE-H2gw.json','R6F3T3Bykqg.json','S53BanCP14c.json','U_GFmEgUxXo.json','p9Q5a1Vn-Hk.json']
    const jsonItems = []
    for (let e of examples) {
      let res = await fetchData('./examples/' + e, true)
      if (res) {
        jsonItems.push(res)
      }
    }
    displayItems(jsonItems)
    container.style.display = 'none'
}
myform.addEventListener('submit', (evt) => {
  if (!(q.value.trim() > ''))
    absorb(evt);
})

highlighter.onmousedown = (evt) => addHighlight(evt)

pdfBtn.onclick = () => { window.print() }


geminiBtn.onclick = () => {
  const result = prompt("Enter your Gemini API_KEY", API_KEY || '')
  if (result) {
    window.localStorage.API_KEY = result
  }
} 

groqBtn.onclick = () => {
  const result = prompt("Enter your Groq API_KEY", GROQ_API_KEY || '')
  if (result) {
    window.localStorage.GROQ_API_KEY = result
  }
} 

deepInfraBtn.onclick = () => {
  const result = prompt("Enter your DeepInfra API_KEY", DEEP_INFRA_API_KEY || '')
  if (result) {
    window.localStorage.DEEP_INFRA_API_KEY = result
  }
}

function startObserving() {
  const target = document.getElementById('playercontainer')
  const marker = document.getElementById('marker')
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          target.classList.add('fixed')
        } else {
          target.classList.remove('fixed')
        }
      });
    },
    {
      root: null, // Use the viewport as the root
      threshold: 0, // Trigger as soon as the marker leaves the viewport
    }
  );
  observer.observe(marker);
}

function toggleToc() {
  toc.classList.toggle('opened')
}
// This will make the player fixed when the marker above it leaves the viewport
startObserving()

tocBtn.onclick = toggleToc
toc.onclick = toggleToc

downloadBtn.onclick = async () => {
  const json = await localforage.getItem(videoId)
  const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a')
  link.download = videoId + '.json'
  link.href = url
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function updateModel(newProvider) {
  if (newProvider !== currentProvider) {
    await window.localforage.removeItem(videoId)
    window.location.href = `./?id=${videoId}&model=${newProvider}&language=${selectLanguage.value}`
  }
}

clearCacheBtn.onclick = async () => {
  await window.localforage.removeItem(videoId)
  window.location.reload()
}

for (let l in llmProviders) {
  let option = document.createElement('option')
  option.value = l
  option.textContent = l
  option.selected = l === currentProvider
  selectProvider.appendChild(option)
}
selectProvider.onchange = () => updateModel(selectProvider.value)

summaryBtn.onclick = () => {
  summaryBtn.disabled = true
  summaryBtn.textContent = 'Summarizing...'
  computeSummary(json, videoId, transcript, languageCode, vocab)
}
let searchTerm = params.get('q')
if (searchTerm > '') {
    q.value = searchTerm
    search(searchTerm, false)
}