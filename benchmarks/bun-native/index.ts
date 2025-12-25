Bun.serve({
  port: 3000,
  routes: {
    '/': {
      // Non-static, avoid cheating :)
      GET: () => Response.json({ msg: 'Hello, world!' }),
    },
  },
})
console.log('Server started on http://localhost:3000')
