Bun.serve<{ uid: string }>({
  port: 3000,
  fetch(req, server) {
    // upgrade the request to a WebSocket
    if (
      server.upgrade(
        req,
        {
          data: { uid: req.headers.get('x-user-id') ?? 'anonymous' },
        },
      )
    ) {
      return // do not return a Response
    }
    return new Response('Upgrade failed', { status: 500 })
  },
  websocket: {
    open(ws) {
      ws.subscribe('room')
    },
    message(ws, message) {
      const parsed = JSON.parse(message as string) as { event: string, data: string }
      if (parsed.event === 'peek') {
        // echo back the message with event "aboo"
        ws.publishText('room', JSON.stringify({ event: 'aboo', data: parsed.data }))
      }
    },
    publishToSelf: true,
    perMessageDeflate: false,
  },
})
console.log('Server started on http://localhost:3000')
