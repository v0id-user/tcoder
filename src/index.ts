import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hello Cloudflare Workers!'))

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
