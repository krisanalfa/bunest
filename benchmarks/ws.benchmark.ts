/* eslint-disable @typescript-eslint/restrict-template-expressions */
const SERVER = 'ws://127.0.0.1:3000/'
const CLIENTS_TO_WAIT_FOR = 1024
const DELAY = 64
const MESSAGES_TO_SEND = 32

const promises = []

const clients = new Array<WebSocket>(CLIENTS_TO_WAIT_FOR)
for (let i = 0; i < CLIENTS_TO_WAIT_FOR; i++) {
  clients[i] = new WebSocket(SERVER, {
    headers: { 'x-user-id': `client-${i}` },
  })
  promises.push(
    new Promise<void>((resolve) => {
      clients[i].onopen = () => {
        resolve()
      }
    }),
  )
}

console.time(`All ${CLIENTS_TO_WAIT_FOR} clients connected`)
await Promise.all(promises)
console.timeEnd(`All ${CLIENTS_TO_WAIT_FOR} clients connected`)

let received = 0
let total = 0
let more = false
let remaining: number

for (let i = 0; i < CLIENTS_TO_WAIT_FOR; i++) {
  clients[i].onmessage = (event) => {
    const data = JSON.parse(event.data as string) as { event: string, data: string }
    if (data.event !== 'aboo') {
      return
    }

    received++
    remaining--

    if (remaining === 0) {
      more = true
      remaining = total
    }
  }
}

// each message is supposed to be received
// by each client
// so its an extra loop
for (let i = 0; i < CLIENTS_TO_WAIT_FOR; i++) {
  for (let j = 0; j < MESSAGES_TO_SEND; j++) {
    for (let k = 0; k < CLIENTS_TO_WAIT_FOR; k++) {
      total++
    }
  }
}
remaining = total

function restart() {
  for (let i = 0; i < CLIENTS_TO_WAIT_FOR; i++) {
    for (let j = 0; j < MESSAGES_TO_SEND; j++) {
      clients[i].send(JSON.stringify({ event: 'peek', data: `Hello, world (${j})!` }))
    }
  }
}

const runs: number[] = []
setInterval(() => {
  const last = received
  runs.push(last)
  received = 0
  console.log(
    last,
    `messages per second (${CLIENTS_TO_WAIT_FOR} clients x ${MESSAGES_TO_SEND} msg, min delay: ${DELAY}ms)`,
  )

  if (runs.length >= 10) {
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length
    console.log(mean, `mean messages per second over ${runs.length} runs`)
    if ('process' in globalThis) process.exit(0)
    runs.length = 0
  }
}, 1000)
let isRestarting = false
setInterval(() => {
  if (more && !isRestarting) {
    more = false
    isRestarting = true
    restart()
    isRestarting = false
  }
}, DELAY)
restart()
